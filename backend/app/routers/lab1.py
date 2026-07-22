"""Lab 1 — Production Shift Report API.

The agent is file-based (reads current_shift.csv + previous_shift.csv from a
temp dir). The "previous shift" baseline is persisted in Postgres via
`lab1_baseline` so that "Set as previous" survives restarts and redeploys.
"""
import datetime as dt
import random
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from ..agents.lab1_shift_report import generate_shift_report
from ..lab1_baseline import (
    baseline_info_dict,
    get_baseline,
    reset_baseline,
    set_baseline,
    validate_csv,
)

router = APIRouter(prefix="/api/lab1", tags=["Lab 1 — Shift Report"])

LINES = ["Line-1", "Line-2", "Line-3"]
_LINE_BASE = {"Line-1": 74, "Line-2": 70, "Line-3": 68}


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


def _generate_sample_csv() -> str:
    """A fresh, randomized current-shift log — different on every call. ~65% of
    the time it seeds an anomaly on a random line (output collapse + downtime and
    defect spikes) so the report's Exceptions section has something to flag."""
    hours = 4
    start = dt.datetime.now().replace(minute=0, second=0, microsecond=0) - dt.timedelta(hours=hours)
    anomaly_line = random.choice(LINES) if random.random() < 0.65 else None
    anomaly_hours = set(random.sample(range(hours), k=2)) if anomaly_line else set()

    rows = ["timestamp,line,units_produced,downtime_minutes,defects"]
    for line in LINES:
        base = _LINE_BASE[line]
        for h in range(hours):
            ts = (start + dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M")
            if line == anomaly_line and h in anomaly_hours:
                units, downtime, defects = random.randint(15, 40), random.randint(20, 45), random.randint(7, 15)
            else:
                units, downtime, defects = base + random.randint(-4, 6), random.randint(0, 6), random.randint(0, 3)
            rows.append(f"{ts},{line},{units},{downtime},{defects}")
    return "\n".join(rows) + "\n"


@router.get("/sample")
async def sample():
    """Download a fresh, randomized sample current-shift log (different each time)."""
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    return Response(
        content=_generate_sample_csv(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="sample_shift_{stamp}-{random.randint(1000, 9999)}.csv"',
            "Cache-Control": "no-store",
        },
    )
