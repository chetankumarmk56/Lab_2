# Architecture & Lab I/O

One **FastAPI** backend + one **React (TypeScript + Vite)** frontend. Each lab is a
self-contained slice that plugs into shared plumbing, so a lab can be added or changed
without touching any other lab.

All eight labs are implemented and routed.

| Lab | Scenario | Sector | Agent capability |
|-----|----------|--------|------------------|
| 1 | Production Shift Report | Manufacturing | Read-only file tools (`Read`/`Glob`/`Grep`), no MCP |
| 2 | Permit Status Query | Public Sector | First MCP server — one read-only SQL tool |
| 3 | Work Order Triage | Manufacturing | Two MCP tools + a permission callback that denies the write |
| 4 | Citizen Service Job Aid | Public Sector | No tools — structured JSON out, rendered into a branded `.docx` |
| 5 | On-the-Fly MCP Server Builder | Capstone | An MCP server **generated per user connection**, read-only by construction |
| 6 | Policy Q&A (RAG) | Public Sector | No tools — retrieval-augmented generation over a markdown corpus, every stage exposed in the UI |
| 7 | Deep Research | Orchestration | Multi-agent, two modes: **planned** (code executes an approved plan) and **agent loop** (a lead agent chooses among delegation tools each iteration) — parallel web researchers, synthesis, adversarial critic, streamed live |
| 8 | Eval Harness | Quality | Labs 2/6/7 as systems under test: golden suites, deterministic graders + optional LLM judge, per-case cost, stored runs with **regression diffs** and a model×suite matrix |

---

## Runtime topology

**Development** — two processes:

```
localhost:5173   Vite dev server (React)
      │  proxies /api/* → localhost:8000     (frontend/vite.config.ts)
      ▼
localhost:8000   uvicorn app.main:app
      │
      ├─ spawns the `claude` CLI per agent run   (Claude Agent SDK)
      └─ psycopg → PostgreSQL on host port 5433  (docker-compose.yml)
```

**Production (Docker / Render)** — one process. The multi-stage
[Dockerfile](../Dockerfile) builds the frontend to `frontend/dist`, and
[main.py](../backend/app/main.py) mounts it at `/` when that directory exists, so the API
and the UI are same-origin and no proxy is involved.

Two runtime constraints shaped the code and are worth knowing before changing it:

- **Sync DB drivers everywhere.** The Agent SDK spawns the `claude` CLI as a subprocess,
  which on Windows requires the Proactor event loop — and psycopg's async mode is
  incompatible with Proactor. Every DB call is therefore synchronous and wrapped in
  `asyncio.to_thread`.
- **Non-root container user.** The CLI refuses the `--dangerously-skip-permissions` flag
  (which `permission_mode="bypassPermissions"` passes) when running as root, so the image
  creates `appuser` with a writable `$HOME`.

---

## Folder layout

```
Lab_2-main/
├── docker-compose.yml          # PostgreSQL 18 (host port 5433)
├── Dockerfile                  # stage 1: vite build · stage 2: FastAPI + claude CLI + dist
├── render.yaml                 # single Render web service (Docker), /api/health check
├── .env.example                # ANTHROPIC_API_KEY, CLAUDE_MODEL, DB URLs, Fernet key
├── README.md · DEPLOY.md
├── docs/
│   ├── ARCHITECTURE.md         # this file
│   └── lab5.md                 # Lab 5 deep dive
│
├── backend/
│   ├── requirements.txt
│   ├── db/seed.py              # idempotent bootstrap: tables, seed rows, read-only role
│   ├── data/
│   │   ├── lab1/previous_shift.csv
│   │   ├── lab4/templates/*.docx + sample_workflow.md
│   │   └── lab6/docs/*.md          # Lab 6 policy corpus — the RAG knowledge base
│   ├── tests/                  # pytest — Lab 5 validator, credentials, drivers, router
│   └── app/
│       ├── main.py             # app wiring: routers, CORS, lifespan seed, static dist
│       ├── config.py           # model id, DB URLs, Fernet key, Lab 5 safety limits
│       ├── agent_runtime.py    # run_agent(prompt, options) — the one SDK entry point
│       ├── lab1_baseline.py    # L1 "previous shift" baseline, persisted in Postgres
│       ├── lab4_templates.py   # L4 approved template library (id → path/brand/agency)
│       ├── lab4_docx.py        # L4 renderer: job-aid JSON + template canvas → .docx
│       ├── agents/             # one agent module per lab (system prompt + options)
│       │   └── lab1_shift_report · lab2_permit_query · lab3_triage
│       │      · lab4_job_aid · lab5_query · lab6_doc_qa · lab7_research
│       ├── mcp_tools/          # in-process MCP servers
│       │   ├── permits.py      # L2: run_select
│       │   ├── workorders.py   # L3: read_work_orders + assign_crew
│       │   └── lab5_dynamic.py # L5: builds a per-connection server (run_query, list_tables)
│       ├── routers/            # one HTTP router per lab
│       │   └── lab1 · lab2 · lab3 · lab4 · lab5 · lab6 · lab7
│       ├── lab5/               # capstone services (see "Lab 5 internals")
│           ├── credentials.py  # Fernet encrypt/decrypt — the only plaintext boundary
│           ├── store.py        # lab5_connections persistence (public cols vs. full row)
│           ├── connection_service.py  # save / list / test / delete orchestration
│           ├── validator.py    # AST-based read-only SQL enforcement (Layer 1)
│           ├── deployment.py   # generate + register, with retry and scoped rollback
│           ├── registry.py     # process-lifetime map of live servers (+ rehydrate)
│           ├── verification.py # the acceptance checks
│           ├── errors.py       # friendly categories + secret redaction
│           └── drivers/        # base · postgres · mysql · mssql
│       ├── lab6/               # RAG pipeline: chunking · embedding · retrieval · index
│       ├── lab7/               # orchestration: runner · pipeline · orchestrator · dynamic · history
│       └── lab8/               # evals: suites · adapters · graders · results · runner
│
└── frontend/
    ├── vite.config.ts          # dev proxy: /api → http://localhost:8000
    └── src/
        ├── main.tsx, App.tsx   # router + sidebar nav + home dashboard
        ├── styles.css          # all app styling (single sheet, light + dark)
        ├── api/                # client.ts (fetch wrapper) + one module per lab
        ├── types/              # one module per lab + shared agent types
        ├── components/         # Markdown.tsx, icons.tsx
        ├── lib/                # download.ts, useTheme.ts
        └── labs/               # Lab1ShiftReport … Lab7DeepResearch (.tsx)
```

---

## The per-lab module pattern

Every lab is the same small set of pieces:

| Piece | Location | Responsibility |
|-------|----------|----------------|
| **Agent** | `backend/app/agents/labN_*.py` | System prompt + `ClaudeAgentOptions`; calls `run_agent()` |
| **MCP tool(s)** | `backend/app/mcp_tools/*.py` | In-process tools the agent may call (Labs 2, 3, 5) |
| **Router** | `backend/app/routers/labN.py` | HTTP endpoints; glues agent ↔ data ↔ frontend |
| **API module** | `frontend/src/api/labN.ts` | Typed wrappers over `request()` |
| **Types** | `frontend/src/types/labN.ts` | Request/response shapes shared by the API module and the view |
| **View** | `frontend/src/labs/LabN*.tsx` | The screen |

Shared, lab-agnostic building blocks:

- **`agent_runtime.run_agent(prompt, options)`** → `{result, tool_calls, tool_results, error}`
  — the single place the Claude Agent SDK is driven. It also captures the CLI's stderr and
  folds it into `error`, so a bad model id or auth failure surfaces as a real message
  instead of "Command failed with exit code 1". If `options.can_use_tool` is set (Lab 3),
  it automatically switches the prompt to the SDK's streaming form, which that callback
  requires.
- **`config.py`** — `CLAUDE_MODEL`, `DATABASE_URL`, `READONLY_DATABASE_URL`,
  `CREDENTIAL_ENCRYPTION_KEY`, and the Lab 5 limits (`LAB5_ROW_CAP`,
  `LAB5_CONNECT_TIMEOUT`, `LAB5_STATEMENT_TIMEOUT_MS`).
- **`main.py`** — one `include_router` line per lab, CORS for the Vite origin, a lifespan
  hook that runs the idempotent seed, and the static mount. Nothing lab-specific.
- **`api/client.ts`** — `request<T>()` throws an `ApiError` carrying the HTTP status and the
  backend's raw `detail`, so a view can render structured field errors (Lab 5's wizard)
  as easily as a plain string.
- **`App.tsx`** — the `LABS` array drives both the sidebar and the home cards; a lab with
  `ready: false` renders as "coming soon" and its link is inert.

## Data flow (identical for every lab)

```
Browser (labs/LabN.tsx)
   → api/labN.ts → request('/api/labN/...')
   → Vite dev proxy (:5173 → :8000)   [dev only; same-origin in production]
   → FastAPI router (routers/labN.py)
   → agent (agent_runtime → Claude Agent SDK → `claude` CLI → MCP tools)
   → data (CSV / Postgres / the user's own database)
   → JSON response → rendered in the UI
```

---

## Data stores

`db/seed.py` is **idempotent** and runs on every startup from the lifespan hook: it creates
missing tables, seeds them only when empty, and ensures the read-only role and its grants.
It never drops data, so user changes survive restarts. Running it as a script
(`python backend/db/seed.py`) is the destructive path — it drops and reseeds the demo tables.

| Table | Used by | Notes |
|-------|---------|-------|
| `permits` | Lab 2 | 50 rows, calendar year 2026. `SELECT`-granted to `labs_readonly` |
| `work_orders` | Lab 3 | 9 seeded rows; operators can add more via the UI |
| `crew_assignments` | Lab 3 | Written **only** by the Approve endpoint, via the read-write URL |
| `lab1_baseline` | Lab 1 | One row (`slot = 'previous'`) so "Set as previous" survives redeploys |
| `lab5_connections` | Lab 5 | Metadata + `password_ciphertext BYTEA`. Deliberately **not** granted to `labs_readonly`, so no agent-issued query can reach it |

`labs_readonly` is a `LOGIN` role with `SELECT` on the three demo tables only.
`READONLY_DATABASE_URL` falls back to `DATABASE_URL` when unset, so a minimal deploy works
with a single connection string — at the cost of that third safety layer.

---

## Safety model

The labs are a teaching sequence, and the safety mechanism is part of what each one teaches.
They are deliberately different from each other:

| Lab | Mechanism | Enforced by |
|-----|-----------|-------------|
| 1 | Capability scoping | `tools=["Read","Glob","Grep"]` and a per-request temp `cwd` — the agent has no write, bash, or network capability, and can only see the two CSVs |
| 2 | Read-only SQL + least privilege | A single-statement `SELECT`/`WITH` text guard, `conn.read_only = True`, and the `labs_readonly` role |
| 3 | Human-in-the-loop | `can_use_tool` denies every tool except `read_work_orders` during triage; the write path is the Approve button → `POST /api/lab3/approve`, never the agent |
| 4 | No tools at all | The agent only returns JSON; the `.docx` is rendered by trusted server code |
| 5 | Defense in depth | AST validation before the DB (Layer 1), a read-only session (Layer 2), row cap + statement timeout (Layer 3), Fernet-encrypted credentials at rest |
| 6 | Grounding | No tools at all — the fused top-k chunks in the prompt are the agent's entire knowledge. Citations `[n]` are required per claim, a `[[NOT_IN_CONTEXT]]` sentinel marks refusals, and a low-confidence retrieval gate skips generation entirely (an off-corpus question costs nothing and cannot hallucinate) |
| 7 | Bounded orchestration | Planned mode: the human approves the plan and code owns the control flow. Agent-loop mode: the model owns the flow but the **rails are code** — a hard researcher budget (the 7th is refused), a lead turn cap, and a `finalize` tool that refuses to publish until a draft passed verification. In both modes researchers get read-only web tools only, on a cheaper model, with `max_turns` and concurrency caps; delegation depth is exactly one; one worker's failure never kills the run |
| 8 | Measured trust | Adapters run the **production** agents unmodified; graders are deterministic wherever possible (execution-match, hit@k, citation validity); the LLM judge is opt-in and must show its reasoning; every run is stored and diffed so a regression is a named list, not a feeling |

Two honest caveats, so nobody mistakes the demo for a hardened service:

- **Lab 2's guard is a regex, not an AST.** `^(select|with)` plus a "no semicolon" check is
  enough to teach the idea, but it does not catch side-effecting functions the way
  `lab5/validator.py` does. Lab 5 is the grown-up version of the same guard. Pointing
  `permits._looks_read_only` at `validator.validate` is a small change if you ever want them
  consistent.
- **There is no authentication.** Every endpoint is open, and Lab 5 will connect outbound to
  any host you give it. That is fine for a local demo or a private walkthrough; it is not
  something to leave publicly reachable.

---

## Adding a lab (Lab 7) — nothing else changes

1. `backend/app/agents/lab7_*.py` — system prompt + `ClaudeAgentOptions`.
2. *(optional)* `backend/app/mcp_tools/*.py` if it needs tools.
3. `backend/app/routers/lab7.py` — endpoints.
4. One line in `main.py`: `app.include_router(lab7.router)` (plus the import).
5. `frontend/src/types/lab7.ts` + re-export from `types/index.ts`.
6. `frontend/src/api/lab7.ts` + re-export from `api/index.ts`.
7. `frontend/src/labs/Lab7*.tsx`, then add an entry to `LABS` and a `<Route>` in `App.tsx`.

---

# Lab I/O contracts

`GET /api/health` → `{"status": "ok"}` (Render's health check).

Every agent-backed endpoint can return a non-null `error`. Where the agent produced no
usable output at all, the router raises **502** with the SDK/CLI detail attached.

## Lab 1 — Production Shift Report (file in → report out)

- **UI input:** pick a shift-log **CSV**, press **Generate**. *Download a sample log* fetches
  a freshly randomized file (~65% of the time it seeds an anomaly on a random line, so the
  Exceptions section has something to flag).
- **Expected CSV columns:** `timestamp, line, units_produced, downtime_minutes, defects`
  (one hourly row per production line).
- **Baseline:** the comparison shift is stored in `lab1_baseline` and supplied automatically.
  The agent runs in a temp dir containing `current_shift.csv` + `previous_shift.csv`, which
  is deleted after the run.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| POST | `/api/lab1/generate` | `multipart/form-data`, field **`file`** = CSV | `{ result: "<markdown report>", tool_calls: [...], tool_results: {...}, error, baseline: {...} }` |
| POST | `/api/lab1/set-previous` | `multipart/form-data`, field **`file`** = CSV | `{ ok: true, baseline: {...} }` — 400 with a reason if the CSV fails validation |
| POST | `/api/lab1/reset-previous` | — | `{ ok: true, baseline: {...} }` (restores the seeded sample) |
| GET | `/api/lab1/baseline-info` | — | `{ baseline: { source, readings, lines, time span, … } }` |
| GET | `/api/lab1/sample` | — | CSV download, randomized per call (`Cache-Control: no-store`) |

- **UI output:** the rendered one-page report (Summary · By Line · Exceptions) + a
  **Download .md** button.

## Lab 2 — Permit Status Query (question in → answer + SQL + table out)

- **UI input:** a plain-English **question** (typed or a sample chip), press **Ask**.
- **Data:** the Postgres `permits` table, queried read-only.
- The agent's only tool is `mcp__permits__run_select`; `tools=[]` removes all built-ins.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| POST | `/api/lab2/ask` | `{ "question": "How many electrical permits are pending from June?" }` | `{ answer, sql, table: { ok, columns, rows }, error }` |
| POST | `/api/lab2/ask/stream` | same body | **NDJSON** event stream (below) |
| GET | `/api/lab2/dataset` | — | `{ total, types: [{name,count}], statuses: [{name,count}], date_range: {min,max} }` |

Stream events, one JSON object per line (`application/x-ndjson`):

| Event | Payload | Meaning |
|-------|---------|---------|
| `status` | `{phase: "writing"｜"running"}` | The agent is composing SQL / executing it |
| `sql` | `{sql}` | The query the agent chose |
| `answer_reset` | — | Discard text streamed before the tool ran (it was preamble) |
| `table` | `{table: {ok, columns, rows}}` | Rows parsed from the tool's own result — no second query |
| `delta` | `{text}` | A chunk of the plain-language answer |
| `done` | `{answer, sql, refused, error}` | Terminal event |

- **UI output:** the plain-language answer, the exact SQL, and the results table. A write
  request is refused: the agent prefixes `[[READONLY_REFUSAL]]`, which the UI swaps for a
  "read-only — write declined" badge.

## Lab 3 — Work Order Triage (queue in → proposals out → approve to write)

- **UI input:** **Run triage**; per row a crew **dropdown** and an **Approve** button; operators
  can file a new work order; **Reset demo** clears assignments.
- **Data:** `work_orders` (read) + `crew_assignments` (written only on approval).
- Proposals are merged onto the live queue and sorted safety-first
  (`safety` → `production-stopping` → `routine`).

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | `/api/lab3/crews` | — | `{ crews: [...] }` |
| GET | `/api/lab3/queue` | — | `{ orders: [ {id, wo_number, machine, description, status, crew, urgency, …} ] }` |
| POST | `/api/lab3/work-orders` | `{ machine, description, submitted_by? }` | `{ ok: true, order: {...} }` — 400 if either field is blank |
| POST | `/api/lab3/triage` | — | `{ orders: [ {…, proposed_urgency, proposed_crew, reason} ], tool_calls, raw, error }` |
| POST | `/api/lab3/approve` | `{ work_order_id, crew, urgency, approved_by? }` | `{ ok: true, assignment_id, assigned_at }` |
| POST | `/api/lab3/reset` | — | `{ ok: true }` |

- **UI output:** the triage dashboard — WO · machine/issue · urgency badge · crew · action.
  Safety items pin to the top with a red accent; approved rows show **✓ Assigned**. The
  agent's tool calls are surfaced so the MCP usage is visible.

## Lab 4 — Citizen Service Job Aid (workflow + template → branded .docx)

- **UI input:** a **document type** (`Job Aid`, `User Manual`, `Training Guide`, `Training`), a
  tested **workflow**, and a **template**. Both the workflow and the template accept three
  sources, resolved **upload > link > library/paste**:
  - workflow: `.docx` / `.pdf` / `.txt` / `.md` upload, a URL, or pasted text (min 20 chars
    of extractable text — a scanned, text-layer-less PDF gets a clear 400).
  - template: an uploaded `.docx`, a URL to one, or an id from the approved library.
- The agent gets **no tools**; it returns job-aid JSON, which server code date-stamps
  (`effective_date`, `review_date` — the agent is told not to invent dates) and renders onto
  the template canvas with the template's brand color.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | `/api/lab4/templates` | — | `{ templates: [ {id, name, agency, …} ] }` |
| GET | `/api/lab4/sample` | — | `sample_workflow.md` download |
| POST | `/api/lab4/generate` | `multipart/form-data`: `doc_type`, `workflow_text`, `workflow_url`, `template_id`, `template_url`, `workflow_file`, `template_file` | `{ job_aid: {...}, template_name, filename, docx_base64 }` |

- **UI output:** a structured preview of the job aid plus a one-click download — the `.docx`
  comes back base64 in the same round-trip, so there is no second fetch and no temp file to
  serve.

## Lab 5 — On-the-Fly MCP Server Builder (capstone)

Connect *your own* database; the app generates, deploys, and verifies a read-only MCP server
for it, then lets you ask questions in plain English. See [lab5.md](lab5.md) for the deep dive.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | `/api/lab5/drivers` | — | `{ drivers: [ {id, label, available, default_port, reduced_guarantees} ] }` |
| GET | `/api/lab5/connections` | — | `{ connections: [...] }` — **metadata only**, never the password or ciphertext |
| POST | `/api/lab5/connections` | `{ driver, host, port, database, username, password, name?, ssl_mode? }` | `{ id, connection }` · 400 `{message, fields}` · 503 if the Fernet key is missing |
| POST | `/api/lab5/connections/{id}/test` | — | `{ ok, category, message }` |
| POST | `/api/lab5/connections/{id}/deploy` | — | `{ ok, status, server_url, tool_ids, logs, code }` |
| POST | `/api/lab5/connections/{id}/verify` | — | `{ ok, checks: [ {label, ok, detail} ] }` |
| POST | `/api/lab5/connections/{id}/query` | `{ question }` | `{ answer, sql, table, error }` · 502 on agent failure |
| DELETE | `/api/lab5/connections/{id}` | — | `{ ok: true }` — unregisters the live server, then deletes the row |

The password is submitted once and never echoed back: it is Fernet-encrypted on save, and the
public column list in `store.py` physically excludes the ciphertext, so "don't leak it" is a
property of the query rather than a filter someone has to remember to apply.

### Lab 5 internals

**The six-stage flow.** Save → Test → Deploy → Verify → Query, with statuses recorded on the
row (`saved` → `tested` → `deployed` → `verified`).

**"Generating an MCP server"** means building in-process `@tool` closures over a connection id
and handing them to `create_sdk_mcp_server` — the same mechanism `permits.py` uses. The server
exposes exactly two tools:

- `run_query(sql)` — validate, then execute one read-only statement.
- `list_tables()` — dialect-specific `information_schema` introspection, so the agent can
  target real tables.

The tool schema is only `{sql: str}`. Credentials never enter the schema, the agent context,
the results, the logs, or the server name — the password is decrypted only inside the sync
worker, at execution time.

**The registry is intentionally ephemeral.** It is a process-lifetime dict; on a cold start
`get_or_rehydrate` rebuilds the handle from the encrypted row, so a restart loses the volatile
handle but never the connection.

**Layered read-only enforcement:**

1. **Layer 1 — `validator.py` (AST, before any DB connection).** Parses with sqlglot in the
   driver's dialect and fails closed: any parse error is a rejection, exactly one statement is
   allowed, the root must be a read shape, and write/DDL/`Command` nodes are rejected
   *anywhere* in the tree (which catches write-CTEs and writes buried in subqueries).
   `SELECT … INTO` and a denylist of side-effecting functions — filesystem (`pg_read_file`,
   `load_file`), OS (`xp_cmdshell`), DoS (`pg_sleep`, `benchmark`), admin/signal
   (`pg_terminate_backend`), advisory locks, sequence mutation — are rejected too. Several of
   those are *not* blocked by a read-only transaction, which is exactly why Layer 1 exists.
2. **Layer 2 — read-only session** (`set_session_read_only`), best-effort. Engines where this
   is weaker advertise `reduced_guarantees: true` so the wizard can say so.
3. **Layer 3 — resource caps.** `LAB5_ROW_CAP` (fetch one past the cap to detect truncation),
   `LAB5_STATEMENT_TIMEOUT_MS`, `LAB5_CONNECT_TIMEOUT`.

**Adding an engine** (Oracle, SQLite): subclass `DatabaseDriver`, import it in
`drivers/__init__.py`, add it to `_INSTANCES`. Nothing else changes. Driver imports are
guarded, so a missing system library degrades that engine to `available: false` instead of
breaking app import.

**Errors never leak.** `errors.classify` maps a native driver exception to one of nine fixed
categories with a friendly message; `errors.redact` scrubs secrets and DSN-embedded
credentials from anything logged or returned. Raw exceptions and DSNs reach neither the
client nor the agent.

**Deploy is retried and rolls back cleanly.** One retry; a failed attempt unregisters only the
handle *that attempt* created, so a pre-existing verified server is never torn down; and the
generated-code artifact is cosmetic — its failure cannot fail an otherwise-working deploy.

**The downloadable code artifact** is a standalone, secret-free MCP server (credentials read
from environment variables) shown so the generated server is inspectable. The server that
actually runs is the in-process one.

## Lab 6 — Policy Q&A (RAG with every stage visible)

Ask plain-English questions over a folder of markdown policy documents. The lab's point is
that nothing about RAG is hidden: the response carries the full pipeline trace — chunk
provenance, both retriever rankings with per-term evidence, the RRF fusion table, the exact
augmented prompt, and per-stage timings — and the UI renders every stage.

- **Corpus:** `backend/data/lab6/docs/*.md` (Riverbend County permit policies), plus anything
  the user uploads (`.md`/`.txt`/`.pdf`, ≤500 KB) — uploads are stored as `user-*.md`, marked
  in the UI, and individually removable; seeded docs are fixed. Upload responses carry an
  **ingestion trace** (receive → extract → chunk → index rebuild, with timings and
  before/after chunk/vocabulary counts) so ingestion is shown, not just reported. Editing a
  file on disk + *Reindex* works too — ingestion is a live pipeline, not a build step.
- **Pipeline:** heading-aware chunking with overlap (`app/lab6/chunking.py`) → vectors
  (`embedding.py`: local TF-IDF by default; Voyage AI semantic embeddings when
  `VOYAGE_API_KEY` is set) → dual retrieval + Reciprocal Rank Fusion (`retrieval.py`) →
  in-memory index + search trace (`index.py`). No database is involved.
- **Generation:** a no-tools agent (Lab 4 style) whose prompt contains only the fused top-k
  chunks as numbered sources; it must cite `[n]` after each claim and refuses with a
  `[[NOT_IN_CONTEXT]]` sentinel when the corpus doesn't cover the question. `retrieve_only`
  runs the pipeline without the model call — retrieval demos are free.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | `/api/lab6/corpus` | — | `{ backend, note, built_ms, chunk_count, vector_dims, params, docs: [...] }` |
| GET | `/api/lab6/chunks/{doc_id}` | — | `{ doc_id, chunks: [ {chunk_id, heading, text, overlap_prefix_chars, …} ] }` — 404 for unknown ids |
| POST | `/api/lab6/ask` | `{ question, k? (1-8), retrieve_only? }` | `{ answer, citations, refused, low_confidence, backend, stages: {query, vector, lexical, fusion, augment, generate}, error }` |
| POST | `/api/lab6/upload` | `multipart/form-data`, field **`file`** = `.md`/`.txt`/`.pdf` (≤500 KB) | `{ doc, trace: {receive, extract, chunk, index}, corpus }` — 400 for bad type/size/no text layer |
| DELETE | `/api/lab6/docs/{doc_id}` | — | Updated corpus summary. Only `user-*` uploads are removable (400 otherwise, 404 if absent) |
| POST | `/api/lab6/reindex` | — | Same shape as `/corpus`; drops and rebuilds the index |

- **UI output:** the six-stage pipeline strip with live timings, a corpus/chunk inspector
  (overlap highlighted), both retriever rankings with score bars and matched-term pills, the
  fusion table, the numbered sources, the exact prompt, and the answer with clickable `[n]`
  citations that jump to their source chunk.

## Lab 7 — Deep Research (multi-agent orchestration, live)

One research question in; a verified, cited brief out — produced by a team of agents whose
every hand-off streams to the UI. The lab ships **both orchestration patterns side by side**,
and the contrast is the lesson:

- **Planned (workflow) mode** — the model plans, code executes. `lab7/orchestrator.py` owns
  fan-out, concurrency, the join, the verification loop, and failure handling; no agent ever
  controls another agent.
- **Agent-loop (autonomous) mode** — the model runs the loop. A lead agent
  (`lab7/dynamic.py`) gets exactly three tools — `delegate_research`, `submit_draft`,
  `finalize` — and iterates think → choose-a-tool → observe until it publishes. Its decision
  narration streams as `turn` events, so the loop itself is visible. Code keeps the rails: a
  total researcher budget, a lead turn cap, and a `finalize` that refuses until a draft
  passed verification.

- **Roles** (`agents/lab7_research.py`): a planner (no tools) decomposes the question into
  independent angles; parallel researchers (WebSearch/WebFetch only, `LAB7_RESEARCHER_MODEL`,
  `max_turns`-capped) gather findings with URLs and ≤25-word quotes; a synthesizer (no tools)
  writes one brief citing a shared, deduped source numbering; an adversarial critic (no
  tools) tries to refute the brief against the evidence table — real problems trigger exactly
  one revision round.
- **The approval gate:** `/plan` costs one model call and returns the decomposition; nothing
  else runs until the human posts the (optionally trimmed) plan to `/run/stream`.
- **Live stream:** worker lifecycle, every search/fetch as it happens, the deduped source
  list, the draft, the verdict, the revision — NDJSON, same pattern as Lab 2.
- **Quantified and reproducible:** every agent reports its real dollar cost (from the SDK's
  result usage) — per worker and per run; every run is recorded to a JSONL and can be
  **replayed offline** from the UI with its original pacing (free, deterministic demos);
  a **Stop** button aborts a live run; researchers carry a wall-clock timeout on top of
  `max_turns`; and the final brief gets a code-side **citation check** (`[n]` numbers that
  don't exist in the source list are flagged).

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | `/api/lab7/config` | — | `{ orchestrator_model, researcher_model, max_breadth, worker_concurrency, worker_max_turns, dyn_max_researchers, dyn_max_turns }` |
| POST | `/api/lab7/plan` | `{ question, breadth (2-4) }` | `{ plan: {restated_goal, synthesis_focus, angles[]}, error }` |
| POST | `/api/lab7/run/stream` | `{ question, plan }` (the approved plan) | **NDJSON**: `stage`, `worker`, `tool`, `worker_done`, `sources`, `report`, `verdict`, `done` events |
| POST | `/api/lab7/run-dynamic/stream` | `{ question, max_researchers? }` — no plan; the lead decides. Lowering `max_researchers` provokes the budget rail live | **NDJSON**: adds `turn` (the lead's decision log + tool choice), `budget`, and `note` events to the set above |
| GET | `/api/lab7/runs` | — | `{ runs: [...] }` — every run is recorded (JSONL in `backend/data/lab7/runs/`) with outcome, totals, and cost |
| GET | `/api/lab7/runs/{run_id}` | — | The full recorded event stream — powers offline **replay** with original pacing (no model calls, no cost) |
| DELETE | `/api/lab7/runs/{run_id}` | — | Remove a recording |

- **UI output:** the five-step pattern strip (Plan → Approve → Research ×N → Synthesize →
  Verify), the plan as toggleable angle cards, a live worker grid with per-agent activity
  feeds, the shared citation space, the brief (with the pre-revision draft kept when the
  critic forced changes), and run totals (agents, tool calls, wall time).

## Lab 8 — Eval Harness (how you know it works)

Labs 2, 6 and 7 become systems under test. Golden suites live as reviewable JSON in
`backend/data/lab8/suites/`; adapters run the **production agents unmodified** (a model
override is applied to the options object, never by re-implementing an agent), so a passing
eval means the thing users actually run passes.

- **Graders:** deterministic first — Lab 2 by **execution-match** (the agent's SQL and the
  golden SQL both run against the live database; result sets compared order-insensitively
  with float tolerance), Lab 6 by retrieval hit@k (free — no model call), answer containment,
  citation validity, and correct refusal; Lab 7 by SLOs (brief produced, citations valid,
  min sources, cost and wall-time ceilings). The **LLM-as-judge** (faithfulness to retrieved
  context) is opt-in per run and must return its reasoning, which the UI displays.
- **Every run is stored** (`backend/data/lab8/results/*.json`) with per-case checks, cost,
  and timing — powering the history table, the **regression diff** (newly-failing and
  newly-passing cases vs the previous run), and the **model×suite pass-rate matrix** for
  tier comparisons.

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | `/api/lab8/suites` | — | `{ suites: [...], configured_model, model_options }` |
| POST | `/api/lab8/run/stream` | `{ suites, model?, judge? }` | **NDJSON**: `run_meta`, `suite_start`, `case_start`, `case_done` (with per-check verdicts + cost), `suite_done`, `done` (totals + regression diff) |
| GET | `/api/lab8/results` | — | Stored runs, newest first |
| GET | `/api/lab8/results/{run_id}` | — | One stored run in full detail |
| DELETE | `/api/lab8/results/{run_id}` | — | Remove a stored run |

- **UI output:** suite pickers (heavy suites deselected by default), live case rows with
  expandable per-check verdicts, run totals with real dollar cost, the regression banner,
  the model×suite matrix, and the stored-run history.

---

## Tests

`backend/tests/` — pytest, focused on Lab 5 (the highest-risk surface) and Lab 6's
retrieval quality:

| File | Covers |
|------|--------|
| `test_lab5_validator.py` | Parametrized allow/deny corpora per dialect — the security contract |
| `test_lab5_credentials.py` | Fernet round-trip, missing/invalid key behavior |
| `test_lab5_drivers.py` | Driver registry, availability degradation |
| `test_lab5_router.py` | Endpoint shapes, and that responses omit the password/ciphertext |
| `test_lab6_rag.py` | Chunking invariants (coverage, bounds, overlap), TF-IDF/BM25/RRF math, **golden-set hit@k retrieval quality**, the low-confidence gate, and the retrieve-only endpoint — all offline, no LLM |
| `test_lab7_orchestration.py` | Plan validation/JSON parsing, cross-worker source dedupe, the **orchestrator's event contract** (approved path, revision loop, worker-failure survival), and the **agent-loop rails** (researcher budget enforced, finalize refused until verification, shared citation numbering) with agent roles faked — all offline, no LLM, no web |
| `test_lab8_evals.py` | Suite loading, the **deterministic graders** (order-insensitive/float-tolerant result-set comparison, containment, refusal, citations, bounds), results store + **regression diff**, and the runner's streaming contract with adapters faked — all offline |

```bash
cd backend && pip install pytest && python -m pytest -q
```

Labs 1–4 and the frontend have no automated tests. If you add any, the highest-value first
target is Lab 3's write gate — "the triage agent cannot write" is a security claim with
nothing currently asserting it.
