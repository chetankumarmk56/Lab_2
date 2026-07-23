"""FastAPI TestClient tests for the Lab 5 endpoints + no-leak invariants.

Uses the local Docker Postgres (5433) as the "user's external database" via the
SELECT-only labs_readonly role. Requires that DB up + CREDENTIAL_ENCRYPTION_KEY set.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_SECRET = "labs_readonly_pw"
_CONN = {
    "driver": "postgres",
    "host": "localhost",
    "port": 5433,
    "database": "agentic_labs",
    "username": "labs_readonly",
    "password": _SECRET,
    "name": "RouterTest",
}


def test_drivers_endpoint():
    r = client.get("/api/lab5/drivers")
    assert r.status_code == 200
    assert "postgres" in {d["id"] for d in r.json()["drivers"]}


def test_save_validation_400():
    r = client.post("/api/lab5/connections", json={
        "driver": "postgres", "host": "", "port": 70000,
        "database": "", "username": "", "password": "",
    })
    assert r.status_code == 400


def test_full_flow_and_no_secret_leak():
    # Stage 1 — save (password never echoed back)
    r = client.post("/api/lab5/connections", json=_CONN)
    assert r.status_code == 200, r.text
    assert _SECRET not in r.text and "ciphertext" not in r.text
    conn_id = r.json()["id"]

    try:
        # list omits secrets
        lr = client.get("/api/lab5/connections")
        assert lr.status_code == 200
        assert _SECRET not in lr.text and "password" not in lr.text and "ciphertext" not in lr.text

        # Stage 2 — test connection
        tr = client.post(f"/api/lab5/connections/{conn_id}/test")
        assert tr.status_code == 200 and tr.json()["ok"] is True
        assert _SECRET not in tr.text

        # Stages 3-5 — deploy (generate + register); generated code has no secret
        dr = client.post(f"/api/lab5/connections/{conn_id}/deploy")
        assert dr.status_code == 200 and dr.json()["ok"] is True
        assert _SECRET not in dr.text

        # Stage 6 — verify (all checks green)
        vr = client.post(f"/api/lab5/connections/{conn_id}/verify")
        assert vr.status_code == 200 and vr.json()["ok"] is True

        # 404 on unknown id
        assert client.post("/api/lab5/connections/99999999/test").status_code == 404
    finally:
        assert client.delete(f"/api/lab5/connections/{conn_id}").status_code == 200


def test_test_connection_bad_host_is_friendly():
    bad = {**_CONN, "host": "no-such-host.invalid", "name": "BadHost"}
    r = client.post("/api/lab5/connections", json=bad)
    conn_id = r.json()["id"]
    try:
        tr = client.post(f"/api/lab5/connections/{conn_id}/test")
        assert tr.status_code == 200
        body = tr.json()
        assert body["ok"] is False
        # a friendly category, never a raw stack trace / DSN
        assert body["category"] in {"host_unreachable", "timeout", "port_blocked", "unknown", "auth_failed", "ssl_error"}
        assert "Traceback" not in tr.text and _SECRET not in tr.text
    finally:
        client.delete(f"/api/lab5/connections/{conn_id}")
