"""Lab 8 — stored eval-run results.

One JSON file per run under data/lab8/results/. Stored summaries power three
things the live stream can't: the run-history table, the regression diff
(this run vs the previous run of the same suite), and the model×suite matrix
aggregated across history.
"""
from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import datetime, timezone

from ..config import LAB8_RESULTS_DIR

log = logging.getLogger(__name__)

_RUN_ID_RE = re.compile(r"^[a-z0-9-]{8,64}$")


def new_run_id() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}-eval-{secrets.token_hex(2)}"


def _path(run_id: str):
    if not _RUN_ID_RE.fullmatch(run_id or ""):
        raise ValueError("Invalid run id.")
    return LAB8_RESULTS_DIR / f"{run_id}.json"


def save_run(summary: dict) -> None:
    try:
        LAB8_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        _path(summary["run_id"]).write_text(
            json.dumps(summary, indent=1, default=str), encoding="utf-8"
        )
    except Exception:  # noqa: BLE001 - storing results must never fail a run
        log.exception("Lab 8: could not store eval results")


def list_runs(limit: int = 100) -> list[dict]:
    """Newest-first stored runs (full detail — files are small)."""
    if not LAB8_RESULTS_DIR.exists():
        return []
    runs: list[dict] = []
    for path in sorted(LAB8_RESULTS_DIR.glob("*.json"), reverse=True)[:limit]:
        try:
            runs.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            log.warning("Lab 8: skipping unreadable results file %s", path.name)
    return runs


def load_run(run_id: str) -> dict | None:
    path = _path(run_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def delete_run(run_id: str) -> bool:
    path = _path(run_id)
    if not path.exists():
        return False
    path.unlink()
    return True


def regression_diff(current: dict, previous: dict | None) -> dict | None:
    """Per-case comparison on (suite, case_id) shared by both runs.

    regressions = passed before, fails now; fixes = the reverse. This is the
    payoff of storing runs: an eval without a diff is just a screenshot.
    """
    if previous is None:
        return None

    def outcomes(run: dict) -> dict[tuple[str, str], bool]:
        out: dict[tuple[str, str], bool] = {}
        for suite in run.get("suites", []):
            for case in suite.get("cases", []):
                out[(suite["suite"], case["case_id"])] = bool(case.get("pass"))
        return out

    cur, prev = outcomes(current), outcomes(previous)
    shared = cur.keys() & prev.keys()
    regressions = sorted(f"{s}/{c}" for (s, c) in shared if prev[(s, c)] and not cur[(s, c)])
    fixes = sorted(f"{s}/{c}" for (s, c) in shared if not prev[(s, c)] and cur[(s, c)])
    return {
        "compared_to": previous.get("run_id"),
        "compared_model": previous.get("model"),
        "shared_cases": len(shared),
        "regressions": regressions,
        "fixes": fixes,
    }


def find_previous(suite_names: list[str], before_run_id: str) -> dict | None:
    """Most recent stored run (excluding this one) covering any of these suites."""
    wanted = set(suite_names)
    for run in list_runs():
        if run.get("run_id") == before_run_id:
            continue
        covered = {s.get("suite") for s in run.get("suites", [])}
        if covered & wanted:
            return run
    return None
