"""Lab 2 — Permit Status Query agent.

First MCP server: the agent's ONLY capability is the read-only `run_select`
permits tool (no file, bash, or web tools). It translates plain-English
questions into read-only SELECTs, runs them, and answers in plain language.

Two entry points:
  - answer_permit_question(): run to completion (non-streaming fallback).
  - stream_permit_answer():    yield incremental events (SQL, results table,
                               answer tokens, refusal) for a live UI.
"""
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    StreamEvent,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from ..agent_runtime import run_agent
from ..config import CLAUDE_MODEL
from ..mcp_tools.permits import permits_server

log = logging.getLogger(__name__)

# Marker the model prefixes onto a refusal (a non-read request). The UI hides it
# and shows a "read-only — write declined" badge instead, making the lab's core
# safety guarantee visible rather than buried in prose.
REFUSAL_MARK = "[[READONLY_REFUSAL]]"

SYSTEM_PROMPT = f"""You are a helpful assistant for a county building-permit office.
Counter staff ask you questions in plain English about permit applications.

You can query a single PostgreSQL table via the `run_select` tool:

  permits(
    id, permit_number, permit_type, applicant_name, address,
    status, submitted_date, decision_date, fee
  )

- permit_type is one of: Building, Electrical, Plumbing, Mechanical
- status is one of: Pending, Under Review, Approved, Issued, Rejected
- submitted_date and decision_date are dates; decision_date is null until decided
- fee is numeric (US dollars); all data is from calendar year 2026

For every question:
1. Translate it into ONE read-only SQL SELECT for PostgreSQL.
2. Call `run_select` with that SQL.
3. Answer the user in clear, plain language grounded in the results.

Rules:
- Do NOT include the SQL query in your written answer. The interface already
  displays the exact query you ran in a separate panel, so repeating it is
  redundant.
- Do NOT reproduce the full result set as a Markdown table. The interface shows
  the returned rows in a separate results table below your answer. Answer in
  concise plain language, citing only the key numbers or names that matter
  (e.g. "12 electrical permits are still pending" or the top 2-3 items).
- Use read-only SELECT statements ONLY. Never attempt INSERT, UPDATE, DELETE, or
  any statement that changes data or schema.
- If the user asks you to add, change, delete, or update anything, politely refuse
  and explain that you can only read permit data. Do not call the tool for that.
  Begin any such refusal with the exact marker {REFUSAL_MARK} on its own at the
  very start of your reply; the interface hides the marker and shows a read-only
  notice in its place.
- Use case-insensitive text matching (e.g. ILIKE) so 'electrical' matches 'Electrical'.
- When a question names a month (e.g. "June"), filter submitted_date to that month
  of 2026 unless the user says otherwise.
- Keep answers concise and factual.
"""


def _options(stream: bool = False) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=CLAUDE_MODEL,
        mcp_servers={"permits": permits_server},
        allowed_tools=["mcp__permits__run_select"],
        tools=[],                              # only the permits tool; no built-ins
        permission_mode="bypassPermissions",
        setting_sources=[],
        include_partial_messages=stream,       # token-level deltas for the live UI
    )


async def answer_permit_question(question: str) -> dict:
    return await run_agent(question, _options())


def _flatten_content(content: Any) -> str:
    """Flatten a tool result's content (list of text blocks, or a string)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return ""


def _table_from_tool_result(block: ToolResultBlock) -> dict | None:
    """Parse the `run_select` tool result JSON into a UI table (or None).

    Reusing the tool's own result means the router no longer has to re-run the
    query a second time to build the table.
    """
    text = _flatten_content(getattr(block, "content", None))
    try:
        payload = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or "columns" not in payload:
        return None
    return {
        "ok": True,
        "columns": payload.get("columns", []),
        "rows": payload.get("rows", []),
    }


async def stream_permit_answer(question: str) -> AsyncIterator[dict]:
    """Run the agent and yield incremental UI events:

        {"type": "status",  "phase": "writing"|"running"}
        {"type": "sql",     "sql": ...}          the query the agent chose
        {"type": "table",   "table": {...}}      rows from the tool result
        {"type": "answer_reset"}                 clear any pre-tool preamble
        {"type": "delta",   "text": ...}         a chunk of the plain answer
        {"type": "done",    "answer","sql","refused","error"}
    """
    options = _options(stream=True)
    stderr_lines: list[str] = []
    options.stderr = stderr_lines.append

    final_answer = ""
    last_sql: str | None = None
    refused = False
    error: str | None = None

    yield {"type": "status", "phase": "writing"}
    try:
        async for message in query(prompt=question, options=options):
            if isinstance(message, StreamEvent):
                ev = message.event or {}
                if ev.get("type") == "content_block_delta":
                    delta = ev.get("delta") or {}
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        yield {"type": "delta", "text": delta["text"]}
            elif isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, ToolUseBlock) and block.name.endswith("run_select"):
                        sql = (block.input or {}).get("sql")
                        if sql:
                            last_sql = sql
                            yield {"type": "sql", "sql": sql}
                            yield {"type": "status", "phase": "running"}
            elif isinstance(message, UserMessage):
                for block in getattr(message, "content", None) or []:
                    if isinstance(block, ToolResultBlock):
                        text = _flatten_content(getattr(block, "content", None))
                        # The read-only guard rejecting a non-SELECT is a refusal;
                        # a plain SQL error is not.
                        if getattr(block, "is_error", False) and "read-only SELECT" in text:
                            refused = True
                        table = _table_from_tool_result(block)
                        # Text streamed before the tool ran was preamble — drop it
                        # so only the post-results answer remains on screen.
                        yield {"type": "answer_reset"}
                        if table is not None:
                            yield {"type": "table", "table": table}
            elif isinstance(message, ResultMessage):
                if message.subtype == "success":
                    final_answer = message.result or ""
                else:
                    error = message.subtype
    except Exception as exc:  # noqa: BLE001 - surface any SDK/CLI failure to the client
        log.exception("Lab 2 stream failed")
        error = str(exc)

    if error and stderr_lines:
        detail = "\n".join(stderr_lines[-25:]).strip()
        if detail and detail not in error:
            error = f"{error}\n{detail}"

    if REFUSAL_MARK in final_answer:
        refused = True

    yield {
        "type": "done",
        "answer": final_answer,
        "sql": last_sql,
        "refused": refused,
        "error": error,
    }
