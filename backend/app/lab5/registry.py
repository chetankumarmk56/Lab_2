"""Lab 5 — ConnectionRegistry: the process-lifetime map of live MCP servers.

"Register" = put a generated in-process server in this map so it can be handed to
ClaudeAgentOptions per query. The map is intentionally ephemeral: on a cold start
(Render restart) a handle is transparently re-built from the encrypted row via
`get_or_rehydrate`, so the user's connection is never lost — only the volatile
handle.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("agentic_labs.lab5")

_TOOLS = ("run_query", "list_tables")
_registry: dict[int, "RegisteredServer"] = {}


@dataclass
class RegisteredServer:
    conn_id: int
    key: str
    server: Any
    tool_ids: list[str]


def server_key(conn_id: int) -> str:
    return f"userdb_{conn_id}"


def tool_ids(conn_id: int) -> list[str]:
    key = server_key(conn_id)
    return [f"mcp__{key}__{t}" for t in _TOOLS]


def register(conn_id: int, server: Any) -> None:
    _registry[conn_id] = RegisteredServer(conn_id, server_key(conn_id), server, tool_ids(conn_id))
    log.info("lab5 registered server conn=%s key=%s", conn_id, server_key(conn_id))


def get(conn_id: int) -> RegisteredServer | None:
    return _registry.get(conn_id)


def unregister(conn_id: int) -> None:
    if _registry.pop(conn_id, None) is not None:
        log.info("lab5 unregistered server conn=%s", conn_id)


def get_or_rehydrate(conn_id: int) -> RegisteredServer:
    """Return the live handle, rebuilding it from the encrypted row if lost."""
    existing = _registry.get(conn_id)
    if existing is not None:
        return existing
    from ..mcp_tools.lab5_dynamic import build_server  # lazy import avoids a cycle

    register(conn_id, build_server(conn_id))
    return _registry[conn_id]
