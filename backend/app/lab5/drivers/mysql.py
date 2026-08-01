"""Lab 5 — MySQL driver over PyMySQL (pure Python). Import is guarded."""
from __future__ import annotations

from .base import ConnParams, DatabaseDriver, DriverResult, DriverUnavailable

try:
    import pymysql
    _AVAILABLE = True
except ImportError:  # pragma: no cover
    pymysql = None
    _AVAILABLE = False


class MySQLDriver(DatabaseDriver):
    name = "mysql"
    label = "MySQL"
    dialect = "mysql"
    default_port = 3306
    available = _AVAILABLE
    reduced_guarantees = False

    def connect(self, params: ConnParams, timeout: int):
        if pymysql is None:
            raise DriverUnavailable("The MySQL driver (PyMySQL) is not installed.")
        kwargs = dict(
            host=params.host,
            port=int(params.port),
            user=params.username,
            password=params.password,
            database=params.database,
            connect_timeout=timeout,
            read_timeout=timeout + 20,
            autocommit=True,
        )
        if params.ssl_mode and params.ssl_mode.lower() not in ("disable", "disabled", "none", "off"):
            kwargs["ssl"] = {"ssl": {}}  # enable TLS with library defaults
        return pymysql.connect(**kwargs)

    def set_session_read_only(self, conn) -> None:
        with conn.cursor() as cur:
            cur.execute("SET SESSION TRANSACTION READ ONLY")

    def apply_statement_timeout(self, conn, ms: int) -> None:
        try:  # MySQL 5.7.8+ only; ignored elsewhere
            with conn.cursor() as cur:
                cur.execute("SET SESSION MAX_EXECUTION_TIME = %s", (int(ms),))
        except Exception:  # noqa: BLE001
            pass

    def run_select(self, conn, sql: str, limit: int) -> DriverResult:
        with conn.cursor() as cur:
            cur.execute(sql)
            return self._fetch_capped(cur, limit)
