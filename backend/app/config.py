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
