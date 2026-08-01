"""Lab 7 — agent-loop (autonomous) mode.

The complement to orchestrator.py, and the point of having both: here the
MODEL runs the loop. A lead agent gets three delegation tools and iterates —
observe results, decide the next move among its tools, act — until it
finalizes. What stays in code are the rails, not the flow:

  - a total researcher budget (the 7th researcher is refused),
  - a lead turn cap (in lead_options),
  - finalize() refuses until a draft passed verification,
  - one level of delegation: workers cannot spawn workers.

Every beat is emitted as an event — the lead's decision narration, each tool
choice, each spawned researcher's live activity, verdicts, the final brief —
so the UI can render the loop itself.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from time import perf_counter

from claude_agent_sdk import create_sdk_mcp_server, tool

from ..agents import lab7_research
from ..config import (
    LAB7_DYN_MAX_RESEARCHERS,
    LAB7_WORKER_CONCURRENCY,
    LAB7_WORKER_TIMEOUT_S,
)
from .pipeline import check_citations, evidence_table
from .runner import stream_agent, tool_label

log = logging.getLogger(__name__)

_SENTINEL = None
MAX_ANGLES_PER_CALL = 3

TOOL_NAMES = ["delegate_research", "submit_draft", "finalize"]
TOOL_IDS = [f"mcp__lead__{name}" for name in TOOL_NAMES]


def _text_result(text: str, is_error: bool = False) -> dict:
    block = {"content": [{"type": "text", "text": text}]}
    if is_error:
        block["is_error"] = True
    return block


def build_lead_toolkit(
    question: str,
    emit: Callable[[dict], None],
    max_researchers: int = LAB7_DYN_MAX_RESEARCHERS,
) -> dict:
    """The lead's three tools as closures over shared run state.

    `max_researchers` is this run's budget rail — the UI can lower it so the
    rail can be provoked live. Returns {server, state, handlers} — `handlers`
    are the raw async functions (pre-decoration) so tests can drive them
    without any model or MCP plumbing.
    """
    state = {
        "turn": 0,
        "researchers_used": 0,
        "next_angle_id": 0,
        "sources": [],
        "by_url": {},
        "findings": [],
        "drafts": [],
        "verdicts": [],
        "final": None,
        "web_calls": 0,
        "critic_runs": 0,
        "cost": 0.0,
    }

    def _register_findings(angle_title: str, findings: list[dict]) -> list[str]:
        """Merge one researcher's findings into the shared citation space."""
        lines: list[str] = []
        for f in findings:
            url = str(f.get("url") or "").strip()
            if not url:
                continue
            if url not in state["by_url"]:
                state["by_url"][url] = len(state["sources"]) + 1
                state["sources"].append(
                    {
                        "n": state["by_url"][url],
                        "title": str(f.get("source_title") or url).strip() or url,
                        "url": url,
                    }
                )
            n = state["by_url"][url]
            entry = {
                "n": n,
                "angle_title": angle_title,
                "claim": str(f.get("claim") or "").strip(),
                "quote": str(f.get("quote") or "").strip(),
                "url": url,
            }
            state["findings"].append(entry)
            lines.append(f"[{n}] {entry['claim']}" + (f' — "{entry["quote"]}"' if entry["quote"] else ""))
        return lines

    async def delegate_research(args: dict) -> dict:
        raw = (args or {}).get("angles_json", "") or ""
        try:
            angles = json.loads(raw)
            if isinstance(angles, dict):
                angles = [angles]
            assert isinstance(angles, list) and angles
        except Exception:  # noqa: BLE001 - the lead gets a corrective error, not a crash
            return _text_result(
                'angles_json must be a JSON array like [{"title": "...", "objective": "...", "queries": ["..."]}].',
                is_error=True,
            )

        remaining = max_researchers - state["researchers_used"]
        if remaining <= 0:
            return _text_result(
                f"Researcher budget exhausted ({max_researchers} total). "
                "Work with the findings you have: draft, verify, finalize.",
                is_error=True,
            )
        batch = []
        for raw_angle in angles[: min(MAX_ANGLES_PER_CALL, remaining)]:
            if not isinstance(raw_angle, dict):
                continue
            title = str(raw_angle.get("title") or "").strip()
            objective = str(raw_angle.get("objective") or "").strip() or title
            if not title:
                continue
            queries = [str(q).strip() for q in (raw_angle.get("queries") or []) if str(q).strip()]
            state["next_angle_id"] += 1
            batch.append(
                {
                    "id": state["next_angle_id"],
                    "title": title,
                    "objective": objective,
                    "queries": queries[:4] or [title],
                }
            )
        if not batch:
            return _text_result("No valid angles in angles_json.", is_error=True)

        state["researchers_used"] += len(batch)
        emit(
            {
                "type": "budget",
                "researchers_used": state["researchers_used"],
                "researchers_max": max_researchers,
            }
        )

        sem = asyncio.Semaphore(LAB7_WORKER_CONCURRENCY)
        turn = state["turn"]

        async def one(angle: dict) -> dict:
            async with sem:
                emit({"type": "worker", "angle_id": angle["id"], "turn": turn,
                      "status": "running", "title": angle["title"]})
                t0 = perf_counter()

                def on_tool(call: dict) -> None:
                    kind, label = tool_label(call)
                    emit({"type": "tool", "angle_id": angle["id"], "turn": turn,
                          "kind": kind, "label": label})

                try:
                    result = await asyncio.wait_for(
                        lab7_research.run_researcher(angle, on_tool),
                        timeout=LAB7_WORKER_TIMEOUT_S,
                    )
                except asyncio.TimeoutError:
                    result = {"summary": "", "findings": [], "tool_calls": [],
                              "error": f"timed out after {LAB7_WORKER_TIMEOUT_S}s"}
                except Exception as exc:  # noqa: BLE001 - one dead worker stays local
                    result = {"summary": "", "findings": [], "tool_calls": [], "error": str(exc)}
                state["web_calls"] += len(result["tool_calls"])
                state["cost"] += result.get("cost_usd") or 0.0
                kinds = [tool_label(c)[0] for c in result["tool_calls"]]
                emit({"type": "worker_done", "angle_id": angle["id"], "turn": turn,
                      "title": angle["title"], "ms": round((perf_counter() - t0) * 1000, 1),
                      "searches": kinds.count("search"), "fetches": kinds.count("fetch"),
                      "summary": result["summary"], "findings": result["findings"],
                      "error": result["error"],
                      "cost_usd": result.get("cost_usd", 0.0),
                      "usage": result.get("usage", {})})
                return {"angle": angle, **result}

        results = await asyncio.gather(*(one(a) for a in batch))

        report_lines: list[str] = []
        for r in results:
            report_lines.append(f"\nAngle: {r['angle']['title']}")
            if r["error"]:
                report_lines.append(f"  RESEARCHER FAILED: {r['error']}")
                continue
            report_lines.append(f"  Summary: {r['summary'] or '(none)'}")
            report_lines.extend(f"  {line}" for line in _register_findings(r["angle"]["title"], r["findings"]))
        emit({"type": "sources", "sources": list(state["sources"])})

        remaining = LAB7_DYN_MAX_RESEARCHERS - state["researchers_used"]
        report_lines.append(
            f"\nResearcher budget: {state['researchers_used']}/{LAB7_DYN_MAX_RESEARCHERS} used"
            f" ({remaining} remaining). Cite findings by their [n] numbers."
        )
        return _text_result("\n".join(report_lines).strip())

    async def submit_draft(args: dict) -> dict:
        markdown = ((args or {}).get("markdown", "") or "").strip()
        if not markdown:
            return _text_result("submit_draft requires the draft markdown.", is_error=True)
        state["drafts"].append(markdown)
        attempt = len(state["drafts"])
        state["critic_runs"] += 1
        verdict = await lab7_research.critique(question, markdown, evidence_table(state["findings"]))
        state["verdicts"].append(verdict)
        state["cost"] += verdict.get("cost_usd") or 0.0
        emit({"type": "verdict", "attempt": attempt, **verdict, "ms": 0})
        if verdict["verdict"] == "approved":
            return _text_result(
                f"VERDICT: approved (confidence {verdict['confidence']}). Call finalize with this draft."
            )
        issues = "\n".join(f'- "{i.get("excerpt", "")}": {i.get("problem", "")}' for i in verdict["issues"])
        return _text_result(
            f"VERDICT: needs_revision (confidence {verdict['confidence']}).\nIssues:\n{issues}\n"
            "Fix ONLY these issues and resubmit (or finalize after a second review)."
        )

    async def finalize(args: dict) -> dict:
        markdown = ((args or {}).get("markdown", "") or "").strip()
        if not markdown:
            return _text_result("finalize requires the final markdown.", is_error=True)
        if not state["verdicts"]:
            return _text_result(
                "REFUSED: no draft has been verified yet — call submit_draft first. "
                "The harness does not publish unreviewed briefs.",
                is_error=True,
            )
        approved = state["verdicts"][-1]["verdict"] == "approved"
        if not approved and len(state["verdicts"]) < 2:
            return _text_result(
                "REFUSED: the last draft did not pass verification. Fix the issues and "
                "submit_draft again — finalize unlocks after approval or a second review.",
                is_error=True,
            )
        state["final"] = markdown
        emit({"type": "report", "revision": len(state["drafts"]), "report_md": markdown, "ms": 0})
        emit({"type": "citations", **check_citations(markdown, state["sources"])})
        return _text_result("Published. You are done — do not call more tools.")

    handlers = {"delegate_research": delegate_research, "submit_draft": submit_draft, "finalize": finalize}
    server = create_sdk_mcp_server(
        name="lead",
        version="1.0.0",
        tools=[
            tool("delegate_research",
                 "Spin up 1-3 parallel researcher agents. angles_json = JSON array of "
                 '{"title", "objective", "queries": [..]} objects.',
                 {"angles_json": str})(delegate_research),
            tool("submit_draft",
                 "Send a draft brief (markdown) to the verification editor; returns a verdict and issues.",
                 {"markdown": str})(submit_draft),
            tool("finalize",
                 "Publish the final brief (markdown). Refused until a draft passed verification.",
                 {"markdown": str})(finalize),
        ],
    )
    return {"server": server, "state": state, "handlers": handlers}


async def run_dynamic(question: str, max_researchers: int | None = None) -> AsyncIterator[dict]:
    """Run the lead's loop, yielding UI events (same envelope as planned mode).

    max_researchers lowers this run's budget rail (never above the configured
    cap) — the UI exposes it so the rail can be demonstrated firing live.
    """
    budget = min(max(max_researchers or LAB7_DYN_MAX_RESEARCHERS, 1), LAB7_DYN_MAX_RESEARCHERS)
    queue: asyncio.Queue = asyncio.Queue()

    def emit(event: dict) -> None:
        queue.put_nowait(event)

    async def pipeline() -> None:
        t_run = perf_counter()
        toolkit = build_lead_toolkit(question, emit, budget)
        state = toolkit["state"]
        pending = {"thought": ""}

        def on_text(text: str) -> None:
            pending["thought"] = (pending["thought"] + "\n\n" + text.strip()).strip()

        def on_tool(call: dict) -> None:
            state["turn"] += 1
            name = (call.get("name") or "").rsplit("__", 1)[-1]
            inp = call.get("input") or {}
            if name == "delegate_research":
                try:
                    angles = json.loads(inp.get("angles_json", "") or "[]")
                    titles = [a.get("title", "?") for a in angles if isinstance(a, dict)]
                    detail = " + ".join(titles) or "?"
                except Exception:  # noqa: BLE001
                    detail = "?"
            else:
                detail = f"{len(str(inp.get('markdown', '')))} chars of markdown"
            emit({"type": "turn", "n": state["turn"], "thought": pending["thought"],
                  "tool": name, "detail": detail})
            pending["thought"] = ""

        try:
            emit({"type": "budget", "researchers_used": 0, "researchers_max": budget})
            emit({"type": "stage", "stage": "research", "status": "start", "workers": 0})
            options = lab7_research.lead_options(toolkit["server"], TOOL_IDS, budget)
            result = await stream_agent(
                f"Research question:\n{question}", options, on_tool=on_tool, on_text=on_text
            )
            lead_cost = result.get("cost_usd") or 0.0

            # Wrap-up: the loop must end with something honest on screen.
            if state["final"] is None:
                fallback_md: str | None = None
                if state["drafts"]:
                    emit({"type": "note",
                          "text": "The lead ended without calling finalize — showing its last draft."})
                    fallback_md = state["drafts"][-1]
                    emit({"type": "report", "revision": len(state["drafts"]),
                          "report_md": fallback_md, "ms": 0})
                elif (result["result"] or "").strip() and not result["error"]:
                    emit({"type": "note",
                          "text": "The lead ended without drafting via tools — showing its closing message."})
                    fallback_md = result["result"].strip()
                    emit({"type": "report", "revision": 0, "report_md": fallback_md, "ms": 0})
                if fallback_md is not None:
                    emit({"type": "citations", **check_citations(fallback_md, state["sources"])})

            emit({"type": "done", "error": result["error"],
                  "totals": {
                      "ms": round((perf_counter() - t_run) * 1000, 1),
                      "agents": 1 + state["researchers_used"] + state["critic_runs"],
                      "tool_calls": len(result["tool_calls"]) + state["web_calls"],
                      "iterations": state["turn"],
                      "cost_usd": round(state["cost"] + lead_cost, 4),
                  }})
        except Exception as exc:  # noqa: BLE001 - the stream must always terminate
            log.exception("Lab 7 dynamic run failed")
            emit({"type": "done", "error": str(exc),
                  "totals": {"ms": round((perf_counter() - t_run) * 1000, 1),
                             "agents": 1 + state["researchers_used"] + state["critic_runs"],
                             "tool_calls": state["web_calls"],
                             "iterations": state["turn"],
                             "cost_usd": round(state["cost"], 4)}})
        finally:
            queue.put_nowait(_SENTINEL)

    task = asyncio.create_task(pipeline())
    try:
        while True:
            event = await queue.get()
            if event is _SENTINEL:
                break
            yield event
    finally:
        if not task.done():
            task.cancel()
