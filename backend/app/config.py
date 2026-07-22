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
