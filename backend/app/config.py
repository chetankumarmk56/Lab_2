"""Shared configuration for the labs backend."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"

# Model the Claude Agent SDK runs on. Override via CLAUDE_MODEL in .env.
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-4-8")

# Postgres connection string (used from Lab 2 onward).
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://labs:labs_dev_pw@localhost:5433/agentic_labs"
)

# Read-only Postgres role used by the Lab 2 query tool (defense in depth).
READONLY_DATABASE_URL = os.getenv(
    "READONLY_DATABASE_URL",
    "postgresql://labs_readonly:labs_readonly_pw@localhost:5433/agentic_labs",
)
