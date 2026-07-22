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
CREATE TABLE permits (
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
CREATE TABLE work_orders (
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
CREATE TABLE crew_assignments (
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


def main() -> None:
    permits = build_permits()
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            # Lab 2
            cur.execute("DROP TABLE IF EXISTS permits")
            cur.execute(CREATE_PERMITS)
            cur.executemany(
                "INSERT INTO permits (permit_number, permit_type, applicant_name, address, "
                "status, submitted_date, decision_date, fee) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                permits,
            )

            # Lab 3 (drop assignments first — FK to work_orders)
            cur.execute("DROP TABLE IF EXISTS crew_assignments")
            cur.execute("DROP TABLE IF EXISTS work_orders")
            cur.execute(CREATE_WORK_ORDERS)
            cur.execute(CREATE_CREW_ASSIGNMENTS)
            cur.executemany(
                "INSERT INTO work_orders (wo_number, machine, description, submitted_by, submitted_at) "
                "VALUES (%s,%s,%s,%s,%s)",
                WORK_ORDERS,
            )

            # Lab 1: baseline store for "Set as previous". Kept across re-seeds
            # (ON CONFLICT DO NOTHING) so a promoted baseline is not clobbered.
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

            # Read-only role + grants
            cur.execute(ROLE_DO_BLOCK)
            cur.execute("GRANT CONNECT ON DATABASE agentic_labs TO labs_readonly")
            cur.execute("GRANT USAGE ON SCHEMA public TO labs_readonly")
            cur.execute("GRANT SELECT ON permits TO labs_readonly")
            cur.execute("GRANT SELECT ON work_orders TO labs_readonly")
            cur.execute("GRANT SELECT ON crew_assignments TO labs_readonly")

    print(f"Seeded {len(permits)} permits and {len(WORK_ORDERS)} work orders; "
          "ensured lab1_baseline + read-only role 'labs_readonly'.")


if __name__ == "__main__":
    main()
