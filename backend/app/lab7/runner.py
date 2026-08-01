"""Lab 7 — streaming agent runner.

Same collection contract as agent_runtime.run_agent, plus a callback fired the
moment the agent issues a tool call. That callback is what lets the UI show
each researcher's searches and fetches *live*, while the worker is still
running, instead of a post-hoc summary. Kept lab-local so the shared runtime
used by Labs 1-6 stays untouched.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)

log = logging.getLogger(__name__)


async def stream_agent(
    prompt: str,
    options: ClaudeAgentOptions,
    on_tool: Callable[[dict], None] | None = None,
    on_text: Callable[[str], None] | None = None,
) -> dict:
    """Run one agent turn; fire on_tool({name, input}) per tool call as it
    happens, and on_text(chunk) per assistant text block (the agent-loop mode
    uses that to show the lead's decision narration live)."""
    result_text = ""
    tool_calls: list[dict] = []
    error: str | None = None
    cost_usd = 0.0
    usage: dict = {}
    stderr_lines: list[str] = []
    options.stderr = stderr_lines.append

    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock) and on_text is not None:
                        try:
                            on_text(block.text)
                        except Exception:  # noqa: BLE001 - UI callback must never kill a run
                            log.exception("Lab 7 on_text callback failed")
                    if isinstance(block, ToolUseBlock):
                        call = {"id": block.id, "name": block.name, "input": block.input}
                        tool_calls.append(call)
                        if on_tool is not None:
                            try:
                                on_tool(call)
                            except Exception:  # noqa: BLE001 - UI callback must never kill a worker
                                log.exception("Lab 7 on_tool callback failed")
            elif isinstance(message, ResultMessage):
                cost_usd = float(message.total_cost_usd or 0.0)
                raw_usage = message.usage or {}
                usage = {
                    "input_tokens": raw_usage.get("input_tokens", 0),
                    "output_tokens": raw_usage.get("output_tokens", 0),
                }
                if message.subtype == "success":
                    result_text = message.result or ""
                else:
                    error = message.subtype
    except Exception as exc:  # noqa: BLE001 - surface any SDK/CLI failure to the caller
        log.exception("Lab 7 agent run failed")
        error = str(exc)

    if error and stderr_lines:
        detail = "\n".join(stderr_lines[-25:]).strip()
        if detail and detail not in error:
            error = f"{error}\n{detail}"

    return {
        "result": result_text,
        "tool_calls": tool_calls,
        "error": error,
        "cost_usd": round(cost_usd, 6),
        "usage": usage,
    }


def tool_label(call: dict) -> tuple[str, str]:
    """(kind, label) for a researcher tool call — 'search'/'fetch' + the query/url."""
    name = (call.get("name") or "").lower()
    inp: dict[str, Any] = call.get("input") or {}
    if "search" in name:
        return "search", str(inp.get("query", ""))
    if "fetch" in name:
        return "fetch", str(inp.get("url", ""))
    return "tool", name
