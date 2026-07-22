"""Lab 2 — in-process MCP server exposing a read-only permits query tool.

Read-only is enforced three ways (defense in depth):
  1. a single-statement SELECT/WITH guard on the SQL text,
  2. a read-only transaction (SET default_transaction_read_only = on),
  3. a dedicated `labs_readonly` DB role that only has SELECT (see db/seed.py).

Uses SYNCHRONOUS psycopg offloaded to a worker thread: on Windows the backend
runs on the Proactor event loop (required by the Claude Agent SDK to spawn the
`claude` CLI subprocess), and psycopg's async mode is incompatible with Proactor.
"""
import asyncio
import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg
from claude_agent_sdk import create_sdk_mcp_server, tool

from ..config import READONLY_DATABASE_URL

_SELECT_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


def _looks_read_only(sql: str) -> bool:
    stripped = sql.strip().rstrip(";")
    if ";" in stripped:            # reject chained statements
        return False
    return bool(_SELECT_RE.match(stripped))


def _cell(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _run_select_sync(sql: str, limit: int) -> dict:
    conn = psycopg.connect(READONLY_DATABASE_URL, autocommit=True)
    try:
        conn.execute("SET default_transaction_read_only = on")
        with conn.cursor() as cur:
            cur.execute(sql)
            columns = [d.name for d in cur.description] if cur.description else []
            rows = [[_cell(v) for v in row] for row in cur.fetchmany(limit)]
        return {"ok": True, "columns": columns, "rows": rows}
    finally:
        conn.close()


async def execute_select(sql: str, limit: int = 200) -> dict:
    """Run a validated read-only SELECT (in a worker thread); JSON-safe result."""
    if not _looks_read_only(sql):
        return {"ok": False, "error": "Only a single read-only SELECT statement is allowed."}
    try:
        return await asyncio.to_thread(_run_select_sync, sql, limit)
    except Exception as exc:  # noqa: BLE001 - surface DB errors back to the agent
        return {"ok": False, "error": str(exc)}


@tool(
    "run_select",
    "Execute a single read-only SQL SELECT against the permits database and return the rows.",
    {"sql": str},
)
async def run_select(args: dict[str, Any]) -> dict[str, Any]:
    result = await execute_select(args["sql"])
    if not result["ok"]:
        return {
            "content": [{"type": "text", "text": f"Query rejected or failed: {result['error']}"}],
            "is_error": True,
        }
    payload = {
        "columns": result["columns"],
        "rows": result["rows"],
        "row_count": len(result["rows"]),
    }
    return {"content": [{"type": "text", "text": json.dumps(payload, default=str)}]}


permits_server = create_sdk_mcp_server(name="permits", version="1.0.0", tools=[run_select])
