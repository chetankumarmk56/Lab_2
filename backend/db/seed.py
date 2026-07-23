"""Create and seed the lab databases, plus a read-only DB role.

Seeds:
  - Lab 2: `permits` (50 rows)
  - Lab 3: `work_orders` (9 rows) + empty `crew_assignments`

Run once after `docker compose up -d`:
    backend/.venv/Scripts/python.exe backend/db/seed.py
Safe to re-run (drops and recreates tables; role creation is idempotent).
"""
import datetime as dt
import os
import random
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://labs:labs_dev_pw@localhost:5433/agentic_labs"
)
READONLY_PASSWORD = "labs_readonly_pw"

# ─────────────────────────── Lab 2: permits ───────────────────────────
TYPES = ["Building", "Electrical", "Plumbing", "Mechanical"]
STATUSES = ["Pending", "Under Review", "Approved", "Issued", "Rejected"]
BASE_FEE = {"Building": 450, "Electrical": 180, "Plumbing": 150, "Mechanical": 220}
NAMES = [
    "Maria Gonzalez", "James Carter", "Wei Chen", "Aisha Rahman", "Robert Novak",
    "Priya Patel", "Daniel Kim", "Sofia Rossi", "Michael OBrien", "Fatima Nasser",
    "David Thompson", "Elena Petrova", "Carlos Mendez", "Grace Liu", "Samuel Adeyemi",
    "Hannah Berg", "Omar Haddad", "Julia Schmidt", "Kevin Walsh", "Nina Kowalski",
]
STREETS = [
    "Maple Ave", "Oak St", "Cedar Ln", "Industrial Pkwy", "Riverside Dr",
    "Main St", "Elm Ct", "Franklin Blvd", "Sunset Rd", "Highland Ave",
    "Willow Way", "Commerce St",
]
FIXED_PERMITS = [
    ("Electrical", "Pending", dt.date(2026, 6, 3)),
    ("Electrical", "Pending", dt.date(2026, 6, 11)),
    ("Electrical", "Pending", dt.date(2026, 6, 24)),
    ("Electrical", "Approved", dt.date(2026, 6, 8)),
    ("Plumbing", "Pending", dt.date(2026, 6, 15)),
]

CREATE_PERMITS = """
CREATE TABLE IF NOT EXISTS permits (
    id             SERIAL PRIMARY KEY,
    permit_number  TEXT NOT NULL,
    permit_type    TEXT NOT NULL,
    applicant_name TEXT NOT NULL,
    address        TEXT NOT NULL,
    status         TEXT NOT NULL,
    submitted_date DATE NOT NULL,
    decision_date  DATE,
    fee            NUMERIC(8, 2) NOT NULL
)
"""

# ─────────────────────── Lab 3: work orders ───────────────────────
WORK_ORDERS = [
    ("WO-4501", "Hydraulic Press #2",
     "Hydraulic press #2 is leaking oil onto the floor by the operator station — "
     "it's a slip hazard and someone could get hurt.", "A. Operator", dt.datetime(2026, 7, 21, 6, 12)),
    ("WO-4502", "CNC Mill #4",
     "CNC mill #4 threw a spindle alarm and shut down; the machine is down and the line is stopped.",
     "B. Nunez", dt.datetime(2026, 7, 21, 6, 40)),
    ("WO-4503", "Packaging Line",
     "Control panel indicator light is flickering on the packaging line. Everything still runs.",
     "C. Feld", dt.datetime(2026, 7, 21, 7, 5)),
    ("WO-4504", "Conveyor #1",
     "Conveyor belt #1 is making a grinding noise but is still running.",
     "D. Osei", dt.datetime(2026, 7, 21, 7, 20)),
    ("WO-4505", "Forklift Charger",
     "Forklift charging station breaker keeps tripping and there's a smell of burning — feels like a shock risk.",
     "E. Park", dt.datetime(2026, 7, 21, 7, 35)),
    ("WO-4506", "Press #3",
     "The guard interlock on press #3 isn't engaging, so the operator is exposed to moving parts — injury risk.",
     "F. Grant", dt.datetime(2026, 7, 21, 7, 50)),
    ("WO-4507", "CNC Mill #2",
     "Coolant is low on CNC #2 and needs a refill.", "G. Ilic", dt.datetime(2026, 7, 21, 8, 10)),
    ("WO-4508", "Air Compressor",
     "Main air compressor pressure is dropping and several machines are slowing down.",
     "H. Reyes", dt.datetime(2026, 7, 21, 8, 25)),
    ("WO-4509", "Tool Crib",
     "Squeaky hinge on the tool-crib door.", "I. Vogel", dt.datetime(2026, 7, 21, 8, 40)),
]

CREATE_WORK_ORDERS = """
CREATE TABLE IF NOT EXISTS work_orders (
    id           SERIAL PRIMARY KEY,
    wo_number    TEXT NOT NULL,
    machine      TEXT NOT NULL,
    description  TEXT NOT NULL,
    submitted_by TEXT NOT NULL,
    submitted_at TIMESTAMP NOT NULL,
    status       TEXT NOT NULL DEFAULT 'New'
)
"""

CREATE_CREW_ASSIGNMENTS = """
CREATE TABLE IF NOT EXISTS crew_assignments (
    id            SERIAL PRIMARY KEY,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
    crew          TEXT NOT NULL,
    urgency       TEXT NOT NULL,
    approved_by   TEXT NOT NULL DEFAULT 'maintenance-lead',
    assigned_at   TIMESTAMP NOT NULL DEFAULT now()
)
"""

ROLE_DO_BLOCK = f"""
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'labs_readonly') THEN
        CREATE ROLE labs_readonly LOGIN PASSWORD '{READONLY_PASSWORD}';
    END IF;
END
$$
"""

# Lab 5 — encrypted store of user-supplied external DB connections. The password
# column holds a Fernet ciphertext (BYTEA); plaintext is NEVER stored. This table
# is deliberately NOT granted to labs_readonly — only trusted service code reads
# it via the read-write DATABASE_URL, so no agent-issued SELECT can reach it.
CREATE_LAB5_CONNECTIONS = """
CREATE TABLE IF NOT EXISTS lab5_connections (
    id                   SERIAL PRIMARY KEY,
    name                 TEXT,
    driver               TEXT NOT NULL CHECK (driver IN ('postgres','mysql','mssql')),
    host                 TEXT NOT NULL,
    port                 INTEGER NOT NULL,
    database             TEXT NOT NULL,
    username             TEXT NOT NULL,
    password_ciphertext  BYTEA NOT NULL,
    ssl_mode             TEXT,
    status               TEXT NOT NULL DEFAULT 'saved',
    last_error_category  TEXT,
    last_verified_at     TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


def build_permits(n: int = 50) -> list[tuple]:
    random.seed(42)
    rows: list[tuple] = []
    seq = 1000

    def make(ptype: str, status: str, sub: dt.date) -> tuple:
        nonlocal seq
        seq += 1
        decision = None
        if status in ("Approved", "Issued", "Rejected"):
            decision = sub + dt.timedelta(days=random.randint(5, 40))
        fee = BASE_FEE[ptype] + random.randint(0, 120)
        return (
            f"P-2026-{seq}", ptype, random.choice(NAMES),
            f"{random.randint(100, 9999)} {random.choice(STREETS)}",
            status, sub, decision, fee,
        )

    for ptype, status, sub in FIXED_PERMITS:
        rows.append(make(ptype, status, sub))
    while len(rows) < n:
        ptype = random.choice(TYPES)
        status = random.choices(STATUSES, weights=[30, 20, 20, 20, 10])[0]
        sub = dt.date(2026, 4, 1) + dt.timedelta(days=random.randint(0, 110))
        rows.append(make(ptype, status, sub))
    return rows


def _seed_permits_if_empty(cur) -> None:
    cur.execute(CREATE_PERMITS)
    cur.execute("SELECT COUNT(*) FROM permits")
    if cur.fetchone()[0] == 0:
        cur.executemany(
            "INSERT INTO permits (permit_number, permit_type, applicant_name, address, "
            "status, submitted_date, decision_date, fee) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            build_permits(),
        )


def _seed_work_orders_if_empty(cur) -> None:
    cur.execute(CREATE_WORK_ORDERS)
    cur.execute(CREATE_CREW_ASSIGNMENTS)
    cur.execute("SELECT COUNT(*) FROM work_orders")
    if cur.fetchone()[0] == 0:
        cur.executemany(
            "INSERT INTO work_orders (wo_number, machine, description, submitted_by, submitted_at) "
            "VALUES (%s,%s,%s,%s,%s)",
            WORK_ORDERS,
        )


def _ensure_baseline(cur) -> None:
    # Lab 1 baseline store. ON CONFLICT DO NOTHING keeps a promoted baseline.
    cur.execute(
        "CREATE TABLE IF NOT EXISTS lab1_baseline ("
        "  slot TEXT PRIMARY KEY, csv_text TEXT NOT NULL, "
        "  source_name TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT now())"
    )
    seed_csv = (
        Path(__file__).resolve().parents[1] / "data" / "lab1" / "previous_shift.csv"
    ).read_text(encoding="utf-8-sig")
    cur.execute(
        "INSERT INTO lab1_baseline (slot, csv_text, source_name) "
        "VALUES ('previous', %s, 'seeded sample') ON CONFLICT (slot) DO NOTHING",
        (seed_csv,),
    )


def _ensure_lab5_connections(cur) -> None:
    # NOT granted to labs_readonly on purpose — the encrypted credential table
    # must never be readable by the read-only role or an agent-issued query.
    cur.execute(CREATE_LAB5_CONNECTIONS)


def _ensure_readonly_role(cur) -> None:
    cur.execute(ROLE_DO_BLOCK)
    # Grant CONNECT on whatever database we're actually in (Neon names vary).
    cur.execute("SELECT current_database()")
    dbname = cur.fetchone()[0]
    cur.execute(f'GRANT CONNECT ON DATABASE "{dbname}" TO labs_readonly')
    cur.execute("GRANT USAGE ON SCHEMA public TO labs_readonly")
    for table in ("permits", "work_orders", "crew_assignments"):
        cur.execute(f"GRANT SELECT ON {table} TO labs_readonly")


def ensure_seeded() -> None:
    """Idempotent bootstrap — safe to run on every startup. Creates the lab
    tables if missing, seeds them only when empty, and ensures the read-only
    role + grants. Never drops data (so user changes survive restarts)."""
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            _seed_permits_if_empty(cur)
            _seed_work_orders_if_empty(cur)
            _ensure_baseline(cur)
            _ensure_lab5_connections(cur)
            _ensure_readonly_role(cur)


def main() -> None:
    """Destructive reset for local dev: drop the lab tables, then reseed fresh."""
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS crew_assignments")
            cur.execute("DROP TABLE IF EXISTS work_orders")
            cur.execute("DROP TABLE IF EXISTS permits")
    ensure_seeded()
    print("Reset + seeded: 50 permits, 9 work orders, lab1_baseline, read-only role 'labs_readonly'.")


if __name__ == "__main__":
    main()
