"""Lab 7 — orchestration tests: pure helpers + the pipeline's event contract.

No model calls and no web: agent roles are monkeypatched with fakes, so what's
asserted here is exactly what the lab teaches — that ORCHESTRATION (fan-out,
join, verify, revise, failure handling) is deterministic code with a stable
event contract, independent of what any model happens to say.
"""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.lab7 import orchestrator
from app.lab7.pipeline import dedupe_sources, parse_json_block, validate_plan
from app.main import app

client = TestClient(app)


# ── Pure helpers ─────────────────────────────────────────────────────

def test_parse_json_block_tolerates_fences_and_preamble():
    assert parse_json_block('{"a": 1}') == {"a": 1}
    assert parse_json_block('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_block('Here is the plan:\n{"a": {"b": 2}}\nDone.') == {"a": {"b": 2}}
    with pytest.raises(ValueError):
        parse_json_block("no json here")


def test_validate_plan_normalizes_ids_and_clamps_breadth():
    plan = {
        "restated_goal": "g",
        "synthesis_focus": "f",
        "angles": [
            {"id": 9, "title": "A", "objective": "oa", "queries": ["q1", "", "q2"]},
            {"title": "", "objective": "dropped"},                # invalid → skipped
            {"id": 1, "title": "B", "objective": "ob"},           # no queries → title fallback
            {"id": 2, "title": "C", "objective": "oc", "queries": ["x"]},
            {"id": 3, "title": "D", "objective": "od", "queries": ["y"]},
            {"id": 4, "title": "E", "objective": "oe", "queries": ["z"]},
        ],
    }
    out = validate_plan(plan, max_breadth=4)
    assert [a["id"] for a in out["angles"]] == [1, 2, 3, 4]      # re-numbered, clamped
    assert out["angles"][0]["queries"] == ["q1", "q2"]
    assert out["angles"][1]["queries"] == ["B"]                   # fallback to title
    with pytest.raises(ValueError):
        validate_plan({"angles": []}, max_breadth=4)
    with pytest.raises(ValueError):
        validate_plan({"angles": [{"title": "", "objective": ""}]}, max_breadth=4)


def test_dedupe_sources_shares_numbers_across_workers():
    results = [
        {"angle_id": 1, "title": "A", "findings": [
            {"claim": "c1", "source_title": "S1", "url": "https://x.com/1", "quote": "q1"},
            {"claim": "c2", "source_title": "S2", "url": "https://x.com/2", "quote": ""},
        ]},
        {"angle_id": 2, "title": "B", "findings": [
            {"claim": "c3", "source_title": "S1 dup", "url": "https://x.com/1", "quote": "q3"},
            {"claim": "no url", "source_title": "S?", "url": "", "quote": ""},
        ]},
    ]
    sources, findings = dedupe_sources(results)
    assert [s["n"] for s in sources] == [1, 2]                   # shared URL → one number
    assert len(findings) == 3                                     # url-less finding dropped
    assert findings[0]["n"] == 1 and findings[2]["n"] == 1        # both workers cite [1]


# ── Orchestrator event contract (agents faked) ──────────────────────

PLAN = {
    "restated_goal": "g",
    "synthesis_focus": "f",
    "angles": [
        {"id": 1, "title": "Angle A", "objective": "oa", "queries": ["qa"]},
        {"id": 2, "title": "Angle B", "objective": "ob", "queries": ["qb"]},
    ],
}


def _fake_researcher(findings_for=lambda i: [
    {"claim": f"claim {i}", "source_title": f"S{i}", "url": f"https://ex.com/{i}", "quote": "q"}
]):
    async def fake(angle, on_tool=None):
        if on_tool:
            on_tool({"name": "WebSearch", "input": {"query": f"q{angle['id']}"}})
            on_tool({"name": "WebFetch", "input": {"url": f"https://ex.com/{angle['id']}"}})
        return {
            "summary": f"summary {angle['id']}",
            "findings": findings_for(angle["id"]),
            "tool_calls": [{"name": "WebSearch", "input": {}}, {"name": "WebFetch", "input": {}}],
            "error": None,
        }
    return fake


def _collect(question="Q?", plan=PLAN):
    async def run():
        return [e async for e in orchestrator.run_research(question, plan)]
    return asyncio.run(run())


def test_orchestrator_approved_path_event_order(monkeypatch):
    async def fake_synth(question, focus, sources_text, evidence_text, prior_report=None, issues=None):
        assert prior_report is None                               # approved path: one draft only
        return {"report_md": "## TL;DR\n- fine [1]", "error": None}

    async def fake_critic(question, report, evidence):
        return {"verdict": "approved", "confidence": 0.9, "issues": [], "error": None}

    monkeypatch.setattr(orchestrator, "run_researcher", _fake_researcher())
    monkeypatch.setattr(orchestrator, "synthesize", fake_synth)
    monkeypatch.setattr(orchestrator, "critique", fake_critic)

    events = _collect()
    types = [e["type"] for e in events]

    assert events[0] == {"type": "stage", "stage": "research", "status": "start", "workers": 2}
    assert types.count("worker_done") == 2
    assert types.count("tool") == 4                               # 2 per worker, streamed live
    assert types.index("sources") < types.index("report")
    assert types.index("report") < types.index("verdict")
    assert "revise" not in [e.get("stage") for e in events if e["type"] == "stage"]
    done = events[-1]
    assert done["type"] == "done" and done["error"] is None
    assert done["totals"]["agents"] == 4                          # 2 workers + synth + critic


def test_orchestrator_revision_loop(monkeypatch):
    calls = {"synth": 0}

    async def fake_synth(question, focus, sources_text, evidence_text, prior_report=None, issues=None):
        calls["synth"] += 1
        if prior_report is None:
            return {"report_md": "draft with a bad claim [1]", "error": None}
        assert issues, "revision must receive the critic's issues"
        return {"report_md": "corrected draft [1]", "error": None}

    async def fake_critic(question, report, evidence):
        return {
            "verdict": "needs_revision",
            "confidence": 0.4,
            "issues": [{"excerpt": "a bad claim", "problem": "not in evidence"}],
            "error": None,
        }

    monkeypatch.setattr(orchestrator, "run_researcher", _fake_researcher())
    monkeypatch.setattr(orchestrator, "synthesize", fake_synth)
    monkeypatch.setattr(orchestrator, "critique", fake_critic)

    events = _collect()
    reports = [e for e in events if e["type"] == "report"]
    assert [r["revision"] for r in reports] == [1, 2]
    assert reports[1]["report_md"] == "corrected draft [1]"
    assert calls["synth"] == 2
    stages = [e["stage"] for e in events if e["type"] == "stage"]
    assert stages == ["research", "synthesize", "verify", "revise"]
    assert events[-1]["totals"]["agents"] == 5                    # + the revision turn


def test_orchestrator_survives_worker_failure_and_empty_findings(monkeypatch):
    async def dead_researcher(angle, on_tool=None):
        return {"summary": "", "findings": [], "tool_calls": [], "error": "boom"}

    monkeypatch.setattr(orchestrator, "run_researcher", dead_researcher)

    events = _collect()
    done = events[-1]
    assert done["type"] == "done"
    assert "No findings" in done["error"]
    assert "boom" in done["error"]                                # per-worker cause surfaced
    assert not any(e["type"] == "report" for e in events)         # no synthesis without evidence


# ── Router surface ───────────────────────────────────────────────────

def test_config_endpoint_exposes_tiering_and_caps():
    r = client.get("/api/lab7/config")
    assert r.status_code == 200
    body = r.json()
    for key in ("orchestrator_model", "researcher_model", "max_breadth",
                "worker_concurrency", "worker_max_turns"):
        assert key in body


def test_plan_endpoint_rejects_empty_question():
    assert client.post("/api/lab7/plan", json={"question": "  "}).status_code == 400


def test_run_stream_endpoint_streams_ndjson_and_records(monkeypatch, tmp_path):
    from app.lab7 import history
    from app.routers import lab7 as lab7_router

    monkeypatch.setattr(history, "LAB7_RUNS_DIR", tmp_path)

    async def fake_run(question, plan):
        yield {"type": "stage", "stage": "research", "status": "start", "workers": 1}
        yield {"type": "done", "error": None, "totals": {"ms": 1, "agents": 1, "tool_calls": 0}}

    monkeypatch.setattr(lab7_router, "run_research", fake_run)
    r = client.post(
        "/api/lab7/run/stream",
        json={"question": "x?", "plan": {"angles": [{"title": "t", "objective": "o", "queries": ["q"]}]}},
    )
    assert r.status_code == 200
    lines = [json.loads(line) for line in r.text.strip().splitlines()]
    # every run now opens with its run_meta (id used for history/replay)
    assert lines[0]["type"] == "run_meta" and lines[0]["mode"] == "planned"
    assert lines[1]["type"] == "stage" and lines[-1]["type"] == "done"
    # and the whole stream was teed to a replayable recording
    recorded = history.load_run(lines[0]["run_id"])
    assert [e["event"]["type"] for e in recorded] == ["run_meta", "stage", "done"]


def test_run_stream_rejects_invalid_plan():
    r = client.post("/api/lab7/run/stream", json={"question": "x", "plan": {"angles": []}})
    assert r.status_code == 400


# ── Agent-loop mode: the model drives, but the rails are code — and hold ──

def _dyn_toolkit(monkeypatch, verdict_seq=None):
    from app.agents import lab7_research
    from app.lab7 import dynamic

    async def fake_researcher(angle, on_tool=None):
        if on_tool:
            on_tool({"name": "WebSearch", "input": {"query": angle["title"]}})
        return {
            "summary": f"summary of {angle['title']}",
            "findings": [{
                "claim": f"claim about {angle['title']}",
                "source_title": "Source",
                "url": f"https://ex.com/{angle['title']}",
                "quote": "",
            }],
            "tool_calls": [{"name": "WebSearch", "input": {}}],
            "error": None,
        }

    seq = list(verdict_seq or [])

    async def fake_critic(question, report, evidence):
        if seq:
            return seq.pop(0)
        return {"verdict": "approved", "confidence": 0.9, "issues": [], "error": None}

    monkeypatch.setattr(lab7_research, "run_researcher", fake_researcher)
    monkeypatch.setattr(lab7_research, "critique", fake_critic)

    events: list[dict] = []
    kit = dynamic.build_lead_toolkit("Q?", events.append)
    return kit, events


def _angles_json(*titles):
    return json.dumps([{"title": t, "objective": f"study {t}", "queries": [t]} for t in titles])


def _txt(result):
    return result["content"][0]["text"]


def test_dynamic_researcher_budget_is_enforced(monkeypatch):
    kit, events = _dyn_toolkit(monkeypatch)
    delegate = kit["handlers"]["delegate_research"]

    async def run():
        r1 = await delegate({"angles_json": _angles_json("a1", "a2", "a3")})
        r2 = await delegate({"angles_json": _angles_json("b1", "b2", "b3")})
        r3 = await delegate({"angles_json": _angles_json("c1")})
        return r1, r2, r3

    r1, r2, r3 = asyncio.run(run())
    assert "is_error" not in r1 and "is_error" not in r2
    assert r3.get("is_error") is True and "budget exhausted" in _txt(r3).lower()
    assert kit["state"]["researchers_used"] == 6           # the 7th never ran
    assert sum(1 for e in events if e["type"] == "worker_done") == 6


def test_dynamic_finalize_requires_verification(monkeypatch):
    kit, events = _dyn_toolkit(
        monkeypatch,
        verdict_seq=[{"verdict": "needs_revision", "confidence": 0.4,
                      "issues": [{"excerpt": "x", "problem": "ungrounded"}], "error": None}],
    )
    h = kit["handlers"]

    async def run():
        gate0 = await h["finalize"]({"markdown": "sneaky unreviewed brief"})
        await h["delegate_research"]({"angles_json": _angles_json("a")})
        d1 = await h["submit_draft"]({"markdown": "draft one [1]"})
        gate1 = await h["finalize"]({"markdown": "still not approved"})
        d2 = await h["submit_draft"]({"markdown": "draft two [1]"})
        ok = await h["finalize"]({"markdown": "final brief [1]"})
        return gate0, d1, gate1, d2, ok

    gate0, d1, gate1, d2, ok = asyncio.run(run())
    assert gate0.get("is_error") is True                    # no draft ever verified
    assert "needs_revision" in _txt(d1)
    assert gate1.get("is_error") is True                    # last verdict not approved
    assert "approved" in _txt(d2)
    assert "is_error" not in ok
    assert kit["state"]["final"] == "final brief [1]"
    reports = [e for e in events if e["type"] == "report"]
    assert len(reports) == 1 and reports[0]["revision"] == 2
    attempts = [e["attempt"] for e in events if e["type"] == "verdict"]
    assert attempts == [1, 2]


def test_dynamic_citation_numbers_are_shared_across_delegations(monkeypatch):
    kit, events = _dyn_toolkit(monkeypatch)
    delegate = kit["handlers"]["delegate_research"]

    async def run():
        await delegate({"angles_json": _angles_json("same")})
        await delegate({"angles_json": _angles_json("same")})   # same fake URL again

    asyncio.run(run())
    assert len(kit["state"]["sources"]) == 1                # one URL → one [n]
    assert [f["n"] for f in kit["state"]["findings"]] == [1, 1]
    budget_events = [e for e in events if e["type"] == "budget"]
    assert [e["researchers_used"] for e in budget_events] == [1, 2]


def test_run_dynamic_stream_rejects_empty_question():
    r = client.post("/api/lab7/run-dynamic/stream", json={"question": "   "})
    assert r.status_code == 400


def test_dynamic_budget_is_per_run(monkeypatch):
    from app.lab7 import dynamic

    async def fake_researcher(angle, on_tool=None):
        return {"summary": "s", "findings": [], "tool_calls": [], "error": None}

    from app.agents import lab7_research
    monkeypatch.setattr(lab7_research, "run_researcher", fake_researcher)

    events: list[dict] = []
    kit = dynamic.build_lead_toolkit("Q?", events.append, max_researchers=2)

    async def run():
        r1 = await kit["handlers"]["delegate_research"]({"angles_json": _angles_json("a", "b")})
        r2 = await kit["handlers"]["delegate_research"]({"angles_json": _angles_json("c")})
        return r1, r2

    r1, r2 = asyncio.run(run())
    assert "is_error" not in r1
    assert r2.get("is_error") is True and "(2 total)" in _txt(r2)


# ── Correctness additions: citation check, worker timeout, run history ──

def test_check_citations_flags_unknown_numbers():
    from app.lab7.pipeline import check_citations

    sources = [{"n": 1, "title": "A", "url": "u1"}, {"n": 2, "title": "B", "url": "u2"}]
    out = check_citations("Claim [1]. Bogus [7]. Again [2][2].", sources)
    assert out == {"cited": [1, 2], "invalid": [7], "total_sources": 2}


def test_planned_worker_timeout_is_survived(monkeypatch):
    async def sleepy_researcher(angle, on_tool=None):
        await asyncio.sleep(5)
        return {"summary": "", "findings": [], "tool_calls": [], "error": None}

    async def fake_synth(*a, **k):
        return {"report_md": "x", "error": None, "cost_usd": 0}

    async def fake_critic(*a, **k):
        return {"verdict": "approved", "confidence": 1.0, "issues": [], "error": None, "cost_usd": 0}

    monkeypatch.setattr(orchestrator, "run_researcher", sleepy_researcher)
    monkeypatch.setattr(orchestrator, "synthesize", fake_synth)
    monkeypatch.setattr(orchestrator, "critique", fake_critic)
    monkeypatch.setattr(orchestrator, "LAB7_WORKER_TIMEOUT_S", 0.05)

    events = _collect(plan={**PLAN, "angles": PLAN["angles"][:1]})
    done = events[-1]
    worker_done = next(e for e in events if e["type"] == "worker_done")
    assert "timed out" in worker_done["error"]
    assert "timed out" in done["error"]          # no findings → honest failure, not a hang


def test_run_history_roundtrip(tmp_path, monkeypatch):
    from app.lab7 import history

    monkeypatch.setattr(history, "LAB7_RUNS_DIR", tmp_path)

    run_id = history.new_run_id("loop")
    meta = history.meta_event(run_id, "loop", "How does replay work?")
    recorder = history.RunRecorder(run_id)
    recorder.write(meta)
    recorder.write({"type": "report", "revision": 1, "report_md": "# Brief", "ms": 0})
    recorder.write({"type": "done", "error": None,
                    "totals": {"ms": 12.0, "agents": 3, "tool_calls": 5, "cost_usd": 0.01}})
    recorder.close()

    runs = history.list_runs()
    assert len(runs) == 1
    summary = runs[0]
    assert summary["run_id"] == run_id
    assert summary["mode"] == "loop" and summary["ok"] and summary["has_report"]
    assert summary["totals"]["cost_usd"] == 0.01

    entries = history.load_run(run_id)
    assert [e["event"]["type"] for e in entries] == ["run_meta", "report", "done"]
    assert entries[0]["t"] <= entries[-1]["t"]

    assert history.delete_run(run_id) is True
    assert history.load_run(run_id) is None
    with pytest.raises(ValueError):
        history.load_run("../../etc/passwd")