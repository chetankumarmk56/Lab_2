"""Lab 1 — Production Shift Report API.

The agent is file-based (reads current_shift.csv + previous_shift.csv from a
temp dir). The "previous shift" baseline is persisted in Postgres via
`lab1_baseline` so that "Set as previous" survives restarts and redeploys.
"""
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..agents.lab1_shift_report import generate_shift_report
from ..config import DATA_DIR
from ..lab1_baseline import (
    baseline_info_dict,
    get_baseline,
    reset_baseline,
    set_baseline,
    validate_csv,
)

router = APIRouter(prefix="/api/lab1", tags=["Lab 1 — Shift Report"])

LAB1_DATA = DATA_DIR / "lab1"


def _decode(raw: bytes) -> str:
    return raw.decode("utf-8-sig", errors="replace")


@router.post("/generate")
async def generate(file: UploadFile = File(...)):
    """Run the agent on an uploaded shift log, compared against the DB baseline."""
    workdir = Path(tempfile.mkdtemp(prefix="lab1_"))
    try:
        (workdir / "current_shift.csv").write_bytes(await file.read())

        baseline = await get_baseline()
        (workdir / "previous_shift.csv").write_text(baseline["csv_text"], encoding="utf-8")

        result = await generate_shift_report(workdir)
        if result["error"] and not result["result"]:
            raise HTTPException(status_code=502, detail=f"Agent error: {result['error']}")
        result["baseline"] = baseline_info_dict(baseline)
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@router.post("/set-previous")
async def set_previous(file: UploadFile = File(...)):
    """Promote an uploaded shift log to become the new comparison baseline."""
    text = _decode(await file.read())
    err = validate_csv(text)
    if err:
        raise HTTPException(status_code=400, detail=err)
    await set_baseline(text, file.filename or "uploaded shift")
    return {"ok": True, "baseline": baseline_info_dict(await get_baseline())}


@router.post("/reset-previous")
async def reset_previous():
    """Restore the original seeded sample as the baseline."""
    await reset_baseline()
    return {"ok": True, "baseline": baseline_info_dict(await get_baseline())}


@router.get("/baseline-info")
async def baseline_info():
    """Metadata about the current baseline (source, readings, lines, time span)."""
    return {"baseline": baseline_info_dict(await get_baseline())}


@router.get("/sample")
async def sample():
    """Download a sample current-shift log to try the lab with."""
    return FileResponse(
        LAB1_DATA / "sample_current_shift.csv",
        media_type="text/csv",
        filename="sample_current_shift.csv",
    )
