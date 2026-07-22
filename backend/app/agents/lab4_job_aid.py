"""Lab 4 — Citizen Service Job Aid Generator agent.

Templates + structured document output. The agent turns a tested, step-by-step
workflow into a structured job aid (as JSON), guaranteeing every step is carried
over. The backend then renders that JSON into a branded .docx. The agent needs
no tools — it's a pure text→structure transformation.
"""
from claude_agent_sdk import ClaudeAgentOptions

from ..agent_runtime import run_agent
from ..config import CLAUDE_MODEL

SYSTEM_PROMPT = """You are a senior technical writer for a government agency. You turn a
tested, step-by-step workflow into a polished, staff-facing document.

You are given: the document type to produce (Job Aid, User Manual, or Training
Guide), the agency name (for tone), and the raw tested workflow text.

Produce ONE JSON object — and nothing else — with exactly this shape:
{
  "title": string,            // clear title including the task and the document type
  "document_type": string,    // echo the requested type exactly
  "audience": string,         // who this is for (e.g. "Front-counter staff")
  "purpose": string,          // 1-2 sentences: what this document helps the reader do
  "overview": string,         // a short orienting paragraph (use "" if not needed)
  "prerequisites": [string],  // what to have ready before starting (use [] if none)
  "sections": [               // group the steps into logical phases
    {
      "heading": string,
      "steps": [
        {
          "title": string,    // short imperative step title
          "detail": string,   // what to do, in plain language
          "note": string      // a caution/tip for THIS step, or "" if none
        }
      ]
    }
  ],
  "tips": [string]            // edge cases / gotchas / reprint paths (use [] if none)
}

Hard rules:
- Include EVERY step from the workflow. Do not drop, silently merge, or invent steps.
- Preserve the original order of the steps.
- Write concise, imperative language aimed at the stated audience.
- Fold any "known edge cases" into the relevant step's "note" or into "tips".
- Output ONLY the JSON object. No markdown code fences, no commentary before or after.
"""


def _options() -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=CLAUDE_MODEL,
        tools=[],                 # pure transformation — no file/DB/MCP tools
        allowed_tools=[],
        permission_mode="bypassPermissions",
        setting_sources=[],
    )


async def generate_job_aid(workflow_text: str, doc_type: str, agency: str) -> dict:
    prompt = (
        f"Document type: {doc_type}\n"
        f"Agency: {agency}\n\n"
        f"Tested workflow:\n\n{workflow_text}"
    )
    return await run_agent(prompt, _options())
