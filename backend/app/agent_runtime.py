"""Thin wrapper around the Claude Agent SDK for running a one-off agent query.

Every lab calls `run_agent(prompt, options)` and gets back a uniform dict:
    {"result": <final text>, "tool_calls": [...], "error": <str|None>}
so the routers and frontend can treat all labs the same way.
"""
import logging
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    ToolUseBlock,
    query,
)

log = logging.getLogger(__name__)


async def _single_message_stream(prompt: str) -> AsyncIterator[dict[str, Any]]:
    """Wrap a one-off prompt as the SDK's streaming input (required by can_use_tool)."""
    yield {
        "type": "user",
        "message": {"role": "user", "content": prompt},
        "parent_tool_use_id": None,
    }


async def run_agent(prompt: str, options: ClaudeAgentOptions) -> dict:
    """Run a single agent turn to completion, collecting the result and tool calls."""
    result_text = ""
    tool_calls: list[dict] = []
    error: str | None = None
    stderr_lines: list[str] = []

    # Capture the Claude Code CLI's stderr so real failures (bad model, auth,
    # incompatible CLI) surface in the response — otherwise the SDK reports only
    # a vague "Command failed with exit code 1" and the detail is lost to the
    # server's stderr stream.
    options.stderr = stderr_lines.append

    # A can_use_tool permission callback (Lab 3's human-in-the-loop write gate)
    # requires the SDK's streaming mode — the prompt must be an AsyncIterable, not
    # a str. Labs without a callback keep the simple string path.
    agent_input: Any = prompt
    if getattr(options, "can_use_tool", None) is not None and isinstance(prompt, str):
        agent_input = _single_message_stream(prompt)

    try:
        async for message in query(prompt=agent_input, options=options):
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

    # Fold the CLI's own stderr into the error so the caller sees the real cause.
    if error and stderr_lines:
        detail = "\n".join(stderr_lines[-25:]).strip()
        if detail and detail not in error:
            error = f"{error}\n{detail}"

    return {"result": result_text, "tool_calls": tool_calls, "error": error}
