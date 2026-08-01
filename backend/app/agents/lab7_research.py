"""Lab 7 — the four agent roles of the Deep Research team.

Role separation is the architecture: the planner only plans (no tools), the
researchers only gather (web tools, nothing else, cheaper model, capped turns),
the synthesizer only writes from supplied evidence (no tools), and the critic
only verifies (no tools, adversarial stance). No agent can exceed its lane —
orchestration and all control flow live in lab7/orchestrator.py, in code.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import date

from claude_agent_sdk import ClaudeAgentOptions

from ..config import (
    CLAUDE_MODEL,
    LAB7_DYN_MAX_TURNS,
    LAB7_RESEARCHER_MODEL,
    LAB7_WORKER_MAX_TURNS,
)
from ..lab7.pipeline import parse_json_block
from ..lab7.runner import stream_agent


def _today() -> str:
    """Models don't know the date — every role that reasons about recency gets it."""
    return date.today().strftime("%B %d, %Y")

# ── Planner ──────────────────────────────────────────────────────────

PLANNER_SYSTEM = """You are the planning lead of a small web-research team. You are given ONE
research question and a breadth N. Decompose it into N independent research
angles that can be investigated in parallel by separate researchers.

Rules:
- Angles must NOT overlap — each covers a distinct facet of the question.
- Each angle needs a crisp objective a researcher can answer with web search.
- Give each angle 2-3 concrete search queries. Include the current year in a
  query when recency matters.
- restated_goal: one sentence saying what the final brief must answer.
- synthesis_focus: one sentence telling the writer how to organize the brief.

Output ONLY this JSON object — no fences, no commentary:
{"restated_goal": "...", "synthesis_focus": "...",
 "angles": [{"id": 1, "title": "...", "objective": "...", "queries": ["...", "..."]}]}
"""


def _no_tools_options(system_prompt: str) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        system_prompt=system_prompt,
        model=CLAUDE_MODEL,
        tools=[],
        allowed_tools=[],
        permission_mode="bypassPermissions",
        setting_sources=[],
    )


async def make_plan(question: str, breadth: int) -> dict:
    """One planning turn → {"plan": dict|None, "error": str|None, "cost_usd": float}."""
    prompt = (
        f"Today's date: {_today()}\n"
        f"Breadth: {breadth} angles\n\nResearch question:\n{question}"
    )
    result = await stream_agent(prompt, _no_tools_options(PLANNER_SYSTEM))
    cost = result.get("cost_usd", 0.0)
    if result["error"]:
        return {"plan": None, "error": result["error"], "cost_usd": cost}
    try:
        return {"plan": parse_json_block(result["result"]), "error": None, "cost_usd": cost}
    except ValueError as exc:
        return {"plan": None, "error": f"Planner returned unusable output: {exc}", "cost_usd": cost}


# ── Researcher (the parallel workers) ────────────────────────────────

RESEARCHER_SYSTEM = """You are one research specialist on a team. You investigate exactly ONE
assigned angle of a larger question — other specialists cover the rest, so do
not drift outside your angle.

Process:
1. Run 2-4 WebSearch calls (start from the suggested queries; refine as needed).
2. WebFetch the 1-3 most promising results to read the actual pages.
3. Extract findings.

Output ONLY this JSON object — no fences, no commentary:
{"summary": "2-3 sentences answering your objective",
 "findings": [{"claim": "one factual statement, with dates/numbers where relevant",
               "source_title": "page or publication title",
               "url": "https://...",
               "quote": "supporting quote from the page, 25 words max"}]}

Rules:
- 3-6 findings. Only claims actually supported by pages you retrieved.
- Prefer primary sources (official docs, announcements, papers) over blogs.
- Keep every quote under 25 words.
- If the web tools fail or nothing relevant is found, return
  {"summary": "<what happened>", "findings": []} — never invent findings.
"""


def _researcher_options() -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        system_prompt=RESEARCHER_SYSTEM,
        model=LAB7_RESEARCHER_MODEL,
        tools=["WebSearch", "WebFetch"],          # read-only web; no files, no bash
        allowed_tools=["WebSearch", "WebFetch"],
        max_turns=LAB7_WORKER_MAX_TURNS,          # runaway-worker stop
        permission_mode="bypassPermissions",
        setting_sources=[],
    )


async def run_researcher(angle: dict, on_tool: Callable[[dict], None] | None = None) -> dict:
    """One researcher turn → {"summary", "findings", "tool_calls", "error", "cost_usd"}."""
    prompt = (
        f"Today's date: {_today()}\n"
        f"Your angle: {angle['title']}\n"
        f"Objective: {angle['objective']}\n"
        f"Suggested starting queries: {', '.join(angle['queries'])}"
    )
    result = await stream_agent(prompt, _researcher_options(), on_tool)
    out = {
        "summary": "",
        "findings": [],
        "tool_calls": result["tool_calls"],
        "error": result["error"],
        "cost_usd": result.get("cost_usd", 0.0),
        "usage": result.get("usage", {}),
    }
    if result["error"]:
        return out
    try:
        payload = parse_json_block(result["result"])
    except ValueError as exc:
        out["error"] = f"Researcher returned unusable output: {exc}"
        return out
    out["summary"] = str(payload.get("summary") or "").strip()
    findings = payload.get("findings")
    out["findings"] = [f for f in findings if isinstance(f, dict)] if isinstance(findings, list) else []
    return out


# ── Synthesizer ──────────────────────────────────────────────────────

SYNTH_SYSTEM = """You are the synthesis writer of a research team. Using ONLY the numbered
sources and findings provided, write a research brief in markdown:

- Start with a "## TL;DR" section of 3-5 bullets.
- Then 2-4 thematic "##" sections organized by the synthesis focus — themes,
  NOT one section per researcher.
- Every factual sentence cites its evidence inline like [2] or [1][4], using
  ONLY the provided source numbers.
- End with "## Open questions" — what the findings do not settle.
- 350-600 words. Do NOT append a source list (the interface renders it).
- Where findings conflict, say so explicitly and cite both.

Output the markdown only — no fences, no preamble, nothing else.
"""

REVISE_INSTRUCTION = """A verification editor reviewed your draft and found grounding problems.
Fix ONLY the listed issues — remove or re-cite unsupported claims, correct
numbers to match the evidence — and keep everything else unchanged. Same
format rules as before. Output the full corrected markdown only."""


async def synthesize(
    question: str,
    focus: str,
    sources_text: str,
    evidence_text: str,
    prior_report: str | None = None,
    issues: list[dict] | None = None,
) -> dict:
    """Write (or revise) the brief → {"report_md", "error", "cost_usd"}."""
    parts = [
        f"Today's date: {_today()}",
        f"Research question: {question}",
        f"Synthesis focus: {focus or 'organize by the strongest themes in the evidence'}",
        f"SOURCES:\n{sources_text}",
        f"EVIDENCE (findings by angle):\n{evidence_text}",
    ]
    if prior_report is not None and issues:
        issue_lines = "\n".join(
            f"- \"{i.get('excerpt', '')}\": {i.get('problem', '')}" for i in issues
        )
        parts += [f"YOUR PRIOR DRAFT:\n{prior_report}", f"ISSUES TO FIX:\n{issue_lines}", REVISE_INSTRUCTION]
    result = await stream_agent("\n\n".join(parts), _no_tools_options(SYNTH_SYSTEM))
    cost = result.get("cost_usd", 0.0)
    report = (result["result"] or "").strip()
    if result["error"] or not report:
        return {"report_md": None, "error": result["error"] or "Synthesizer produced no text.",
                "cost_usd": cost}
    return {"report_md": report, "error": None, "cost_usd": cost}


# ── Critic (adversarial verification) ────────────────────────────────

CRITIC_SYSTEM = """You are the verification editor of a research team, and your stance is
adversarial: assume the draft contains grounding errors and hunt for them.

Check the draft against the evidence table:
1. Every load-bearing claim carries a citation [n], and finding [n] actually
   supports that claim.
2. No numbers, dates, or names appear that are absent from the evidence.
3. Nothing overreaches beyond what the findings say.
4. Conflicting findings are acknowledged, not silently resolved.

Output ONLY this JSON object:
{"verdict": "approved" | "needs_revision",
 "confidence": 0.0-1.0,
 "issues": [{"excerpt": "up to 15 words copied from the draft", "problem": "what is wrong"}]}

Rules: issues must be empty when approved. Use needs_revision only for real
grounding problems — style is not your job. Maximum 5 issues, worst first.
"""


async def critique(question: str, report_md: str, evidence_text: str) -> dict:
    """Adversarial check → {"verdict", "confidence", "issues", "error", "cost_usd"}."""
    prompt = (
        f"Research question: {question}\n\n"
        f"EVIDENCE TABLE:\n{evidence_text}\n\n"
        f"DRAFT TO VERIFY:\n{report_md}"
    )
    result = await stream_agent(prompt, _no_tools_options(CRITIC_SYSTEM))
    out = {"verdict": "approved", "confidence": None, "issues": [],
           "error": result["error"], "cost_usd": result.get("cost_usd", 0.0)}
    if result["error"]:
        return out
    try:
        payload = parse_json_block(result["result"])
    except ValueError as exc:
        out["error"] = f"Critic returned unusable output: {exc}"
        return out
    verdict = str(payload.get("verdict") or "").strip().lower()
    out["verdict"] = "needs_revision" if verdict == "needs_revision" else "approved"
    try:
        out["confidence"] = round(float(payload.get("confidence")), 2)
    except (TypeError, ValueError):
        out["confidence"] = None
    issues = payload.get("issues")
    out["issues"] = [i for i in issues if isinstance(i, dict)][:5] if isinstance(issues, list) else []
    if out["verdict"] == "approved":
        out["issues"] = []
    return out


# ── Lead (agent-loop mode: the model runs the loop, code holds the rails) ──

def lead_system(budget: int) -> str:
    """The lead's system prompt, parameterized by this run's researcher budget
    (the UI lets you lower it to watch the budget rail fire live)."""
    return f"""You are the lead researcher running a live investigation loop. You decide
everything: what to research, how many researchers to send, when the evidence
is sufficient, when to draft, and when you are done. Today's date is {_today()}.
You have exactly three tools:

- delegate_research(angles_json): spin up 1-3 parallel researcher agents.
  angles_json is a JSON array of {{"title", "objective", "queries": [...]}}.
  Returns their findings as numbered sources [n]. Your TOTAL budget is
  {budget} researcher{'s' if budget != 1 else ''} for the whole run — the harness enforces it.
- submit_draft(markdown): send a draft brief to the verification editor.
  Returns a verdict and a list of grounding issues.
- finalize(markdown): publish the final brief. The harness REFUSES this until
  a draft has passed verification (or you have been through review twice).

Operating protocol:
1. Before EVERY tool call, write 2-4 sentences of decision log: what you know
   so far, what is missing, and why you chose this action over the others.
   This narration is displayed live to the user — it is the visible loop.
2. Start by delegating research on the angles YOU judge necessary (batch
   independent angles into one delegate_research call so they run in parallel).
3. Review what comes back. Delegate a follow-up ONLY if a real gap remains —
   do not spend budget on nice-to-have angles.
4. Draft the brief in markdown: "## TL;DR" bullets, 2-4 thematic sections,
   every factual sentence cited like [2] or [1][4] using ONLY the source
   numbers the tools returned, then "## Open questions". 350-600 words.
5. submit_draft, fix what the editor flags, and finalize.

Never invent findings or source numbers. If research keeps failing, finalize
an honest brief that says what could not be established.
"""


def lead_options(server, tool_ids: list[str], budget: int) -> ClaudeAgentOptions:
    """The lead runs a genuine multi-turn loop: its only capabilities are the
    three delegation tools; the turn cap is the code-owned stop condition."""
    return ClaudeAgentOptions(
        system_prompt=lead_system(budget),
        model=CLAUDE_MODEL,
        mcp_servers={"lead": server},
        allowed_tools=tool_ids,
        tools=[],
        max_turns=LAB7_DYN_MAX_TURNS,
        permission_mode="bypassPermissions",
        setting_sources=[],
    )
