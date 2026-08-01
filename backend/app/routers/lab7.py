"""Lab 7 — Deep Research (orchestration) API.

Two-step by design: `/plan` costs one model call and returns the decomposition;
nothing else runs until the human approves (and optionally trims) the plan and
posts it back to `/run/stream`. The run streams NDJSON events — worker
lifecycle, live tool calls, sources, draft, verdict, revision — so the frontend
renders the orchestration as it happens.
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..agents.lab7_research import make_plan
from ..config import (
    CLAUDE_MODEL,
    LAB7_DYN_MAX_RESEARCHERS,
    LAB7_DYN_MAX_TURNS,
    LAB7_MAX_BREADTH,
    LAB7_RESEARCHER_MODEL,
    LAB7_WORKER_CONCURRENCY,
    LAB7_WORKER_MAX_TURNS,
)
from ..lab7 import history
from ..lab7.dynamic import run_dynamic
from ..lab7.orchestrator import run_research
from ..lab7.pipeline import validate_plan

router = APIRouter(prefix="/api/lab7", tags=["Lab 7 — Deep Research (Orchestration)"])


class PlanRequest(BaseModel):
    question: str
    breadth: int = Field(default=3, ge=2, le=4)


class RunRequest(BaseModel):
    question: str
    plan: dict


@router.get("/config")
async def config():
    """Model tiering + safety caps — the UI displays these as talking points."""
    return {
        "orchestrator_model": CLAUDE_MODEL,
        "researcher_model": LAB7_RESEARCHER_MODEL,
        "max_breadth": LAB7_MAX_BREADTH,
        "worker_concurrency": LAB7_WORKER_CONCURRENCY,
        "worker_max_turns": LAB7_WORKER_MAX_TURNS,
        "dyn_max_researchers": LAB7_DYN_MAX_RESEARCHERS,
        "dyn_max_turns": LAB7_DYN_MAX_TURNS,
    }


@router.post("/plan")
async def plan(body: PlanRequest):
    """Stage 1: one planning turn. Nothing executes until the plan is approved."""
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")
    result = await make_plan(question, body.breadth)
    cost = result.get("cost_usd", 0.0)
    if result["error"]:
        return {"plan": None, "error": result["error"], "cost_usd": cost}
    try:
        normalized = validate_plan(result["plan"], LAB7_MAX_BREADTH)
    except ValueError as exc:
        return {"plan": None, "error": f"Planner produced an invalid plan: {exc}", "cost_usd": cost}
    return {"plan": normalized, "error": None, "cost_usd": cost}


@router.post("/run/stream")
async def run_stream(body: RunRequest):
    """Stage 2: execute the approved plan; NDJSON event stream."""
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")
    try:
        approved = validate_plan(body.plan, LAB7_MAX_BREADTH)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {exc}") from exc

    run_id = history.new_run_id("planned")
    meta = history.meta_event(run_id, "planned", question)

    async def events():
        recorder = history.RunRecorder(run_id)
        try:
            recorder.write(meta)
            yield json.dumps(meta, default=str) + "\n"
            async for event in run_research(question, approved):
                recorder.write(event)
                yield json.dumps(event, default=str) + "\n"
        finally:
            recorder.close()

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class DynamicRunRequest(BaseModel):
    question: str
    max_researchers: int | None = Field(default=None, ge=1, le=8)


@router.post("/run-dynamic/stream")
async def run_dynamic_stream(body: DynamicRunRequest):
    """Agent-loop mode: no pre-plan — the lead agent decides everything inside
    code-owned rails (researcher budget, turn cap, verified-finalize gate).
    `max_researchers` lowers this run's budget so the rail can be demoed live."""
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    run_id = history.new_run_id("loop")
    meta = history.meta_event(run_id, "loop", question)

    async def events():
        recorder = history.RunRecorder(run_id)
        try:
            recorder.write(meta)
            yield json.dumps(meta, default=str) + "\n"
            async for event in run_dynamic(question, body.max_researchers):
                recorder.write(event)
                yield json.dumps(event, default=str) + "\n"
        finally:
            recorder.close()

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs")
async def runs():
    """Past runs, newest first — every run is recorded and replayable."""
    return {"runs": await asyncio.to_thread(history.list_runs)}


@router.get("/runs/{run_id}")
async def run_events(run_id: str):
    """The full recorded event stream of one run (for offline replay)."""
    try:
        entries = await asyncio.to_thread(history.load_run, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if entries is None:
        raise HTTPException(status_code=404, detail=f"No recorded run '{run_id}'.")
    return {"run_id": run_id, "events": entries}


@router.delete("/runs/{run_id}")
async def remove_run(run_id: str):
    try:
        removed = await asyncio.to_thread(history.delete_run, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail=f"No recorded run '{run_id}'.")
    return {"ok": True}
