"""Lab 1 — deployment-safe "previous shift" baseline store.

Lab 1 stays file-based for the AGENT: it still reads `current_shift.csv` and
`previous_shift.csv` from a temp working directory (Claude Code fundamentals,
no MCP). Only the *source* of the baseline changes — instead of a mutable file
on disk (which does not survive serverless/ephemeral/multi-instance deploys),
the active baseline is persisted in Postgres.

The pristine seeded sample lives at `data/lab1/previous_shift.csv` (read-only)
and is used both to initialize the baseline on first use and to restore it on
reset.

Sync psycopg + asyncio.to_thread — matches the rest of the backend (async
psycopg is incompatible with the Windows Proactor loop the Agent SDK requires).
"""
import asyncio
import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

import psycopg

from .config import DATABASE_URL, DATA_DIR

SEED_FILE = DATA_DIR / "lab1" / "previous_shift.csv"
REQUIRED_COLUMNS = ["timestamp", "line", "units_produced", "downtime_minutes", "defects"]
_SLOT = "previous"

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS lab1_baseline (
    slot        TEXT PRIMARY KEY,
    csv_text    TEXT NOT NULL,
    source_name TEXT NOT NULL,
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
)
"""


def _cell(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _seed_text() -> str:
    """The original shipped baseline (read-only). Falls back to a bare header."""
    try:
        return SEED_FILE.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return ",".join(REQUIRED_COLUMNS) + "\n"


def validate_csv(csv_text: str) -> Optional[str]:
    """Return an error message if `csv_text` isn't a usable shift log, else None."""
    reader = csv.reader(io.StringIO(csv_text))
    try:
        header = next(reader)
    except StopIteration:
        return "The file is empty."
    cols = {c.strip().lower() for c in header}
    missing = [c for c in REQUIRED_COLUMNS if c not in cols]
    if missing:
        return f"Missing required column(s): {', '.join(missing)}."
    if not any(any(cell.strip() for cell in row) for row in reader):
        return "The file has a header row but no data rows."
    return None


def _summarize(csv_text: str) -> dict:
    """Light metadata for the UI: reading count, distinct lines, time span."""
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = 0
    lines: set[str] = set()
    stamps: list[str] = []
    for r in reader:
        rows += 1
        line = (r.get("line") or "").strip()
        if line:
            lines.add(line)
        ts = (r.get("timestamp") or "").strip()
        if ts:
            stamps.append(ts)
    span = None
    if stamps:
        stamps.sort()
        span = {"start": stamps[0], "end": stamps[-1]}
    return {"row_count": rows, "line_count": len(lines), "span": span}


def baseline_info_dict(baseline: dict) -> dict:
    """Public metadata (never includes the full CSV text)."""
    return {
        "source_name": baseline["source_name"],
        "updated_at": _cell(baseline["updated_at"]),
        **_summarize(baseline["csv_text"]),
    }


# ─────────────────────── sync DB ops ───────────────────────
def _get_sync() -> dict:
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE)
            cur.execute(
                "SELECT csv_text, source_name, updated_at FROM lab1_baseline WHERE slot = %s",
                (_SLOT,),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "INSERT INTO lab1_baseline (slot, csv_text, source_name) VALUES (%s, %s, %s) "
                    "ON CONFLICT (slot) DO NOTHING",
                    (_SLOT, _seed_text(), "seeded sample"),
                )
                cur.execute(
                    "SELECT csv_text, source_name, updated_at FROM lab1_baseline WHERE slot = %s",
                    (_SLOT,),
                )
                row = cur.fetchone()
    finally:
        conn.close()
    csv_text, source_name, updated_at = row
    return {"csv_text": csv_text, "source_name": source_name, "updated_at": updated_at}


def _set_sync(csv_text: str, source_name: str) -> None:
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE)
            cur.execute(
                "INSERT INTO lab1_baseline (slot, csv_text, source_name, updated_at) "
                "VALUES (%s, %s, %s, now()) "
                "ON CONFLICT (slot) DO UPDATE SET "
                "csv_text = EXCLUDED.csv_text, source_name = EXCLUDED.source_name, updated_at = now()",
                (_SLOT, csv_text, source_name),
            )
    finally:
        conn.close()


def _reset_sync() -> None:
    _set_sync(_seed_text(), "seeded sample")


# ─────────────────────── async wrappers ───────────────────────
async def get_baseline() -> dict:
    return await asyncio.to_thread(_get_sync)


async def set_baseline(csv_text: str, source_name: str) -> None:
    await asyncio.to_thread(_set_sync, csv_text, source_name)


async def reset_baseline() -> None:
    await asyncio.to_thread(_reset_sync)
