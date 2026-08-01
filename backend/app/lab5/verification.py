"""Lab 5 — VerificationService: the six acceptance checks (stage 6).

Runs the real read-only path (not through the agent) to prove: the server is
registered, the DB connection works, a SELECT works, WRITE operations are blocked
(validator, pre-DB — never executed), and the server is callable. A failed verify
leaves status at 'deployed' (re-runnable); an all-green verify flips to 'verified'.
Nothing here mutates the user's database.
"""
from __future__ import annotations

import asyncio
import logging

from . import errors, registry, store, validator
from .drivers import get_driver

log = logging.getLogger("agentic_labs.lab5")


async def verify(conn_id: int) -> dict:
    public = await store.get_public(conn_id)
    if public is None:
        return {"ok": False, "checks": [{"label": "Connection exists", "ok": False, "detail": "not found"}]}

    driver = get_driver(public["driver"])
    checks: list[dict] = []

    def add(label: str, ok: bool, detail: str = "") -> None:
        checks.append({"label": label, "ok": ok, "detail": detail})

    # 1. Server responds / is registered (re-hydrates from the encrypted row if
    #    lost — a blocking sync DB read, so off-load it to a worker thread).
    try:
        reg = await asyncio.to_thread(registry.get_or_rehydrate, conn_id)
        add("MCP server generated & registered", True, reg.key)
    except Exception as exc:  # noqa: BLE001
        _, message = errors.classify(exc, driver.name)
        add("MCP server generated & registered", False, message)
        return {"ok": False, "checks": checks}

    # 2 & 3. Connection works + a read-only SELECT returns data (full driver path).
    from ..mcp_tools.lab5_dynamic import _run_query_sync

    try:
        payload = await asyncio.to_thread(_run_query_sync, conn_id, "SELECT 1")
        add("Database connection works", True)
        add("Read-only SELECT works", bool(payload.get("ok")))
    except Exception as exc:  # noqa: BLE001
        _, message = errors.classify(exc, driver.name)
        add("Database connection works", False, message)
        add("Read-only SELECT works", False)
        await store.set_status(conn_id, "deployed", "verify_failed")
        return {"ok": False, "checks": checks}

    # 4. Write operations are blocked (Layer 1 — validated, never executed).
    blocked = all(
        not validator.validate(sql, driver.dialect).ok
        for sql in ("INSERT INTO t VALUES (1)", "UPDATE t SET x = 1", "DROP TABLE t")
    )
    add("Write & DDL operations are blocked", blocked)

    # 5. Registered and callable.
    add("Registered for read-only tool calling", bool(reg.tool_ids))

    all_ok = all(c["ok"] for c in checks)
    if all_ok:
        await store.set_status(conn_id, "verified")
        log.info("lab5 verify passed conn=%s", conn_id)
    return {"ok": all_ok, "checks": checks}
