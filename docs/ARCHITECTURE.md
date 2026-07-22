# Architecture & Lab I/O

One **FastAPI** backend + one **React** frontend. Each lab is a self-contained slice
that plugs into shared plumbing, so a lab can be added or changed without touching
any other lab.

## Folder layout

```
Claude-lab02/
├── docker-compose.yml          # Postgres 18 (host port 5433)
├── .env.example                # ANTHROPIC_API_KEY, CLAUDE_MODEL, DB URLs
├── README.md
├── docs/ARCHITECTURE.md        # this file
│
├── backend/
│   ├── requirements.txt
│   ├── db/
│   │   └── seed.py             # creates + seeds permits (L2) and work_orders (L3)
│   └── app/
│       ├── main.py            # FastAPI app: wires routers, CORS, static frontend
│       ├── config.py          # model id + DB connection strings
│       ├── agent_runtime.py   # run_agent(prompt, options) — shared by every lab
│       ├── agents/            # one agent module per lab (prompt + options)
│       │   ├── lab1_shift_report.py
│       │   ├── lab2_permit_query.py
│       │   └── lab3_triage.py
│       ├── mcp_tools/          # in-process MCP servers the agents call
│       │   ├── permits.py     # L2: run_select (read-only)
│       │   └── workorders.py  # L3: read_work_orders + assign_crew
│       ├── routers/            # one HTTP router per lab
│       │   ├── lab1.py
│       │   ├── lab2.py
│       │   └── lab3.py
│       └── data/lab1/          # L1 sample CSVs (file-based; no DB)
│
└── frontend/
    ├── vite.config.js          # dev proxy: /api → http://localhost:8001
    └── src/
        ├── main.jsx, App.jsx   # router + sidebar nav + home dashboard
        ├── api.js              # one fetch wrapper per endpoint
        ├── styles.css
        └── labs/               # one screen component per lab
            ├── Lab1ShiftReport.jsx
            ├── Lab2PermitQuery.jsx
            └── Lab3Triage.jsx
```

## The per-lab module pattern

Every lab is the same small set of pieces:

| Piece | Location | Responsibility |
|-------|----------|----------------|
| **Agent** | `backend/app/agents/labN_*.py` | System prompt + `ClaudeAgentOptions`; calls `run_agent()` |
| **MCP tool(s)** | `backend/app/mcp_tools/*.py` | In-process tools the agent may call (Labs 2 & 3 only) |
| **Router** | `backend/app/routers/labN.py` | HTTP endpoints; glues agent ↔ data ↔ frontend |
| **View** | `frontend/src/labs/LabN*.jsx` | The screen; calls functions in `api.js` |

Shared, lab-agnostic building blocks:
- `agent_runtime.run_agent(prompt, options)` → `{result, tool_calls, error}` — the single
  place the Claude Agent SDK is driven.
- `config.py` — `CLAUDE_MODEL`, `DATABASE_URL`, `READONLY_DATABASE_URL`.
- `main.py` — includes each router; nothing lab-specific beyond one `include_router` line.
- `frontend/api.js`, `App.jsx`, `styles.css`.

## Data flow (identical for every lab)

```
Browser (labs/LabN.jsx)
   → api.js  fetch('/api/labN/...')
   → Vite dev proxy   (:5173 → :8001)
   → FastAPI router   (routers/labN.py)
   → agent            (agent_runtime → Claude Agent SDK → MCP tools)
   → data             (CSV files  |  Postgres)
   → JSON response    → rendered in the UI
```

## Adding a lab (e.g. Lab 4) — nothing else changes

1. `agents/lab4_*.py` (prompt + options)
2. *(optional)* `mcp_tools/*.py` if it needs tools
3. `routers/lab4.py` (endpoints)
4. one line in `main.py`: `app.include_router(lab4.router)`
5. `frontend/src/labs/Lab4*.jsx` + a wrapper in `api.js` + flip `ready:true` and add a
   `<Route>` in `App.jsx`

---

# Lab I/O contracts

## Lab 1 — Production Shift Report (file in → report out)

- **UI input:** pick a shift-log **CSV**, press **Generate**. (A *Download a sample log*
  link fetches a ready-made file.)
- **Expected CSV columns:** `timestamp, line, units_produced, downtime_minutes, defects`
  (one hourly row per production line). The backend supplies `previous_shift.csv` as the
  comparison baseline automatically.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| POST | `/api/lab1/generate` | `multipart/form-data`, field **`file`** = CSV | `{ "result": "<markdown report>", "tool_calls": [ {name, input} ], "error": null }` |
| GET | `/api/lab1/sample` | — | CSV file download |

- **UI output:** the rendered one-page report (Summary · By Line · Exceptions) + a
  **Download .md** button.

## Lab 2 — Permit Status Query (question in → answer + SQL + table out)

- **UI input:** a plain-English **question** (typed or a sample chip), press **Ask**.
- **Data:** Postgres `permits` table, queried **read-only** (guard + read-only txn + read-only role).

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| POST | `/api/lab2/ask` | `{ "question": "How many electrical permits are pending from June?" }` | `{ "answer": "<plain language>", "sql": "SELECT ...", "table": { "ok": true, "columns": [...], "rows": [[...]] }, "error": null }` |

- **UI output:** the plain-language **answer**, the exact **SQL** the agent ran, and a
  **results table**. A write request (delete/update) is refused — `sql`/`table` come back null.

## Lab 3 — Work Order Triage (queue in → proposals out → approve to write)

- **UI input:** **Run triage**; per row a crew **dropdown** (Change) and an **Approve**
  button; **Reset demo**.
- **Data:** Postgres `work_orders` (read via read-only role) + `crew_assignments`
  (written via read-write role). The triage agent is **denied the write tool** — the only
  path that writes is the Approve button → `/api/lab3/approve`.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | `/api/lab3/queue` | — | `{ "orders": [ {id, wo_number, machine, description, status, crew, urgency, ...} ] }` |
| POST | `/api/lab3/triage` | — | `{ "orders": [ {…, proposed_urgency, proposed_crew, reason} ], "raw": "...", "error": null }` (safety-first order) |
| POST | `/api/lab3/approve` | `{ "work_order_id": 1, "crew": "Safety Response", "urgency": "safety" }` | `{ "ok": true, "assignment_id": 1, "assigned_at": "..." }` |
| POST | `/api/lab3/reset` | — | `{ "ok": true }` |
| GET | `/api/lab3/crews` | — | `{ "crews": [...] }` |

- **UI output:** the triage dashboard — WO · machine/issue · urgency badge · crew · action.
  Safety items are pinned to the top with a red accent; approved rows show **✓ Assigned**.
