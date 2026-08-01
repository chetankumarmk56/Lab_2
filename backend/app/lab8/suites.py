"""Lab 8 — golden eval suites, loaded from data/lab8/suites/*.json.

A suite file is data, not code: {suite, title, description, target, heavy,
cases: [...]}. Keeping cases in data files is deliberate — reviewing golden
cases is how eval quality is maintained, and a diff on a JSON file is
reviewable in a way hardcoded fixtures are not.
"""
from __future__ import annotations

import json

from ..config import LAB8_SUITES_DIR

REQUIRED_SUITE_KEYS = {"suite", "title", "description", "target", "cases"}


def load_suites() -> dict[str, dict]:
    """All valid suites keyed by name (sorted, deterministic). Bad files skipped."""
    suites: dict[str, dict] = {}
    if not LAB8_SUITES_DIR.exists():
        return suites
    for path in sorted(LAB8_SUITES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict) or not REQUIRED_SUITE_KEYS.issubset(data):
            continue
        cases = [c for c in data.get("cases", []) if isinstance(c, dict) and c.get("id")]
        if not cases:
            continue
        data["cases"] = cases
        data.setdefault("heavy", False)
        suites[data["suite"]] = data
    return suites


def summaries() -> list[dict]:
    """Suite metadata for the UI — everything except the case bodies."""
    out = []
    for suite in load_suites().values():
        out.append(
            {
                "suite": suite["suite"],
                "title": suite["title"],
                "description": suite["description"],
                "target": suite["target"],
                "heavy": bool(suite.get("heavy")),
                "case_count": len(suite["cases"]),
                "case_ids": [c["id"] for c in suite["cases"]],
            }
        )
    return out
