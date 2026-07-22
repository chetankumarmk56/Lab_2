"""Lab 2 — Permit Status Query API."""
from fastapi import APIRouter
from pydantic import BaseModel

from ..agents.lab2_permit_query import answer_permit_question
from ..mcp_tools.permits import execute_select

router = APIRouter(prefix="/api/lab2", tags=["Lab 2 — Permit Query"])


class AskRequest(BaseModel):
    question: str


@router.post("/ask")
async def ask(body: AskRequest):
    """Answer a plain-English permit question and return the SQL + results table."""
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
