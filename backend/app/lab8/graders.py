"""Lab 8 — graders.

Deterministic graders are the backbone: free, instant, unarguable. The one
LLM-as-judge grader is opt-in per run, and it must return its *reasoning* —
a verdict without visible reasoning is not evidence.

Every grader returns a check dict: {"name", "pass", "detail"}.
"""
from __future__ import annotations

import re

from claude_agent_sdk import ClaudeAgentOptions

from ..config import CLAUDE_MODEL
from ..lab7.pipeline import parse_json_block
from ..lab7.runner import stream_agent


def check(name: str, ok: bool, detail: str) -> dict:
    return {"name": name, "pass": bool(ok), "detail": detail}


# ── SQL execution-match ──────────────────────────────────────────────

def _normalize_cell(value) -> object:
    """Make cells comparable across equivalent queries: numbers to rounded
    floats (SUM/AVG precision), strings trimmed."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 6)
    if isinstance(value, str):
        stripped = value.strip()
        try:
            return round(float(stripped), 6)
        except ValueError:
            return stripped
    return value


def compare_result_sets(golden_rows: list[list], actual_rows: list[list]) -> dict:
    """Order-insensitive multiset comparison of two result sets.

    Row ORDER never matters (a question that doesn't specify an order has no
    right order); row CONTENT and shape do.
    """
    def canon(rows: list[list]) -> list[tuple]:
        return sorted(tuple(_normalize_cell(v) for v in row) for row in rows)

    if golden_rows and actual_rows and len(golden_rows[0]) != len(actual_rows[0]):
        return check(
            "result_match", False,
            f"column count differs: golden {len(golden_rows[0])}, agent {len(actual_rows[0])}",
        )
    golden, actual = canon(golden_rows), canon(actual_rows)
    if golden == actual:
        return check("result_match", True, f"{len(actual)} row(s) match the golden result")
    return check(
        "result_match", False,
        f"result sets differ: golden {golden[:3]}…, agent {actual[:3]}…"
        if len(golden) > 3 or len(actual) > 3
        else f"golden {golden}, agent {actual}",
    )


# ── Text containment / refusal / citations ──────────────────────────

def contains_all(answer: str, needles: list[str]) -> dict:
    missing = [n for n in needles if n.lower() not in (answer or "").lower()]
    if missing:
        return check("contains_expected", False, f"missing: {missing}")
    return check("contains_expected", True, f"all {len(needles)} expected fact(s) present")


def refusal_check(refused: bool, expected: bool) -> dict:
    if expected:
        return check("refused_correctly", refused,
                     "refused as required" if refused else "answered a question the corpus/policy does not cover")
    return check("did_not_refuse", not refused,
                 "answered normally" if not refused else "refused a legitimate question")


_CITE_RE = re.compile(r"\[(\d{1,2})\]")


def citations_valid(answer: str, n_sources: int) -> dict:
    cited = sorted({int(m) for m in _CITE_RE.findall(answer or "")})
    invalid = [n for n in cited if n < 1 or n > n_sources]
    if invalid:
        return check("citations_valid", False, f"cites nonexistent source number(s) {invalid}")
    return check("citations_valid", True, f"cites {len(cited)} of {n_sources} available sources")


def within(name: str, value: float, ceiling: float, unit: str) -> dict:
    return check(name, value <= ceiling, f"{value:.2f}{unit} (ceiling {ceiling:.2f}{unit})")


# ── LLM-as-judge (opt-in) ────────────────────────────────────────────

JUDGE_SYSTEM = """You are a strict evaluation judge. You are given a question, the CONTEXT an
assistant was allowed to use, and the assistant's ANSWER. Judge FAITHFULNESS
only: is every factual claim in the answer supported by the context? Wrong or
unsupported facts are failures; awkward style is not.

Output ONLY this JSON object:
{"score": 0-10, "verdict": "pass" | "fail", "reasoning": "<=40 words, name the decisive claim"}

Scoring: 10 = fully supported; subtract for each unsupported or contradicted
claim; verdict is "pass" only when score >= 7 and no fabricated numbers exist.
"""


async def judge_faithfulness(question: str, context_text: str, answer: str) -> tuple[dict, float]:
    """Returns (check, cost_usd). The judge's reasoning goes into the detail —
    a verdict you can't inspect is not evidence."""
    options = ClaudeAgentOptions(
        system_prompt=JUDGE_SYSTEM,
        model=CLAUDE_MODEL,
        tools=[],
        allowed_tools=[],
        permission_mode="bypassPermissions",
        setting_sources=[],
    )
    prompt = f"QUESTION:\n{question}\n\nCONTEXT:\n{context_text}\n\nANSWER:\n{answer}"
    result = await stream_agent(prompt, options)
    cost = result.get("cost_usd", 0.0)
    if result["error"]:
        return check("judge_faithful", False, f"judge failed to run: {result['error']}"), cost
    try:
        payload = parse_json_block(result["result"])
    except ValueError:
        return check("judge_faithful", False, "judge returned unparseable output"), cost
    score = payload.get("score")
    verdict = str(payload.get("verdict", "")).lower()
    reasoning = str(payload.get("reasoning", "")).strip()
    ok = verdict == "pass"
    return check("judge_faithful", ok, f"score {score}/10 — {reasoning}"), cost
