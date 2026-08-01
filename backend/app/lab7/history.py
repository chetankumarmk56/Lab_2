"""Lab 7 — run recording and replay.

Every streamed run is teed to a JSONL file: line 1 is the `run_meta` event,
then one line per event with its elapsed-ms offset:

    {"t": 1834.2, "event": {"type": "worker_done", ...}}

That's enough to (a) list past runs with their outcome and cost, and (b)
replay a run in the UI with its original pacing — a free, offline,
deterministic demo of a run that actually happened. Recording must never be
able to break a live stream, so every write failure is swallowed after one
log line.
"""
from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import datetime, timezone
from time import perf_counter

from ..config import LAB7_RUNS_DIR

log = logging.getLogger(__name__)

_RUN_ID_RE = re.compile(r"^[a-z0-9-]{8,64}$")


def new_run_id(mode: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{mode}-{secrets.token_hex(2)}"


def _path(run_id: str):
    if not _RUN_ID_RE.fullmatch(run_id or ""):
        raise ValueError("Invalid run id.")
    return LAB7_RUNS_DIR / f"{run_id}.jsonl"


def meta_event(run_id: str, mode: str, question: str) -> dict:
    return {
        "type": "run_meta",
        "run_id": run_id,
        "mode": mode,
        "question": question,
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


class RunRecorder:
    """Append-only, flush-per-event, failure-proof event tee."""

    def __init__(self, run_id: str) -> None:
        self.t0 = perf_counter()
        self._fh = None
        self._warned = False
        try:
            LAB7_RUNS_DIR.mkdir(parents=True, exist_ok=True)
            self._fh = open(_path(run_id), "a", encoding="utf-8")  # noqa: SIM115
        except Exception:  # noqa: BLE001 - recording is best-effort
            log.exception("Lab 7: could not open run recording file")

    def write(self, event: dict) -> None:
        if self._fh is None:
            return
        try:
            line = json.dumps(
                {"t": round((perf_counter() - self.t0) * 1000, 1), "event": event},
                default=str,
            )
            self._fh.write(line + "\n")
            self._fh.flush()
        except Exception:  # noqa: BLE001
            if not self._warned:
                self._warned = True
                log.exception("Lab 7: run recording write failed (continuing)")

    def close(self) -> None:
        if self._fh is not None:
            try:
                self._fh.close()
            except Exception:  # noqa: BLE001
                pass
            self._fh = None


def list_runs(limit: int = 50) -> list[dict]:
    """Newest-first summaries: meta + outcome (done totals) + report presence."""
    if not LAB7_RUNS_DIR.exists():
        return []
    summaries: list[dict] = []
    for path in sorted(LAB7_RUNS_DIR.glob("*.jsonl"), reverse=True)[:limit]:
        try:
            meta: dict | None = None
            done: dict | None = None
            has_report = False
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    event = json.loads(line).get("event") or {}
                    kind = event.get("type")
                    if kind == "run_meta" and meta is None:
                        meta = event
                    elif kind == "report":
                        has_report = True
                    elif kind == "done":
                        done = event
            if meta is None:
                continue
            summaries.append(
                {
                    "run_id": meta["run_id"],
                    "mode": meta.get("mode", "planned"),
                    "question": meta.get("question", ""),
                    "started_at": meta.get("started_at"),
                    "finished": done is not None,
                    "ok": bool(done) and not done.get("error"),
                    "error": (done or {}).get("error"),
                    "totals": (done or {}).get("totals"),
                    "has_report": has_report,
                }
            )
        except Exception:  # noqa: BLE001 - one corrupt file must not hide the rest
            log.warning("Lab 7: skipping unreadable run file %s", path.name)
    return summaries


def load_run(run_id: str) -> list[dict] | None:
    """The full recorded stream: [{t, event}, ...] — or None if unknown."""
    path = _path(run_id)
    if not path.exists():
        return None
    entries: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                row = json.loads(line)
                entries.append({"t": row.get("t", 0), "event": row.get("event") or {}})
            except json.JSONDecodeError:
                continue  # a torn final line from a crashed run is fine
    return entries


def delete_run(run_id: str) -> bool:
    path = _path(run_id)
    if not path.exists():
        return False
    path.unlink()
    return True
