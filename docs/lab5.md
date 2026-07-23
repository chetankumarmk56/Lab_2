# Lab 5 — On-the-Fly MCP Server Builder

A non-technical user connects **their own** database (PostgreSQL / MySQL / SQL
Server) and the app generates, deploys, registers, and verifies a **read-only**
MCP query server they can then ask questions in natural language — no code, in
under ten minutes. Write operations can never reach the database.

## Architecture

Built entirely on the project's existing **in-process** MCP model — there is no
Lambda / per-service deploy system, and none is introduced.

| Spec verb | Implementation |
|-----------|----------------|
| **Generate** | Build per-connection `@tool` closures (`run_query`, `list_tables`) and hand them to `claude_agent_sdk.create_sdk_mcp_server` — the same mechanism as `permits.py`. Also emit an inspectable standalone code artifact. |
| **Deploy** | Instantiate that in-process server and record it in a process-lifetime `ConnectionRegistry`. `server_url` is a logical id `mcp://userdb_{id}`. |
| **Register** | Hand the server to `ClaudeAgentOptions(mcp_servers=…, allowed_tools=…)` per query — how every lab registers its tools. |
| **Verify** | Run the six acceptance checks directly against the read-only path. |

**Service package** (`backend/app/lab5/`): `credentials`, `errors`, `store`,
`connection_service`, `validator`, `drivers/` (base + postgres/mysql/mssql +
registry), `registry`, `deployment`, `verification`. The dynamic MCP generator is
`app/mcp_tools/lab5_dynamic.py`; the locked-down agent is
`app/agents/lab5_query.py`; the HTTP boundary is `app/routers/lab5.py`.

All DB access is **synchronous** (psycopg / PyMySQL / pymssql) wrapped in
`asyncio.to_thread` — the Windows Proactor loop the Agent SDK requires is
incompatible with async DB drivers.

## Six-stage flow

1. **Connect** — wizard collects driver, host, port, database, username, password
   (masked). `POST /connections` Fernet-encrypts the password and stores metadata
   + ciphertext.
2. **Test** — `POST /connections/{id}/test` makes a real connection + trivial read
   with a hard timeout; returns a friendly category, never a stack trace.
3–5. **Generate + Deploy + Register** — `POST /connections/{id}/deploy` builds the
   read-only server, registers it, returns status/url/logs + the generated code.
   Bounded retry; fail-closed rollback (unregister).
6. **Verify** — `POST /connections/{id}/verify` checks: server registered,
   connection works, SELECT works, writes blocked, callable → success page.

Then `POST /connections/{id}/query` answers natural-language questions through the
registered server (NL → `list_tables` → `run_query`).

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/lab5/drivers` | Engines available in this deployment |
| GET | `/api/lab5/connections` | Saved connections (**metadata only**) |
| POST | `/api/lab5/connections` | Save (encrypt + persist) |
| POST | `/api/lab5/connections/{id}/test` | Test connection |
| POST | `/api/lab5/connections/{id}/deploy` | Generate + deploy + register |
| POST | `/api/lab5/connections/{id}/verify` | Acceptance checks |
| POST | `/api/lab5/connections/{id}/query` | NL query (read-only) |
| DELETE | `/api/lab5/connections/{id}` | Unregister + delete |

## Configuration

| Env var | Purpose |
|---------|---------|
| `CREDENTIAL_ENCRYPTION_KEY` | **Required.** Fernet key for encrypting stored passwords. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. No fallback — Lab 5 refuses to store credentials without it. |
| `LAB5_ROW_CAP` | Max rows per query (default 500). |
| `LAB5_CONNECT_TIMEOUT` | Connect timeout, seconds (default 8). |
| `LAB5_STATEMENT_TIMEOUT_MS` | Per-query timeout, ms (default 15000). |

New Postgres table `lab5_connections` (created idempotently by
`db.seed.ensure_seeded`) stores the encrypted connections. It is deliberately
**not** granted to `labs_readonly`. New deps: `cryptography`, `sqlglot`,
`PyMySQL`, `pymssql` — all in `requirements.txt`; no Dockerfile change needed.

## Security (read-only by construction, four independent layers)

1. **AST validation** (`validator.py`, sqlglot) — runs **before** any DB
   connection. Allows only a single `SELECT` / `WITH … SELECT` / `UNION` of
   selects; rejects all DML/DDL/commands, write-CTEs, multi-statement, `SELECT
   INTO`, `COPY`/`OUTFILE`, `EXEC`/`CALL`, and side-effecting functions.
   **Fail-closed**: any parser uncertainty is a rejection.
2. **Read-only DB session** — Postgres `SET default_transaction_read_only = on`;
   MySQL `SET SESSION TRANSACTION READ ONLY`. (SQL Server has no equivalent →
   `reduced_guarantees`; leans on Layers 1 & 3.)
3. **Least-privilege credential** — the app strongly steers the user to a
   SELECT-only DB login (the only layer covering user-defined mutating functions).
4. **Driver hardening** — single-statement only, connect/statement timeouts,
   app-side row cap.

**Credential handling** — the password is Fernet-encrypted at rest, decrypted only
just-in-time inside the sync worker, and structurally excluded from every API
response, log line, error message, agent prompt, tool schema (`{sql}` only), and
the generated code. Driver errors are mapped to friendly categories; raw
exceptions/DSNs are never forwarded or logged.

> **Production note:** set `READONLY_DATABASE_URL` to the restricted `labs_readonly`
> role so no agent-issued query against the *app's* DB can read `lab5_connections`
> metadata. The stored password is Fernet-encrypted regardless.

## Extending to a new engine (Oracle, SQLite, …)

1. Add a `DatabaseDriver` subclass under `app/lab5/drivers/`.
2. Import it and add it to `_INSTANCES` in `drivers/__init__.py`.
3. Add the driver package to `requirements.txt` and the dialect to the validator's
   `_DIALECT` map. Nothing else changes.
