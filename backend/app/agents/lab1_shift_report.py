"""Lab 1 — Production Shift Report agent.

Claude Code fundamentals: the agent is given read-only file tools scoped to a
per-request working directory and a prompt describing the report. No MCP here.
"""
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions

from ..agent_runtime import run_agent
from ..config import CLAUDE_MODEL

SYSTEM_PROMPT = """You are a production shift-report analyst at a fabrication facility.

Your working directory contains two CSV shift logs:
- `current_shift.csv` — the shift that just ended (the one to report on).
- `previous_shift.csv` — the prior shift, for comparison.

Each row is an hourly reading for one production line, with columns:
timestamp, line, units_produced, downtime_minutes, defects.

Read BOTH files, then write a clear, one-page plain-language SHIFT REPORT for the
plant supervisor with these sections:

1. **Summary** — total units produced, total downtime minutes, and total defects
   for the current shift, each shown next to the previous shift with the change
   (absolute and %, using ▲/▼).
2. **By Line** — a compact table: line, units, downtime (min), defects, and the
   change vs. the previous shift for each line.
3. **Exceptions** — call out anything abnormal: a line whose output dropped
   sharply, unusually high downtime, or a defect spike versus the previous shift.
   Briefly explain why each stands out. If nothing is abnormal, say so explicitly.

Rules:
- Compute every total yourself from the raw rows. Do not guess or estimate.
- Write for a busy supervisor: concise, concrete numbers, no jargon.
- Output clean Markdown and nothing else — no preamble like "Here is the report".
"""


async def generate_shift_report(workdir: Path) -> dict:
    options = ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=CLAUDE_MODEL,
        cwd=str(workdir),
        tools=["Read", "Glob", "Grep"],          # only read-only file tools available
        allowed_tools=["Read", "Glob", "Grep"],  # pre-approved (no permission prompt)
        permission_mode="bypassPermissions",     # server context: never block on a prompt
        setting_sources=[],                       # hermetic: ignore local .claude settings
    )
    prompt = (
        "Read current_shift.csv and previous_shift.csv in the working directory "
        "and produce the shift report."
    )
    return await run_agent(prompt, options)
