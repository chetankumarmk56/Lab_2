"""Lab 7 — the orchestration pipeline: research → synthesize → verify (→ revise).

This module IS the lesson: the model plans and the workers reason, but the
control flow — fan-out, concurrency caps, join, verification loop, failure
handling — is plain code. Deterministic orchestration over model-driven
delegation is what makes the run debuggable, cost-bounded, and demoable.

Every step emits an event onto an asyncio queue; the router serializes them as
NDJSON so the frontend can render the run live: worker cards appearing, each
search/fetch as it happens, the join, the draft, the verdict, the revision.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from time import perf_counter

from ..agents.lab7_research import critique, run_researcher, synthesize
from ..config import LAB7_WORKER_CONCURRENCY, LAB7_WORKER_TIMEOUT_S
from .pipeline import check_citations, dedupe_sources, evidence_table, source_list
from .runner import tool_label

_SENTINEL = None


async def run_research(question: str, plan: dict) -> AsyncIterator[dict]:
    """Execute an approved plan, yielding UI events as they happen."""
    queue: asyncio.Queue = asyncio.Queue()

    def emit(event: dict) -> None:
        queue.put_nowait(event)

    async def worker(angle: dict, sem: asyncio.Semaphore) -> dict:
        """One researcher: capped by the semaphore, failure stays local."""
        async with sem:
            emit({"type": "worker", "angle_id": angle["id"], "status": "running", "title": angle["title"]})
            t0 = perf_counter()

            def on_tool(call: dict) -> None:
                kind, label = tool_label(call)
                emit({"type": "tool", "angle_id": angle["id"], "kind": kind, "label": label})

            try:
                result = await asyncio.wait_for(
                    run_researcher(angle, on_tool), timeout=LAB7_WORKER_TIMEOUT_S
                )
            except asyncio.TimeoutError:
                result = {"summary": "", "findings": [], "tool_calls": [],
                          "error": f"timed out after {LAB7_WORKER_TIMEOUT_S}s"}
            except Exception as exc:  # noqa: BLE001 - one dead worker must not kill the run
                result = {"summary": "", "findings": [], "tool_calls": [], "error": str(exc)}
            ms = round((perf_counter() - t0) * 1000, 1)
            kinds = [tool_label(c)[0] for c in result["tool_calls"]]
            emit(
                {
                    "type": "worker_done",
                    "angle_id": angle["id"],
                    "title": angle["title"],
                    "ms": ms,
                    "searches": kinds.count("search"),
                    "fetches": kinds.count("fetch"),
                    "summary": result["summary"],
                    "findings": result["findings"],
                    "error": result["error"],
                    "cost_usd": result.get("cost_usd", 0.0),
                    "usage": result.get("usage", {}),
                }
            )
            return {"angle_id": angle["id"], "title": angle["title"], **result}

    async def pipeline() -> None:
        t_run = perf_counter()
        agents_used = 0
        tool_calls_total = 0
        cost_total = 0.0
        try:
            # ── Fan-out: parallel researchers, concurrency-capped ──
            angles = plan["angles"]
            emit({"type": "stage", "stage": "research", "status": "start", "workers": len(angles)})
            sem = asyncio.Semaphore(LAB7_WORKER_CONCURRENCY)
            results = await asyncio.gather(*(worker(a, sem) for a in angles))
            agents_used += len(results)
            tool_calls_total += sum(len(r["tool_calls"]) for r in results)
            cost_total += sum(r.get("cost_usd") or 0.0 for r in results)

            # ── Join: one citation space across all workers ──
            sources, findings = dedupe_sources(results)
            emit({"type": "sources", "sources": sources})
            if not findings:
                detail = "; ".join(
                    f"{r['title']}: {r['error']}" for r in results if r.get("error")
                )
                emit(
                    {
                        "type": "done",
                        "error": "No findings were gathered — the brief cannot be written. "
                        + (detail or "The researchers found nothing relevant."),
                        "totals": _totals(t_run, agents_used, tool_calls_total, cost_total),
                    }
                )
                return

            evidence = evidence_table(findings)
            sources_text = source_list(sources)

            # ── Synthesize ──
            emit({"type": "stage", "stage": "synthesize", "status": "start"})
            t0 = perf_counter()
            synth = await synthesize(question, plan.get("synthesis_focus", ""), sources_text, evidence)
            agents_used += 1
            cost_total += synth.get("cost_usd") or 0.0
            if synth["error"]:
                emit({"type": "done", "error": f"Synthesis failed: {synth['error']}",
                      "totals": _totals(t_run, agents_used, tool_calls_total, cost_total)})
                return
            report = synth["report_md"]
            emit({"type": "report", "revision": 1, "report_md": report,
                  "cost_usd": synth.get("cost_usd", 0.0),
                  "ms": round((perf_counter() - t0) * 1000, 1)})

            # ── Verify (adversarial) ──
            emit({"type": "stage", "stage": "verify", "status": "start"})
            t0 = perf_counter()
            verdict = await critique(question, report, evidence)
            agents_used += 1
            cost_total += verdict.get("cost_usd") or 0.0
            emit({"type": "verdict", **verdict, "ms": round((perf_counter() - t0) * 1000, 1)})

            # ── One revision round, only if the critic found real problems ──
            final_md = report
            if verdict["verdict"] == "needs_revision" and verdict["issues"]:
                emit({"type": "stage", "stage": "revise", "status": "start"})
                t0 = perf_counter()
                revised = await synthesize(
                    question, plan.get("synthesis_focus", ""), sources_text, evidence,
                    prior_report=report, issues=verdict["issues"],
                )
                agents_used += 1
                cost_total += revised.get("cost_usd") or 0.0
                if revised["report_md"]:
                    final_md = revised["report_md"]
                    emit({"type": "report", "revision": 2, "report_md": final_md,
                          "cost_usd": revised.get("cost_usd", 0.0),
                          "ms": round((perf_counter() - t0) * 1000, 1)})

            # ── Code-side grounding check on whatever brief the user will read ──
            emit({"type": "citations", **check_citations(final_md, sources)})

            emit({"type": "done", "error": None,
                  "totals": _totals(t_run, agents_used, tool_calls_total, cost_total)})
        except Exception as exc:  # noqa: BLE001 - the stream must always terminate cleanly
            emit({"type": "done", "error": str(exc),
                  "totals": _totals(t_run, agents_used, tool_calls_total, cost_total)})
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


def _totals(t_run: float, agents: int, tool_calls: int, cost_usd: float) -> dict:
    return {
        "ms": round((perf_counter() - t_run) * 1000, 1),
        "agents": agents,
        "tool_calls": tool_calls,
        "cost_usd": round(cost_usd, 4),
    }
