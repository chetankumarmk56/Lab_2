# Deploying (free) on Render + Neon

One Docker container serves both the FastAPI backend and the built React frontend.
A free Neon Postgres holds the data. The app **auto-seeds the database on startup**,
so there's no manual seed step.

## Two things to know first
1. **Hosting is free; the AI usage is not.** Every lab run calls Claude on your
   `ANTHROPIC_API_KEY`. The default model is the cheap `claude-haiku-4-5` tier.
2. **Anyone with the URL can spend your key.** Render doesn't put the app behind
   auth. Keep the URL private, or ask me to add a password gate.

---

## 1. Create a free Postgres (Neon)
1. Sign up at <https://neon.tech> (no credit card).
2. Create a project → copy the **connection string**. It looks like:
   ```
   postgresql://<user>:<password>@<host>/<db>?sslmode=require
   ```
   This is your `DATABASE_URL`.
3. *(Optional, for the full read-only demo)* The app auto-creates a `labs_readonly`
   role on first boot. To use it, set `READONLY_DATABASE_URL` to the same string but
   with the user/password swapped to `labs_readonly` / `labs_readonly_pw`. If you
   skip this, reads fall back to `DATABASE_URL` (the labs still work).

## 2. Push this repo to GitHub
Render deploys from a Git repo. Push your code (the `Dockerfile`, `render.yaml`,
`.dockerignore` are already here). **Do not commit `.env`** — it's git-ignored.

## 3. Create the Render service
- Go to <https://render.com> → **New → Blueprint**, pick your repo. Render reads
  `render.yaml` and creates a free Docker web service.
- When prompted, set the secrets:
  - `ANTHROPIC_API_KEY` — your Anthropic key
  - `DATABASE_URL` — the Neon string from step 1
  - `READONLY_DATABASE_URL` — optional (step 1.3); for Lab 5, point it at the restricted role
  - `CREDENTIAL_ENCRYPTION_KEY` — **required for Lab 5**; a Fernet key for encrypting stored DB passwords. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
  - `CLAUDE_MODEL` — already `claude-haiku-4-5` (change if you want)
- Click **Apply / Deploy**. First build takes a few minutes (it installs Node, the
  `claude` CLI, and Python deps, and builds the frontend).

## 4. Open it
Render gives you `https://agentic-labs-xxxx.onrender.com`. On first request the app
boots, **auto-seeds Neon** (50 permits, 9 work orders, the read-only role), and serves
the UI. All four labs work.

---

## Notes & limits
- **Free tier sleeps** after ~15 min idle; the next request cold-starts (~30–60s).
- **Seeding is idempotent** — it only creates tables if missing and inserts data if
  empty, so restarts and redeploys never wipe your data. To wipe and reseed, run
  `python backend/db/seed.py` against the DB (that one is destructive).
- **Cost control:** stay on `claude-haiku-4-5`. Opus is ~10× the price.
- **Health check:** `GET /api/health` → `{"status":"ok"}`.

## Deploying elsewhere
The `Dockerfile` is portable — the same image runs on Fly.io, Google Cloud Run, a
VPS, or Hugging Face Spaces. Any host that runs a container and allows subprocesses
works (the CLI-subprocess requirement rules out Vercel/Netlify/Cloudflare functions).
Provide the same env vars and expose `$PORT`.
