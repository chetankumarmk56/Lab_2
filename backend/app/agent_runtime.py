"""Thin wrapper around the Claude Agent SDK for running a one-off agent query.

Every lab calls `run_agent(prompt, options)` and gets back a uniform dict:
    {"result": <final text>, "tool_calls": [...], "error": <str|None>}
so the routers and frontend can treat all labs the same way.
"""
import logging

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    ToolUseBlock,
    query,
)

log = logging.getLogger(__name__)


async def run_agent(prompt: str, options: ClaudeAgentOptions) -> dict:
    """Run a single agent turn to completion, collecting the result and tool calls."""
    result_text = ""
    tool_calls: list[dict] = []
    error: str | None = None

    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, ToolUseBlock):
                        tool_calls.append({"name": block.name, "input": block.input})
            elif isinstance(message, ResultMessage):
                if message.subtype == "success":
                    result_text = message.result or ""
                else:
                    error = message.subtype
    except Exception as exc:  # noqa: BLE001 - surface any SDK/CLI failure to the caller
        log.exception("Agent run failed")
        error = str(exc)

    return {"result": result_text, "tool_calls": tool_calls, "error": error}
