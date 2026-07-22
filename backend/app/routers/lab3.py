"""Lab 3 — Work Order Triage API."""
from fastapi import APIRouter
from pydantic import BaseModel

from ..agents.lab3_triage import triage
from ..mcp_tools.workorders import (
    CREWS,
    assign_crew_write,
    list_with_assignments,
    reset_assignments,
)

router = APIRouter(prefix="/api/lab3", tags=["Lab 3 — Work Order Triage"])

_URGENCY_ORDER = {"safety": 0, "production-stopping": 1, "routine": 2}


class ApproveRequest(BaseModel):
    work_order_id: int
    crew: str
    urgency: str
    approved_by: str = "maintenance-lead"


@router.get("/crews")
async def crews():
    return {"crews": CREWS}


@router.get("/queue")
async def queue():
    return {"orders": await list_with_assignments()}


@router.post("/triage")
async def run_triage():
    """Run the triage agent, merge its proposals onto the queue, safety-first."""
    result = await triage()
    orders = await list_with_assignments()
    by_id = {
        p.get("work_order_id"): p
        for p in result["proposals"]
        if isinstance(p, dict)
    }
    merged = []
    for o in orders:
        p = by_id.get(o["id"], {})
        merged.append({
            **o,
            "proposed_urgency": p.get("urgency"),
            "proposed_crew": p.get("proposed_crew"),
            "reason": p.get("reason"),
        })
    merged.sort(key=lambda o: _URGENCY_ORDER.get(o.get("proposed_urgency"), 9))
    return {"orders": merged, "raw": result["raw"], "error": result["error"]}


@router.post("/approve")
async def approve(body: ApproveRequest):
    """The human-in-the-loop write: only reachable via the Approve button."""
    return await assign_crew_write(body.work_order_id, body.crew, body.urgency, body.approved_by)


@router.post("/reset")
async def reset():
    return await reset_assignments()
