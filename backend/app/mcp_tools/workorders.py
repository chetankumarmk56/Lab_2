"""Lab 3 — in-process MCP server for maintenance work-order triage.

Two tools (multi-tool orchestration):
  - `read_work_orders` — reads the new/unassigned queue (read-only role).
  - `assign_crew`       — writes a crew assignment (read-write role).

Human-in-the-loop: during triage the agent is DENIED `assign_crew` (see
agents/lab3_triage.py). Assignments are only committed when the maintenance lead
clicks Approve in the dashboard, which calls `assign_crew_write` below.

Sync psycopg + asyncio.to_thread (see permits.py for why async psycopg is avoided).
"""
import asyncio
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg
from claude_agent_sdk import create_sdk_mcp_server, tool

from ..config import DATABASE_URL, READONLY_DATABASE_URL

CREWS = ["Safety Response", "Hydraulics", "CNC / Machining", "Electrical", "General Maintenance"]


def _cell(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _rows_as_dicts(cur) -> list[dict]:
    cols = [d.name for d in cur.description]
    return [{c: _cell(v) for c, v in zip(cols, row)} for row in cur.fetchall()]


# ─────────────────────── sync DB ops ───────────────────────
def _read_queue_sync() -> list[dict]:
    conn = psycopg.connect(READONLY_DATABASE_URL, autocommit=True)
    try:
        conn.execute("SET default_transaction_read_only = on")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, wo_number, machine, description, submitted_by, submitted_at "
                "FROM work_orders WHERE status = 'New' ORDER BY submitted_at"
            )
            return _rows_as_dicts(cur)
    finally:
        conn.close()


def _list_with_assignments_sync() -> list[dict]:
    conn = psycopg.connect(READONLY_DATABASE_URL, autocommit=True)
    try:
        conn.execute("SET default_transaction_read_only = on")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT w.id, w.wo_number, w.machine, w.description, w.submitted_by, "
                "       w.submitted_at, w.status, a.crew, a.urgency, a.approved_by, a.assigned_at "
                "FROM work_orders w "
                "LEFT JOIN crew_assignments a ON a.work_order_id = w.id "
                "ORDER BY w.submitted_at"
            )
            return _rows_as_dicts(cur)
    finally:
        conn.close()


def _assign_crew_sync(work_order_id: int, crew: str, urgency: str, approved_by: str) -> dict:
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM work_orders WHERE id = %s", (work_order_id,))
            row = cur.fetchone()
            if row is None:
                return {"ok": False, "error": f"Work order {work_order_id} not found."}
            cur.execute(
                "INSERT INTO crew_assignments (work_order_id, crew, urgency, approved_by) "
                "VALUES (%s, %s, %s, %s) RETURNING id, assigned_at",
                (work_order_id, crew, urgency, approved_by),
            )
            assignment_id, assigned_at = cur.fetchone()
            cur.execute("UPDATE work_orders SET status = 'Assigned' WHERE id = %s", (work_order_id,))
        return {"ok": True, "assignment_id": assignment_id, "assigned_at": _cell(assigned_at)}
    finally:
        conn.close()


def _reset_sync() -> dict:
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM crew_assignments")
            cur.execute("UPDATE work_orders SET status = 'New'")
        return {"ok": True}
    finally:
        conn.close()


# ─────────────────────── async wrappers ───────────────────────
async def read_queue() -> list[dict]:
    return await asyncio.to_thread(_read_queue_sync)


async def list_with_assignments() -> list[dict]:
    return await asyncio.to_thread(_list_with_assignments_sync)


async def assign_crew_write(work_order_id: int, crew: str, urgency: str,
                            approved_by: str = "maintenance-lead") -> dict:
    return await asyncio.to_thread(_assign_crew_sync, work_order_id, crew, urgency, approved_by)


async def reset_assignments() -> dict:
    return await asyncio.to_thread(_reset_sync)


# ─────────────────────── MCP tools ───────────────────────
@tool("read_work_orders", "Read the queue of new (unassigned) maintenance work orders.", {})
async def read_work_orders(args: dict[str, Any]) -> dict[str, Any]:
    rows = await read_queue()
    return {"content": [{"type": "text", "text": json.dumps(rows, default=str)}]}


@tool(
    "assign_crew",
    "Write a crew assignment for a work order. Requires human approval; do not call during triage.",
    {"work_order_id": int, "crew": str, "urgency": str},
)
async def assign_crew(args: dict[str, Any]) -> dict[str, Any]:
    result = await assign_crew_write(args["work_order_id"], args["crew"], args["urgency"])
    return {
        "content": [{"type": "text", "text": json.dumps(result, default=str)}],
        "is_error": not result.get("ok", False),
    }


workorders_server = create_sdk_mcp_server(
    name="workorders", version="1.0.0", tools=[read_work_orders, assign_crew]
)
