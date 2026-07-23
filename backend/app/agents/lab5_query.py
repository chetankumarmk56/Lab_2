"""Lab 5 — locked-down query agent.

Answers natural-language questions using ONLY the registered read-only MCP server
for a given connection (run_query + list_tables). tools=[] means the agent has no
file/bash/web capability — the connection's read tools are its only power, so
read-only is structural (no human-in-the-loop gate needed, unlike Lab 3).
"""
from __future__ import annotations

import asyncio
import json

from claude_agent_sdk import ClaudeAgentOptions

from ..agent_runtime import run_agent
from ..config import CLAUDE_MODEL
from ..lab5 import registry

SYSTEM_PROMPT = """You help a user query a database they connected. You have two
read-only tools:
- list_tables(): lists the available tables (as schema.table).
- run_query(sql): runs ONE read-only SQL SELECT and returns columns + rows.

For every question:
1. If you don't already know the schema, call list_tables first.
2. Write ONE read-only SELECT that answers the question and call run_query with it.
3. Answer the user in clear, plain language grounded in the returned rows.

Rules:
- Read-only ONLY. Never attempt INSERT/UPDATE/DELETE/DDL — the server refuses them.
- Do NOT include the SQL query in your written answer; the interface shows it separately.
- Keep answers concise and factual.
"""


def _options(conn_id: int) -> ClaudeAgentOptions:
    reg = registry.get_or_rehydrate(conn_id)
    return ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=CLAUDE_MODEL,
        mcp_servers={reg.key: reg.server},
        allowed_tools=reg.tool_ids,
        tools=[],
        permission_mode="bypassPermissions",
        setting_sources=[],
    )


async def answer_query(conn_id: int, question: str) -> dict:
    # _options may rehydrate the server (a blocking sync DB read on cold start),
    # so build it in a worker thread — never block the event loop.
    options = await asyncio.to_thread(_options, conn_id)
    result = await run_agent(question, options)

    run_query_calls = [
        tc for tc in result["tool_calls"]
        if tc["name"].endswith("run_query") and isinstance(tc.get("input"), dict)
    ]
    last = run_query_calls[-1] if run_query_calls else None
    last_sql = last["input"].get("sql") if last else None

    # Prefer the ACTUAL rows the agent saw (captured tool result) so the table can
    # never disagree with the answer — and avoid a second DB round-trip.
    table = None
    if last is not None:
        raw = (result.get("tool_results") or {}).get(last.get("id", ""))
        if raw:
            try:
                payload = json.loads(raw)
                if payload.get("ok") and "columns" in payload:
                    table = {"ok": True, "columns": payload["columns"], "rows": payload["rows"]}
            except (ValueError, KeyError):
                table = None

    # Fallback: re-run once if the tool result wasn't captured by the SDK.
    if table is None and last_sql:
        try:
            from ..mcp_tools.lab5_dynamic import _run_query_sync

            payload = await asyncio.to_thread(_run_query_sync, conn_id, last_sql)
            table = {"ok": True, "columns": payload["columns"], "rows": payload["rows"]}
        except Exception:  # noqa: BLE001 - the answer is still useful without the table
            table = None

    return {"answer": result["result"], "sql": last_sql, "table": table, "error": result["error"]}
