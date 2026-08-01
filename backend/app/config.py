"""Shared configuration for the labs backend."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"

# Model the Claude Agent SDK runs on. Defaults to the cheap Haiku tier so a
# deployment doesn't burn Opus-priced tokens; override via CLAUDE_MODEL.
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5")

# Postgres connection string (used from Lab 2 onward).
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://labs:labs_dev_pw@localhost:5433/agentic_labs"
)

# Read-only Postgres role used by the Lab 2 query tool (defense in depth).
# Falls back to DATABASE_URL when unset, so a minimal deploy works with just one
# connection string (set this to the labs_readonly role for the full read-only demo).
READONLY_DATABASE_URL = os.getenv("READONLY_DATABASE_URL") or DATABASE_URL

# ─── Lab 5: On-the-Fly MCP Server Builder ───────────────────────────
# Fernet key used to encrypt stored target-database passwords at rest. REQUIRED
# for Lab 5 (the credential service fails fast if it's missing — no silent
# ephemeral key). Generate one with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
CREDENTIAL_ENCRYPTION_KEY = os.getenv("CREDENTIAL_ENCRYPTION_KEY")

# Read-only safety limits applied to every query against a user-connected DB.
LAB5_ROW_CAP = int(os.getenv("LAB5_ROW_CAP", "500"))                     # max rows returned
LAB5_CONNECT_TIMEOUT = int(os.getenv("LAB5_CONNECT_TIMEOUT", "8"))       # connect timeout (s)
LAB5_STATEMENT_TIMEOUT_MS = int(os.getenv("LAB5_STATEMENT_TIMEOUT_MS", "15000"))  # per-query (ms)

# ─── Lab 6: Policy Q&A (RAG) ────────────────────────────────────────
# Folder of markdown policy documents that forms the retrieval corpus.
LAB6_DOCS_DIR = DATA_DIR / "lab6" / "docs"

# How many fused chunks are placed in the model's context per question (1-8).
LAB6_TOP_K = int(os.getenv("LAB6_TOP_K", "5"))

# Optional semantic-embedding backend. When VOYAGE_API_KEY is set, chunk and
# query vectors come from the Voyage AI embeddings API (Anthropic's embeddings
# partner); otherwise Lab 6 uses a fully local TF-IDF vector space — zero extra
# keys, and every similarity score decomposes into per-term contributions.
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY") or None
LAB6_VOYAGE_MODEL = os.getenv("LAB6_VOYAGE_MODEL", "voyage-3.5-lite")

# ─── Lab 7: Deep Research (orchestration) ───────────────────────────
# Researchers run on a cheaper tier by default — cost-tiered orchestration is
# part of what the lab teaches. Planner/synthesizer/critic use CLAUDE_MODEL.
LAB7_RESEARCHER_MODEL = os.getenv("LAB7_RESEARCHER_MODEL", "claude-haiku-4-5")
LAB7_MAX_BREADTH = int(os.getenv("LAB7_MAX_BREADTH", "4"))                 # max parallel angles
LAB7_WORKER_CONCURRENCY = int(os.getenv("LAB7_WORKER_CONCURRENCY", "3"))   # subprocess cap
LAB7_WORKER_MAX_TURNS = int(os.getenv("LAB7_WORKER_MAX_TURNS", "16"))      # runaway-worker stop

# Agent-loop (autonomous) mode: the lead agent decides everything, but inside
# hard rails owned by code — a total researcher budget and a lead turn cap.
LAB7_DYN_MAX_RESEARCHERS = int(os.getenv("LAB7_DYN_MAX_RESEARCHERS", "6"))
LAB7_DYN_MAX_TURNS = int(os.getenv("LAB7_DYN_MAX_TURNS", "24"))

# Wall-clock cap per researcher (max_turns caps turns; a hung fetch needs this).
LAB7_WORKER_TIMEOUT_S = int(os.getenv("LAB7_WORKER_TIMEOUT_S", "180"))

# Every Lab 7 run's event stream is recorded here (JSONL per run) so past runs
# can be listed and replayed offline — free, deterministic demos.
LAB7_RUNS_DIR = DATA_DIR / "lab7" / "runs"

# ─── Lab 8: Eval Harness ────────────────────────────────────────────
# Golden eval suites (JSON case files) and stored eval-run results. Results
# power the run history, the regression diff, and the model×suite matrix.
LAB8_SUITES_DIR = DATA_DIR / "lab8" / "suites"
LAB8_RESULTS_DIR = DATA_DIR / "lab8" / "results"
