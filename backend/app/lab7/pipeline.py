"""Lab 7 — pure pipeline helpers (no models, no I/O; unit-tested offline).

Everything here is deterministic glue between agent turns: parsing the JSON an
agent returns, validating/normalizing the human-approved plan, and assigning
stable citation numbers to sources across all researchers' findings.
"""
from __future__ import annotations

import json
import re

_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|```\s*$", re.MULTILINE)


def parse_json_block(text: str) -> dict:
    """Parse a JSON object out of an agent's reply, tolerating fences/preamble.

    Raises ValueError when no JSON object can be recovered — callers surface
    that as the agent's error rather than crashing the pipeline.
    """
    cleaned = _FENCE_RE.sub("", text or "").strip()
    try:
        value = json.loads(cleaned)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if 0 <= start < end:
        try:
            value = json.loads(cleaned[start : end + 1])
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass
    raise ValueError("The agent did not return a parseable JSON object.")


def validate_plan(plan: dict, max_breadth: int) -> dict:
    """Normalize a plan (from the planner or echoed back after human approval).

    Guarantees: 1..max_breadth angles, sequential ids, non-empty title/objective,
    1-4 queries per angle. Raises ValueError on anything unrecoverable — the
    approval gate only runs plans that pass this.
    """
    if not isinstance(plan, dict):
        raise ValueError("Plan must be an object.")
    raw_angles = plan.get("angles")
    if not isinstance(raw_angles, list) or not raw_angles:
        raise ValueError("Plan has no research angles.")

    angles: list[dict] = []
    for raw in raw_angles:
        if len(angles) == max_breadth:   # clamp on VALID angles — junk entries don't eat slots
            break
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        objective = str(raw.get("objective") or "").strip()
        if not title or not objective:
            continue
        queries = [str(q).strip() for q in (raw.get("queries") or []) if str(q).strip()]
        if not queries:
            queries = [title]
        angles.append(
            {
                "id": len(angles) + 1,
                "title": title,
                "objective": objective,
                "queries": queries[:4],
            }
        )
    if not angles:
        raise ValueError("No valid research angles in the plan.")

    return {
        "restated_goal": str(plan.get("restated_goal") or "").strip(),
        "synthesis_focus": str(plan.get("synthesis_focus") or "").strip(),
        "angles": angles,
    }


def dedupe_sources(worker_results: list[dict]) -> tuple[list[dict], list[dict]]:
    """Assign stable citation numbers across every researcher's findings.

    Input: worker results ({angle_id, title, findings: [{claim, url, source_title,
    quote}]}). The same URL cited by two researchers gets ONE number — that
    cross-referencing is half the point of parallel research.

    Returns (sources, findings_numbered):
      sources:            [{n, title, url}] in first-appearance order
      findings_numbered:  the findings flattened, each with its source `n`
    """
    sources: list[dict] = []
    by_url: dict[str, int] = {}
    numbered: list[dict] = []
    for result in worker_results:
        for finding in result.get("findings") or []:
            url = str(finding.get("url") or "").strip()
            if not url:
                continue
            if url not in by_url:
                by_url[url] = len(sources) + 1
                sources.append(
                    {
                        "n": by_url[url],
                        "title": str(finding.get("source_title") or url).strip() or url,
                        "url": url,
                    }
                )
            numbered.append(
                {
                    "n": by_url[url],
                    "angle_id": result.get("angle_id"),
                    "angle_title": result.get("title", ""),
                    "claim": str(finding.get("claim") or "").strip(),
                    "quote": str(finding.get("quote") or "").strip(),
                    "url": url,
                }
            )
    return sources, numbered


def evidence_table(findings_numbered: list[dict]) -> str:
    """The findings as a compact numbered table for the synthesizer/critic."""
    lines: list[str] = []
    current_angle = None
    for f in findings_numbered:
        if f["angle_title"] != current_angle:
            current_angle = f["angle_title"]
            lines.append(f"\nAngle: {current_angle}")
        quote = f' — "{f["quote"]}"' if f["quote"] else ""
        lines.append(f"[{f['n']}] {f['claim']}{quote}")
    return "\n".join(lines).strip()


def source_list(sources: list[dict]) -> str:
    return "\n".join(f"[{s['n']}] {s['title']} — {s['url']}" for s in sources)


_CITATION_RE = re.compile(r"\[(\d{1,2})\]")


def check_citations(report_md: str, sources: list[dict]) -> dict:
    """Code-side grounding check on the final brief: every [n] must exist.

    Returns {cited, invalid, total_sources} — `invalid` non-empty means the
    writer cited a source number nobody provided (the UI flags it).
    """
    valid = {s["n"] for s in sources}
    cited = sorted({int(m) for m in _CITATION_RE.findall(report_md or "")})
    return {
        "cited": [n for n in cited if n in valid],
        "invalid": [n for n in cited if n not in valid],
        "total_sources": len(sources),
    }
