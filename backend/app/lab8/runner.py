"""Lab 8 — the eval runner: sequential, streaming, stored, diffed.

Cases run sequentially (kind to rate limits, deterministic ordering); each
case's checks, cost, and duration stream to the UI as they land. When the run
finishes, the summary is stored and compared against the previous stored run
covering the same suites — the regression diff is part of the run, not an
afterthought.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from time import perf_counter

from ..config import CLAUDE_MODEL
from . import adapters, graders, results
from .suites import load_suites

log = logging.getLogger(__name__)


async def _lab2_case(case: dict, model: str | None) -> tuple[list[dict], float, str]:
    out = await adapters.run_lab2_case(case["question"], model)
    cost = out["cost_usd"]
    if out["error"]:
        return [graders.check("agent_ran", False, out["error"])], cost, out["answer"] or ""

    if case.get("type") == "refusal":
        checks = [
            graders.refusal_check(out["refused"], expected=True),
            graders.check(
                "no_sql_executed", out["sql_count"] == 0,
                "no tool calls" if out["sql_count"] == 0 else f"{out['sql_count']} SQL call(s) made",
            ),
        ]
        return checks, cost, out["answer"] or ""

    checks = [graders.check("sql_produced", out["sql"] is not None, out["sql"] or "no run_select call")]
    if out["sql"] is None:
        return checks, cost, out["answer"] or ""
    golden = await adapters.execute_sql(case["golden_sql"])
    if not golden.get("ok"):
        checks.append(graders.check("golden_executes", False, f"golden SQL failed: {golden.get('error')}"))
        return checks, cost, out["answer"] or ""
    actual = await adapters.execute_sql(out["sql"])
    if not actual.get("ok"):
        checks.append(graders.check("agent_sql_executes", False, f"agent SQL failed: {actual.get('error')}"))
        return checks, cost, out["answer"] or ""
    checks.append(graders.check("agent_sql_executes", True, "executed cleanly"))
    checks.append(graders.compare_result_sets(golden["rows"], actual["rows"]))
    return checks, cost, out["answer"] or ""


async def _lab6_case(case: dict, model: str | None, judge: bool) -> tuple[list[dict], float, str]:
    if case.get("type") == "retrieval":
        out = await adapters.run_lab6_retrieval_case(case["question"])
        ok = case["expect_doc"] in out["selected_docs"]
        return (
            [graders.check("expected_doc_retrieved", ok,
                           f"expected {case['expect_doc']}; top-k docs: {out['selected_docs']}")],
            0.0,
            "",
        )

    out = await adapters.run_lab6_answer_case(case["question"], model)
    cost = out["cost_usd"]
    if out["error"]:
        return [graders.check("agent_ran", False, out["error"])], cost, out["answer"] or ""
    expect_refusal = bool(case.get("expect_refusal"))
    checks = [graders.refusal_check(out["refused"], expect_refusal)]
    if not expect_refusal:
        checks.append(graders.contains_all(out["answer"] or "", case.get("expect_contains", [])))
        checks.append(graders.citations_valid(out["answer"] or "", out["n_sources"]))
        if judge and out["answer"]:
            judge_check, judge_cost = await graders.judge_faithfulness(
                case["question"], out["context_text"], out["answer"]
            )
            checks.append(judge_check)
            cost += judge_cost
    return checks, cost, out["answer"] or "(refused)"


async def _lab7_case(case: dict) -> tuple[list[dict], float, str]:
    out = await adapters.run_lab7_case(case["question"], int(case.get("breadth", 2)))
    checks = [graders.check("brief_produced", bool(out["report_md"]), out["error"] or "brief present")]
    if out["report_md"]:
        citations = out["citations"]
        checks.append(
            graders.check(
                "citations_valid",
                citations is not None and not citations.get("invalid"),
                f"invalid: {citations.get('invalid')}" if citations else "no citation data emitted",
            )
        )
        checks.append(
            graders.check(
                "min_sources",
                out["sources"] >= int(case.get("min_sources", 1)),
                f"{out['sources']} sources (min {case.get('min_sources', 1)})",
            )
        )
        checks.append(graders.within("cost_within", out["cost_usd"], float(case.get("max_cost_usd", 5.0)), "$"))
        checks.append(graders.within("time_within", out["seconds"], float(case.get("max_seconds", 600)), "s"))
    return checks, out["cost_usd"], (out["report_md"] or "")[:400]


async def _run_case(target: str, case: dict, model: str | None, judge: bool) -> tuple[list[dict], float, str]:
    if target == "lab2":
        return await _lab2_case(case, model)
    if target == "lab6":
        return await _lab6_case(case, model, judge)
    if target == "lab7":
        return await _lab7_case(case)
    raise ValueError(f"Unknown eval target '{target}'")


async def run_evals(selected: list[str], model: str | None, judge: bool) -> AsyncIterator[dict]:
    """Run the selected suites, yielding NDJSON-ready events."""
    run_id = results.new_run_id()
    catalog = load_suites()
    chosen = [catalog[name] for name in selected if name in catalog]
    effective_model = model or CLAUDE_MODEL
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    yield {
        "type": "run_meta",
        "run_id": run_id,
        "model": effective_model,
        "model_overridden": bool(model),
        "judge": judge,
        "suites": [s["suite"] for s in chosen],
        "started_at": started_at,
    }

    t_run = perf_counter()
    stored_suites: list[dict] = []
    totals = {"cases": 0, "passed": 0, "failed": 0, "cost_usd": 0.0}

    for suite in chosen:
        yield {"type": "suite_start", "suite": suite["suite"], "title": suite["title"],
               "cases": len(suite["cases"])}
        suite_t0 = perf_counter()
        case_records: list[dict] = []
        for case in suite["cases"]:
            yield {"type": "case_start", "suite": suite["suite"], "case_id": case["id"],
                   "question": case.get("question", "")}
            t0 = perf_counter()
            try:
                checks, cost, preview = await _run_case(suite["target"], case, model, judge)
            except Exception as exc:  # noqa: BLE001 - one broken case must not end the run
                log.exception("Lab 8 case crashed: %s/%s", suite["suite"], case["id"])
                checks, cost, preview = [graders.check("case_ran", False, f"crashed: {exc}")], 0.0, ""
            passed = all(c["pass"] for c in checks)
            record = {
                "case_id": case["id"],
                "question": case.get("question", ""),
                "pass": passed,
                "checks": checks,
                "cost_usd": round(cost, 4),
                "ms": round((perf_counter() - t0) * 1000, 1),
                "preview": (preview or "")[:400],
            }
            case_records.append(record)
            totals["cases"] += 1
            totals["passed" if passed else "failed"] += 1
            totals["cost_usd"] = round(totals["cost_usd"] + cost, 4)
            yield {"type": "case_done", "suite": suite["suite"], **record}

        suite_record = {
            "suite": suite["suite"],
            "title": suite["title"],
            "passed": sum(1 for c in case_records if c["pass"]),
            "failed": sum(1 for c in case_records if not c["pass"]),
            "cost_usd": round(sum(c["cost_usd"] for c in case_records), 4),
            "ms": round((perf_counter() - suite_t0) * 1000, 1),
            "cases": case_records,
        }
        stored_suites.append(suite_record)
        yield {"type": "suite_done", **{k: v for k, v in suite_record.items() if k != "cases"}}

    summary = {
        "run_id": run_id,
        "started_at": started_at,
        "model": effective_model,
        "model_overridden": bool(model),
        "judge": judge,
        "totals": {**totals, "ms": round((perf_counter() - t_run) * 1000, 1)},
        "suites": stored_suites,
    }
    previous = results.find_previous([s["suite"] for s in chosen], run_id)
    summary["regression"] = results.regression_diff(summary, previous)
    results.save_run(summary)
    yield {"type": "done", "run_id": run_id, "error": None,
           "totals": summary["totals"], "regression": summary["regression"]}
