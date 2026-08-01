"""Lab 8 — Eval Harness API.

Suites are data, runs stream live (NDJSON, same pattern as Labs 2/7), and
every finished run is stored so history, regression diffs, and the
model×suite matrix survive restarts.
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import CLAUDE_MODEL
from ..lab8 import results
from ..lab8.runner import run_evals
from ..lab8.suites import load_suites, summaries

router = APIRouter(prefix="/api/lab8", tags=["Lab 8 — Eval Harness"])

# Model tiers offered for comparison runs (plus the configured default).
MODEL_OPTIONS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"]


class RunRequest(BaseModel):
    suites: list[str] = Field(min_length=1)
    model: str | None = None
    judge: bool = False


@router.get("/suites")
async def get_suites():
    return {
        "suites": summaries(),
        "configured_model": CLAUDE_MODEL,
        "model_options": MODEL_OPTIONS,
    }


@router.post("/run/stream")
async def run_stream(body: RunRequest):
    catalog = load_suites()
    unknown = [s for s in body.suites if s not in catalog]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown suite(s): {unknown}")
    if body.model is not None and body.model not in MODEL_OPTIONS:
        raise HTTPException(status_code=400, detail=f"Model must be one of {MODEL_OPTIONS} (or omitted).")

    async def events():
        async for event in run_evals(body.suites, body.model, body.judge):
            yield json.dumps(event, default=str) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/results")
async def get_results():
    return {"runs": await asyncio.to_thread(results.list_runs)}


@router.get("/results/{run_id}")
async def get_result(run_id: str):
    try:
        run = await asyncio.to_thread(results.load_run, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if run is None:
        raise HTTPException(status_code=404, detail=f"No stored eval run '{run_id}'.")
    return run


@router.delete("/results/{run_id}")
async def remove_result(run_id: str):
    try:
        removed = await asyncio.to_thread(results.delete_run, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail=f"No stored eval run '{run_id}'.")
    return {"ok": True}
