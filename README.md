# Agentic AI Onboarding Labs

One app — a single **FastAPI** backend and a single **React** frontend — that
implements the onboarding labs as tabs. Each lab is an agent built with the
**Claude Agent SDK** plus a simple UI.

**Status:** All eight labs implemented.

| Lab | Scenario | Sector | State |
|-----|----------|--------|-------|
| 1 | Production Shift Report | Manufacturing | ✅ built |
| 2 | Permit Status Query (first MCP server) | Public Sector | ✅ built |
| 3 | Work Order Triage (approval gate) | Manufacturing | ✅ built |
| 4 | Citizen Service Job Aid (templates) | Public Sector | ✅ built |
| 5 | On-the-fly MCP server (capstone) | Both | ✅ built |
| 6 | Policy Q&A — RAG with every stage visible | Public Sector | ✅ built |
| 7 | Deep Research — multi-agent orchestration, live | Orchestration | ✅ built |
| 8 | Eval Harness — golden suites, costs, regression diffs | Quality | ✅ built |

## Prerequisites
- Python 3.10+
- Node.js 18+
- Docker (for the Lab 2+ database)
- The `claude` CLI installed and on PATH (the Python Agent SDK drives it)
- An Anthropic API key

## Setup

**1. Environment**
```
cp .env.example .env      # then edit ANTHROPIC_API_KEY
```

**2. Backend**
```
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000     # Windows: omit --reload, see Notes
```

**3. Frontend** (new terminal)
```
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

**4. Database** (needed from Lab 2)
```
docker compose up -d              # PostgreSQL on host port 5433
```

Open **http://localhost:5173**.

## Notes
- The Docker database publishes on **host port 5433** to avoid clashing with the
  PostgreSQL 18 service already running on your machine (5432).
- Set `CLAUDE_MODEL=claude-sonnet-5` (or `claude-haiku-4-5`) in `.env` to reduce cost.
- Lab 6 (RAG) needs no database and no extra keys — retrieval is local TF-IDF + BM25.
  Optionally set `VOYAGE_API_KEY` in `.env` to switch the vector side to semantic
  embeddings; the lab reports which backend is active in its header.
- Lab 6 also accepts uploads (`.md`/`.txt`/`.pdf`): your document is ingested live —
  receive → extract → chunk → index, each step shown with timings — and is instantly
  askable. Uploads are stored as `backend/data/lab6/docs/user-*.md` and removable in the UI.
- Lab 7 (Deep Research) uses the agents' built-in WebSearch/WebFetch tools, so it needs
  internet access at runtime. Researchers default to `claude-haiku-4-5` (override with
  `LAB7_RESEARCHER_MODEL`). Two modes: **Planned** (nothing executes until you approve the
  plan) and **Autonomous agent loop** (the lead agent decides every step live, inside hard
  rails: an adjustable researcher budget, a turn cap, and a finalize gate that requires
  verification). Every agent reports its real dollar cost, every run is recorded and
  **replayable offline** from the Run history panel, and a Stop button aborts a live run.
- Lab 8 (Evals) grades Labs 2, 6 and 7 against golden suites in `backend/data/lab8/suites/`.
  Retrieval cases are free; SQL/answer cases run the real agents (Lab 2 needs the database).
  Every run is stored, costed, and diffed against the previous run; an optional LLM judge
  adds a faithfulness check with visible reasoning.
- The frontend dev server proxies `/api/*` to the backend on port 8000
  (see `frontend/vite.config.ts`) — run uvicorn on 8000, not another port.

### Windows: do not run uvicorn with `--reload`

Every lab agent runs the Claude Code CLI as a **child process**. On Windows the
event loop decides whether that is even possible, and uvicorn picks the loop
based on `--reload` (`uvicorn/loops/asyncio.py`):

```python
if sys.platform == "win32" and not use_subprocess:
    return asyncio.ProactorEventLoop      # can spawn subprocesses
return asyncio.SelectorEventLoop          # cannot, on Windows
```

`--reload` sets `use_subprocess=True`, so you get `SelectorEventLoop`, and every
agent call dies with an empty-detail error:

```
Agent error — Failed to start Claude Code:
```

(The underlying `NotImplementedError` carries no message, hence the bare colon.)
Run without `--reload` on Windows and restart manually after code edits:

```
uvicorn app.main:app --port 8000
```

macOS and Linux are unaffected — `--reload` is fine there.

### Running without Docker

Docker is only a delivery mechanism for PostgreSQL. A native server works
identically — install PostgreSQL 18 **on port 5433** so the `.env` defaults need
no edits, then create the role and database the labs expect:

```sql
CREATE ROLE labs LOGIN PASSWORD 'labs_dev_pw' CREATEROLE;
CREATE DATABASE agentic_labs OWNER labs;
```

`CREATEROLE` matters — the startup seed creates the `labs_readonly` role that
Lab 2's read-only guarantee depends on. No manual `seed.py` run is needed; the
backend seeds itself on startup and is idempotent.
