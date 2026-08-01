"""Lab 8 — eval-harness tests: graders, storage/diff, and the runner's event
contract (adapters faked — no models, no web, no DB).

The graders are the part that must be beyond argument, so they get the most
direct coverage; the runner test asserts the streaming contract and that a
flipped case shows up as a regression against the stored previous run.
"""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.lab8 import graders, results, runner
from app.lab8.suites import load_suites, summaries
from app.main import app

client = TestClient(app)


# ── Suites ───────────────────────────────────────────────────────────

def test_suites_load_and_summarize():
    catalog = load_suites()
    assert {"lab2_sql", "lab6_rag", "lab7_research"} <= set(catalog)
    assert all(s["cases"] for s in catalog.values())
    metas = {s["suite"]: s for s in summaries()}
    assert metas["lab7_research"]["heavy"] is True
    assert metas["lab6_rag"]["case_count"] == len(catalog["lab6_rag"]["cases"])
    assert "cases" not in metas["lab2_sql"]  # summaries carry metadata only


# ── Deterministic graders ───────────────────────────────────────────

def test_result_set_comparison_is_order_insensitive_and_float_tolerant():
    golden = [["Building", 14], ["Electrical", 12]]
    actual = [["Electrical", 12.0], ["Building", "14"]]   # reordered, mixed types
    assert graders.compare_result_sets(golden, actual)["pass"] is True

    assert graders.compare_result_sets([[50]], [[49]])["pass"] is False

    shape = graders.compare_result_sets([[50]], [["Building", 50]])
    assert shape["pass"] is False and "column count" in shape["detail"]


def test_text_and_bound_graders():
    assert graders.contains_all("The fee is $75, paid up front.", ["$75"])["pass"] is True
    assert graders.contains_all("No number here.", ["$75"])["pass"] is False

    assert graders.refusal_check(True, expected=True)["pass"] is True
    assert graders.refusal_check(False, expected=True)["pass"] is False
    assert graders.refusal_check(True, expected=False)["pass"] is False

    assert graders.citations_valid("Fact [1]. Fact [3].", 3)["pass"] is True
    bad = graders.citations_valid("Fact [9].", 3)
    assert bad["pass"] is False and "[9]" in bad["detail"]

    assert graders.within("cost_within", 0.4, 2.0, "$")["pass"] is True
    assert graders.within("time_within", 400, 360, "s")["pass"] is False


# ── Results store + regression diff ─────────────────────────────────

def _summary(run_id: str, passes: dict[str, bool]) -> dict:
    return {
        "run_id": run_id,
        "model": "claude-test",
        "suites": [{
            "suite": "s1",
            "cases": [{"case_id": cid, "pass": ok} for cid, ok in passes.items()],
        }],
    }


def test_results_roundtrip_and_regression_diff(tmp_path, monkeypatch):
    monkeypatch.setattr(results, "LAB8_RESULTS_DIR", tmp_path)

    first = _summary("20260801-000001-eval-aaaa", {"a": True, "b": True})
    results.save_run(first)
    second = _summary("20260801-000002-eval-bbbb", {"a": False, "b": True, "c": True})

    prev = results.find_previous(["s1"], before_run_id=second["run_id"])
    assert prev is not None and prev["run_id"] == first["run_id"]

    diff = results.regression_diff(second, prev)
    assert diff["regressions"] == ["s1/a"]
    assert diff["fixes"] == []
    assert diff["shared_cases"] == 2          # "c" is new, not comparable

    assert results.load_run(first["run_id"])["model"] == "claude-test"
    assert results.delete_run(first["run_id"]) is True
    with pytest.raises(ValueError):
        results.load_run("../escape")


# ── Runner event contract (adapters faked) ──────────────────────────

FAKE_SUITE = {
    "fake": {
        "suite": "fake",
        "title": "Fake suite",
        "description": "d",
        "target": "lab6",
        "heavy": False,
        "cases": [
            {"id": "ok-case", "type": "retrieval", "question": "q1", "expect_doc": "d1"},
            {"id": "bad-case", "type": "retrieval", "question": "q2", "expect_doc": "d2"},
        ],
    }
}


def _collect_run(monkeypatch, tmp_path, flip_ok=True):
    monkeypatch.setattr(runner, "load_suites", lambda: FAKE_SUITE)
    monkeypatch.setattr(results, "LAB8_RESULTS_DIR", tmp_path)

    async def fake_case(target, case, model, judge):
        ok = case["id"] == "ok-case" if flip_ok else False
        return [graders.check("expected_doc_retrieved", ok, "faked")], 0.01, "preview"

    monkeypatch.setattr(runner, "_run_case", fake_case)

    async def run():
        return [e async for e in runner.run_evals(["fake"], model=None, judge=False)]

    return asyncio.run(run())


def test_runner_streams_contract_and_stores_summary(monkeypatch, tmp_path):
    events = _collect_run(monkeypatch, tmp_path)
    types = [e["type"] for e in events]
    assert types[0] == "run_meta" and types[-1] == "done"
    assert types.count("case_start") == 2 and types.count("case_done") == 2
    assert types.index("suite_start") < types.index("case_start")

    done = events[-1]
    assert done["totals"]["cases"] == 2
    assert done["totals"]["passed"] == 1 and done["totals"]["failed"] == 1
    assert done["regression"] is None            # first run: nothing to compare

    stored = results.list_runs()
    assert len(stored) == 1 and stored[0]["run_id"] == done["run_id"]


def test_runner_flags_regressions_against_previous_run(monkeypatch, tmp_path):
    _collect_run(monkeypatch, tmp_path, flip_ok=True)    # run 1: ok-case passes
    events = _collect_run(monkeypatch, tmp_path, flip_ok=False)  # run 2: everything fails
    done = events[-1]
    assert done["regression"] is not None
    assert done["regression"]["regressions"] == ["fake/ok-case"]
    assert done["regression"]["fixes"] == []


# ── Router surface ───────────────────────────────────────────────────

def test_suites_endpoint_lists_suites_and_models():
    r = client.get("/api/lab8/suites")
    assert r.status_code == 200
    body = r.json()
    assert {"lab2_sql", "lab6_rag", "lab7_research"} <= {s["suite"] for s in body["suites"]}
    assert body["configured_model"]
    assert "claude-haiku-4-5" in body["model_options"]


def test_run_stream_validates_inputs():
    assert client.post("/api/lab8/run/stream", json={"suites": ["nope"]}).status_code == 400
    assert client.post(
        "/api/lab8/run/stream", json={"suites": ["lab6_rag"], "model": "gpt-oops"}
    ).status_code == 400


def test_run_stream_endpoint_streams_ndjson(monkeypatch):
    from app.routers import lab8 as lab8_router

    async def fake_run(suites, model, judge):
        yield {"type": "run_meta", "run_id": "x", "suites": suites}
        yield {"type": "done", "run_id": "x", "error": None,
               "totals": {"cases": 0, "passed": 0, "failed": 0, "cost_usd": 0, "ms": 1},
               "regression": None}

    monkeypatch.setattr(lab8_router, "run_evals", fake_run)
    r = client.post("/api/lab8/run/stream", json={"suites": ["lab6_rag"]})
    assert r.status_code == 200
    lines = [json.loads(line) for line in r.text.strip().splitlines()]
    assert lines[0]["type"] == "run_meta" and lines[-1]["type"] == "done"


def test_results_endpoints_handle_missing_runs():
    assert client.get("/api/lab8/results/20990101-000000-eval-ffff").status_code == 404
    assert client.delete("/api/lab8/results/20990101-000000-eval-ffff").status_code == 404
    assert client.get("/api/lab8/results").status_code == 200