# Agentic AI Onboarding Labs

One app — a single **FastAPI** backend and a single **React** frontend — that
implements the onboarding labs as tabs. Each lab is an agent built with the
**Claude Agent SDK** plus a simple UI.

**Status:** Labs 1–3 implemented. Lab 4 is stubbed in the UI and built next.

| Lab | Scenario | Sector | State |
|-----|----------|--------|-------|
| 1 | Production Shift Report | Manufacturing | ✅ built |
| 2 | Permit Status Query (first MCP server) | Public Sector | ✅ built |
| 3 | Work Order Triage (approval gate) | Manufacturing | ✅ built |
| 4 | Citizen Service Job Aid (templates) | Public Sector | ⏳ next |
| 5 | On-the-fly MCP server (capstone) | Both | ▫ later |

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
uvicorn app.main:app --reload --port 8001
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
- The frontend dev server proxies `/api/*` to the backend on port 8001.
