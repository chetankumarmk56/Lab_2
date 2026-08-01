"""Lab 8 — adapters: run one golden case against the REAL lab.

The rule that makes these evals honest: adapters reuse each lab's production
prompts and options verbatim (a model override is applied to the options
*object*, never by re-implementing the agent). If the eval passes, the thing
users actually run passes.
"""
from __future__ import annotations

import asyncio
from time import perf_counter

from claude_agent_sdk import ClaudeAgentOptions

from ..agents import lab2_permit_query as lab2
from ..agents import lab6_doc_qa
from ..agents.lab7_research import make_plan
from ..config import CLAUDE_MODEL, LAB6_TOP_K
from ..lab6 import index as corpus_index
from ..lab7.orchestrator import run_research
from ..lab7.pipeline import validate_plan
from ..lab7.runner import stream_agent
from ..mcp_tools.permits import execute_select


# ── Lab 2: the production Text-to-SQL agent ─────────────────────────

async def run_lab2_case(question: str, model: str | None = None) -> dict:
    options = lab2._options()  # noqa: SLF001 - deliberately the production options
    if model:
        options.model = model
    result = await stream_agent(question, options)
    sqls = [
        tc["input"].get("sql")
        for tc in result["tool_calls"]
        if tc["name"].endswith("run_select") and isinstance(tc.get("input"), dict)
    ]
    answer = result["result"] or ""
    return {
        "answer": answer,
        "sql": sqls[-1] if sqls else None,
        "sql_count": len(sqls),
        "refused": lab2.REFUSAL_MARK in answer,
        "error": result["error"],
        "cost_usd": result.get("cost_usd", 0.0),
    }


async def execute_sql(sql: str) -> dict:
    """Run one read-only SELECT through Lab 2's guarded executor."""
    return await execute_select(sql)


# ── Lab 6: retrieval (free) and the grounded answer path ────────────

async def run_lab6_retrieval_case(question: str) -> dict:
    idx = await asyncio.to_thread(corpus_index.get_index)
    trace = await asyncio.to_thread(idx.search, question, LAB6_TOP_K)
    return {
        "selected_docs": sorted({c["doc_id"] for c in trace["selected"]}),
        "low_confidence": trace["low_confidence"],
        "error": None,
        "cost_usd": 0.0,
    }


async def run_lab6_answer_case(question: str, model: str | None = None) -> dict:
    idx = await asyncio.to_thread(corpus_index.get_index)
    trace = await asyncio.to_thread(idx.search, question, LAB6_TOP_K)
    selected = trace["selected"]
    context = [
        {
            "n": i + 1,
            "source": c["source"],
            "title": c["title"],
            "heading": c["heading"],
            "text": c["text"],
        }
        for i, c in enumerate(selected)
    ]
    if not context:
        # Mirrors the router: nothing retrieved → refuse without a model call.
        return {"answer": None, "refused": True, "n_sources": 0,
                "context_text": "", "error": None, "cost_usd": 0.0}

    options = ClaudeAgentOptions(
        system_prompt=lab6_doc_qa.SYSTEM_PROMPT,
        model=model or CLAUDE_MODEL,
        tools=[],
        allowed_tools=[],
        permission_mode="bypassPermissions",
        setting_sources=[],
    )
    result = await stream_agent(lab6_doc_qa.build_user_prompt(question, context), options)
    raw = result["result"] or ""
    refused = lab6_doc_qa.NOT_IN_CONTEXT_SENTINEL in raw
    answer = raw.replace(lab6_doc_qa.NOT_IN_CONTEXT_SENTINEL, "").strip() or None
    context_text = "\n\n".join(f"[{b['n']}] {b['title']} — {b['heading']}\n{b['text']}" for b in context)
    return {
        "answer": answer,
        "refused": refused,
        "n_sources": len(context),
        "context_text": context_text,
        "error": result["error"],
        "cost_usd": result.get("cost_usd", 0.0),
    }


# ── Lab 7: the planned-mode pipeline, end to end ─────────────────────

async def run_lab7_case(question: str, breadth: int) -> dict:
    t0 = perf_counter()
    planned = await make_plan(question, breadth)
    cost = planned.get("cost_usd", 0.0)
    if planned["error"]:
        return {"report_md": None, "sources": 0, "citations": None,
                "seconds": perf_counter() - t0, "cost_usd": cost,
                "error": f"planner: {planned['error']}"}
    try:
        plan = validate_plan(planned["plan"], breadth)
    except ValueError as exc:
        return {"report_md": None, "sources": 0, "citations": None,
                "seconds": perf_counter() - t0, "cost_usd": cost,
                "error": f"invalid plan: {exc}"}

    report_md = None
    sources = 0
    citations = None
    error = None
    async for event in run_research(question, plan):
        kind = event.get("type")
        if kind == "report":
            report_md = event.get("report_md")
        elif kind == "sources":
            sources = len(event.get("sources") or [])
        elif kind == "citations":
            citations = event
        elif kind == "done":
            error = event.get("error")
            cost += (event.get("totals") or {}).get("cost_usd") or 0.0
    return {
        "report_md": report_md,
        "sources": sources,
        "citations": citations,
        "seconds": perf_counter() - t0,
        "cost_usd": round(cost, 4),
        "error": error,
    }
