"""Lab 2 — Permit Status Query API."""
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..agents.lab2_permit_query import answer_permit_question, stream_permit_answer
from ..mcp_tools.permits import execute_select

router = APIRouter(prefix="/api/lab2", tags=["Lab 2 — Permit Query"])


class AskRequest(BaseModel):
    question: str


@router.post("/ask")
async def ask(body: AskRequest):
    """Non-streaming fallback: answer a question and return SQL + results table."""
    result = await answer_permit_question(body.question)

    # The SQL the agent ran is the input to the run_select tool call(s).
    sqls = [
        tc["input"].get("sql", "")
        for tc in result["tool_calls"]
        if tc["name"].endswith("run_select") and isinstance(tc.get("input"), dict)
    ]
    last_sql = sqls[-1] if sqls else None

    # Re-run the final query (read-only) to build the results table shown in the UI.
    table = await execute_select(last_sql) if last_sql else None

    return {
        "answer": result["result"],
        "sql": last_sql,
        "table": table,
        "error": result["error"],
    }


@router.post("/ask/stream")
async def ask_stream(body: AskRequest):
    """Stream the answer as newline-delimited JSON events (SQL, results, tokens)."""

    async def events():
        async for event in stream_permit_answer(body.question):
            yield json.dumps(event, default=str) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/dataset")
async def dataset():
    """Summarize the permits dataset so staff can see what's askable at a glance."""
    total_r = await execute_select("SELECT COUNT(*) AS n FROM permits")
    types_r = await execute_select(
        "SELECT permit_type, COUNT(*) AS n FROM permits GROUP BY permit_type ORDER BY permit_type"
    )
    status_r = await execute_select(
        "SELECT status, COUNT(*) AS n FROM permits GROUP BY status ORDER BY COUNT(*) DESC"
    )
    span_r = await execute_select(
        "SELECT MIN(submitted_date) AS min, MAX(submitted_date) AS max FROM permits"
    )

    def rows(r: dict) -> list:
        return r.get("rows", []) if r.get("ok") else []

    total = rows(total_r)[0][0] if rows(total_r) else 0
    span = rows(span_r)[0] if rows(span_r) else [None, None]
    return {
        "total": total,
        "types": [{"name": r[0], "count": r[1]} for r in rows(types_r)],
        "statuses": [{"name": r[0], "count": r[1]} for r in rows(status_r)],
        "date_range": {"min": span[0], "max": span[1]},
    }
