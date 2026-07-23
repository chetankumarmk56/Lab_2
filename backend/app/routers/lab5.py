"""Lab 5 — On-the-Fly MCP Server Builder API.

HTTP boundary for the six-stage flow. Pydantic request bodies, friendly error
shapes (400 validation / 404 not-found / 502 agent / 503 key-missing), and
responses that physically OMIT the password and ciphertext (they never leave the
store layer). The password is submitted once via POST JSON and never echoed back.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..agents.lab5_query import answer_query
from ..lab5 import connection_service, deployment, store, verification
from ..lab5.connection_service import ConnectionNotFound
from ..lab5.credentials import CredentialKeyError
from ..lab5.drivers import DriverUnavailable, available_drivers, get_driver

router = APIRouter(prefix="/api/lab5", tags=["Lab 5 — MCP Server Builder"])

_VALID_DRIVERS = {"postgres", "mysql", "mssql"}


class SaveConnectionRequest(BaseModel):
    driver: str
    host: str
    port: int
    database: str
    username: str
    password: str
    name: str | None = None
    ssl_mode: str | None = None


class QueryRequest(BaseModel):
    question: str


def _validate(body: SaveConnectionRequest) -> dict[str, str]:
    problems: dict[str, str] = {}
    if body.driver not in _VALID_DRIVERS:
        problems["driver"] = "Choose a supported database engine."
    if not (body.host or "").strip():
        problems["host"] = "Host or IP is required."
    if not 1 <= int(body.port) <= 65535:
        problems["port"] = "Port must be between 1 and 65535."
    if not (body.database or "").strip():
        problems["database"] = "Database name is required."
    if not (body.username or "").strip():
        problems["username"] = "Username is required."
    if not body.password:
        problems["password"] = "Password is required."
    return problems


@router.get("/drivers")
async def drivers():
    """List DB engines so the wizard only offers ones available in this deployment."""
    return {"drivers": available_drivers()}


@router.get("/connections")
async def list_connections():
    """Saved connections — METADATA ONLY (never the password or ciphertext)."""
    return {"connections": await connection_service.list_connections()}


@router.post("/connections")
async def create_connection(body: SaveConnectionRequest):
    """Stage 1 — validate, encrypt the password (Fernet), and persist."""
    problems = _validate(body)
    if problems:
        raise HTTPException(400, detail={"message": "Please fix the connection details.", "fields": problems})
    try:
        get_driver(body.driver)  # reject unavailable engine up front
    except DriverUnavailable as exc:
        raise HTTPException(400, detail={"message": str(exc), "fields": {"driver": str(exc)}})
    try:
        conn_id = await connection_service.save_connection(body)
    except CredentialKeyError as exc:
        raise HTTPException(503, detail=str(exc))
    return {"id": conn_id, "connection": await store.get_public(conn_id)}


@router.post("/connections/{conn_id}/test")
async def test_connection(conn_id: int):
    """Stage 2 — real connect + trivial read; friendly category, no stack traces."""
    try:
        return await connection_service.test_connection(conn_id)
    except ConnectionNotFound:
        raise HTTPException(404, detail="Connection not found.")
    except CredentialKeyError as exc:
        raise HTTPException(503, detail=str(exc))


@router.post("/connections/{conn_id}/deploy")
async def deploy(conn_id: int):
    """Stages 3-5 — generate the read-only MCP server, deploy (in-process), register."""
    try:
        return await deployment.deploy(conn_id)
    except ConnectionNotFound:
        raise HTTPException(404, detail="Connection not found.")
    except CredentialKeyError as exc:
        raise HTTPException(503, detail=str(exc))


@router.post("/connections/{conn_id}/verify")
async def verify(conn_id: int):
    """Stage 6 — run the acceptance checks (server responds, SELECT works, writes blocked)."""
    try:
        return await verification.verify(conn_id)
    except CredentialKeyError as exc:
        raise HTTPException(503, detail=str(exc))


@router.post("/connections/{conn_id}/query")
async def query(conn_id: int, body: QueryRequest):
    """Post-setup — answer a natural-language question via the read-only server."""
    if not (body.question or "").strip():
        raise HTTPException(400, detail="Ask a question.")
    try:
        result = await answer_query(conn_id, body.question.strip())
    except ConnectionNotFound:
        raise HTTPException(404, detail="Connection not found.")
    except CredentialKeyError as exc:
        raise HTTPException(503, detail=str(exc))
    if result["error"] and not result["answer"]:
        raise HTTPException(502, detail=f"Agent error: {result['error']}")
    return result


@router.delete("/connections/{conn_id}")
async def delete_connection(conn_id: int):
    """Unregister the live server and delete the encrypted row (idempotent)."""
    try:
        return await connection_service.delete_connection(conn_id)
    except ConnectionNotFound:
        raise HTTPException(404, detail="Connection not found.")
