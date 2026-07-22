# syntax=docker/dockerfile:1

# ─── Stage 1: build the React + TypeScript frontend ───────────────────────
FROM node:20-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # tsc -b && vite build  →  /build/dist

# ─── Stage 2: runtime (FastAPI + Claude Code CLI + built frontend) ────────
FROM python:3.12-slim AS runtime

# Node + the Claude Code CLI. The Agent SDK launches `claude` as a subprocess,
# so the CLI (and Node) must be present on PATH in the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g @anthropic-ai/claude-code \
 && apt-get purge -y --auto-remove gnupg \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Python dependencies (cached layer)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Backend source (includes db/ and data/)
COPY backend/ ./

# Built frontend → /app/frontend/dist, which app/main.py mounts at "/"
COPY --from=frontend /build/dist /app/frontend/dist

ENV PYTHONUNBUFFERED=1
# Bind to the platform-provided $PORT (Render sets this); default for local runs.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
