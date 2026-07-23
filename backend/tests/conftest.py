"""Test bootstrap: put backend on sys.path and load the local .env (encryption key + DB URLs)."""
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent

sys.path.insert(0, str(BACKEND))
load_dotenv(ROOT / ".env")
