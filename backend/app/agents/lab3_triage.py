"""Lab 3 — Work Order Triage agent.

Multi-tool orchestration + human-in-the-loop. The agent has both work-order MCP
tools available, but a permission callback DENIES the write tool during triage,
so it can only read and propose. Assignments happen only via the Approve button.
"""
import json

from claude_agent_sdk import (
    ClaudeAgentOptions,
    PermissionResultAllow,
    PermissionResultDeny,
)

from ..agent_runtime import run_agent
from ..config import CLAUDE_MODEL
from ..mcp_tools.workorders import CREWS, workorders_server

_CREW_LIST = ", ".join(CREWS)

SYSTEM_PROMPT = f"""You are the maintenance-triage assistant at a manufacturing plant.
Machine operators file work orders all day. Read the queue of new work orders and,
for EACH one, propose an urgency, a crew, and a one-sentence reason.

Urgency is one of:
- "safety" (highest): ALWAYS use this for any work order that mentions injury risk,
  someone getting hurt, a slip/fall hazard, shock or electrocution, burning or fire,
  or a person exposed to moving parts — no matter what else it says.
- "production-stopping": a machine is down or a line is stopped/slowing, with no
  direct hazard to people.
- "routine": everything else (cosmetic, minor, still running normally).

Crew is one of: {_CREW_LIST}
Guidance: oil/hydraulics -> Hydraulics; CNC/mill/spindle/coolant -> CNC / Machining;
electrical/panel/breaker/wiring -> Electrical; a "safety" item needing lockout or
exposure control -> Safety Response; anything else -> General Maintenance.

Process:
1. Call the `read_work_orders` tool to get the queue.
2. Do NOT assign anything — you propose only; a human approves each assignment in the
   dashboard. If you try to write, it will be refused.
3. Return ONLY a JSON array (no prose, no markdown code fences). Each element:
   {{"work_order_id": <int>, "urgency": "safety"|"production-stopping"|"routine",
     "proposed_crew": "<one of the crews above>", "reason": "<one sentence>"}}
"""


async def _deny_writes(tool_name, input_data, context):
    if tool_name == "mcp__workorders__read_work_orders":
        return PermissionResultAllow(updated_input=input_data)
    return PermissionResultDeny(
        message="Assignments require human approval in the dashboard. Propose only; do not write."
    )


def _options() -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=CLAUDE_MODEL,
        mcp_servers={"workorders": workorders_server},
        allowed_tools=["mcp__workorders__read_work_orders"],  # read pre-approved
        tools=[],                                             # no built-ins
        permission_mode="default",                           # writes hit _deny_writes
        can_use_tool=_deny_writes,
        setting_sources=[],
    )


def _extract_json_array(text: str):
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


async def triage() -> dict:
    result = await run_agent("Triage the current maintenance work-order queue.", _options())
    proposals = _extract_json_array(result["result"] or "") or []
    return {
        "proposals": proposals,
        "tool_calls": result["tool_calls"],  # surfaced to the UI to show MCP tool usage
        "raw": result["result"],
        "error": result["error"],
    }
