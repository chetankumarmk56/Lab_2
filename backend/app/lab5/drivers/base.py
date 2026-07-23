"""Lab 5 — DatabaseDriver abstraction.

One small interface per database engine so PostgreSQL/MySQL/SQL Server (and later
Oracle/SQLite) all present the same read-only surface. Every method is SYNC
(psycopg / PyMySQL / pymssql) — callers wrap them in asyncio.to_thread because the
Windows Proactor loop the Agent SDK needs is incompatible with async DB drivers.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any


class DriverUnavailable(RuntimeError):
    """Raised when a requested engine's driver/system library isn't installed."""


@dataclass
class ConnParams:
    driver: str
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_mode: str | None = None


@dataclass
class DriverResult:
    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    truncated: bool = False


def cell(value: Any) -> Any:
    """Coerce a DB value to a JSON-safe primitive (never raw bytes)."""
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"<{len(bytes(value))} bytes>"
    return value


class DatabaseDriver(ABC):
    """Read-only access primitives for one engine. Instances are stateless."""

    name: str = "base"          # id used in the API + registry
    label: str = "Database"     # human label for the wizard
    dialect: str = "postgres"   # sqlglot dialect key for the validator
    default_port: int = 0
    available: bool = True       # False when the underlying driver isn't importable
    reduced_guarantees: bool = False  # True when a read-only session (Layer 2) is unavailable

    @abstractmethod
    def connect(self, params: ConnParams, timeout: int):
        """Open a connection (autocommit). Raise the native exception on failure."""

    @abstractmethod
    def set_session_read_only(self, conn) -> None:
        """Put the session/transaction into read-only mode (Layer 2)."""

    @abstractmethod
    def apply_statement_timeout(self, conn, ms: int) -> None:
        """Best-effort per-statement timeout so a slow query can't hang the worker."""

    @abstractmethod
    def run_select(self, conn, sql: str, limit: int) -> DriverResult:
        """Execute ONE already-validated read-only statement and fetch <= limit rows."""

    def probe(self, params: ConnParams, timeout: int) -> None:
        """Connect + trivial read to prove reachability/auth. Raises on failure."""
        conn = self.connect(params, timeout)
        try:
            try:
                self.set_session_read_only(conn)
            except Exception:  # noqa: BLE001 - probe must not fail on the RO hint
                pass
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
            cur.close()
        finally:
            self.close(conn)

    def close(self, conn) -> None:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass

    def classify_error(self, exc: Exception) -> tuple[str, str]:
        from ..errors import classify

        return classify(exc, self.name)

    @staticmethod
    def _fetch_capped(cur, limit: int) -> DriverResult:
        """Shared fetch: read one past the cap to detect truncation, coerce cells."""
        columns = [d[0] for d in (cur.description or [])]
        raw = cur.fetchmany(limit + 1)
        truncated = len(raw) > limit
        rows = [[cell(v) for v in row] for row in raw[:limit]]
        return DriverResult(columns=columns, rows=rows, row_count=len(rows), truncated=truncated)
