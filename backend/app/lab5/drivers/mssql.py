"""Lab 5 — SQL Server driver over pymssql. Import guarded; reduced guarantees.

T-SQL has no session/transaction read-only flag equivalent to Postgres/MySQL, so
Layer 2 is a no-op here. Read-only rests on the AST validator (Layer 1) and a
least-privilege login (Layer 3, strongly recommended). ``reduced_guarantees`` is
surfaced to the UI so the user is told to use a SELECT-only credential.
"""
from __future__ import annotations

from .base import ConnParams, DatabaseDriver, DriverResult, DriverUnavailable

try:
    import pymssql
    _AVAILABLE = True
except ImportError:  # pragma: no cover
    pymssql = None
    _AVAILABLE = False


class SqlServerDriver(DatabaseDriver):
    name = "mssql"
    label = "SQL Server"
    dialect = "tsql"
    default_port = 1433
    available = _AVAILABLE
    reduced_guarantees = True

    def connect(self, params: ConnParams, timeout: int):
        if pymssql is None:
            raise DriverUnavailable("The SQL Server driver (pymssql) is not available in this deployment.")
        return pymssql.connect(
            server=params.host,
            port=str(params.port),
            user=params.username,
            password=params.password,
            database=params.database,
            login_timeout=timeout,
            timeout=timeout + 20,
            autocommit=True,
        )

    def set_session_read_only(self, conn) -> None:
        # No T-SQL equivalent — read-only enforced by Layers 1 & 3.
        return None

    def apply_statement_timeout(self, conn, ms: int) -> None:
        # pymssql query timeout is set at connect time; no per-statement control.
        return None

    def run_select(self, conn, sql: str, limit: int) -> DriverResult:
        cur = conn.cursor()
        try:
            cur.execute(sql)
            return self._fetch_capped(cur, limit)
        finally:
            cur.close()
