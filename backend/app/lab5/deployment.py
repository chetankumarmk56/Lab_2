"""Lab 5 — DeploymentService: the codebase-native "deploy" (stages 3-5).

Generate the read-only MCP server, register it, and record status — with a
bounded retry and a fail-closed rollback (unregister) so a failure never leaves a
half-wired or callable server. Nothing external is created, so there is nothing
external to undo. Returns a synthetic url/status/logs representing the in-process
handle, plus the inspectable generated-code artifact.
"""
from __future__ import annotations

import asyncio
import logging

from . import errors, registry, store
from .connection_service import ConnectionNotFound

log = logging.getLogger("agentic_labs.lab5")


async def deploy(conn_id: int, retries: int = 1) -> dict:
    """Generate + register the read-only server. Retries on failure; rollback is
    scoped to THIS attempt (never tears down a pre-existing/verified handle), and
    the cosmetic code artifact never fails an otherwise-successful deploy."""
    from ..mcp_tools.lab5_dynamic import build_server, generate_code_artifact

    public = await store.get_public(conn_id)
    if public is None:
        raise ConnectionNotFound(conn_id)

    pre_existing = registry.get(conn_id) is not None
    logs: list[str] = []
    for attempt in range(1, retries + 2):  # 1 try + `retries` retries
        registered_now = False
        try:
            logs.append(f"Generating read-only MCP server for the {public['driver']} connection…")
            server = await asyncio.to_thread(build_server, conn_id)
            logs.append("Server generated with tools: run_query, list_tables.")

            registry.register(conn_id, server)
            registered_now = True
            key = registry.server_key(conn_id)
            logs.append(f"Registered in-process as {key} and available for tool calling.")

            await store.set_status(conn_id, "deployed")

            # The generated-code artifact is cosmetic — its failure must NOT fail
            # an already-registered, working server.
            try:
                code = await asyncio.to_thread(generate_code_artifact, conn_id)
            except Exception:  # noqa: BLE001
                code = None
                logs.append("(Generated-code preview unavailable.)")

            return {
                "ok": True,
                "status": "deployed",
                "server_url": f"mcp://{key}",
                "tool_ids": registry.tool_ids(conn_id),
                "logs": logs,
                "code": code,
            }
        except Exception as exc:  # noqa: BLE001
            if registered_now:  # only drop the handle THIS attempt created
                registry.unregister(conn_id)
            category, message = errors.classify(exc)
            logs.append(f"Attempt {attempt} failed: {message}")
            log.warning("lab5 deploy attempt %s failed conn=%s category=%s", attempt, conn_id, category)

    # Don't downgrade a connection that was already deployed/verified before this run.
    if not pre_existing:
        await store.set_status(conn_id, "tested", "deploy_failed")
    return {
        "ok": False,
        "status": "failed",
        "logs": logs,
        "error": "Could not generate the MCP server. Re-test the connection and try again.",
    }
