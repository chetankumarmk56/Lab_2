"""Lab 5 — PostgreSQL driver over the (already-installed) sync psycopg."""
from __future__ import annotations

import psycopg

from .base import ConnParams, DatabaseDriver, DriverResult


class PostgresDriver(DatabaseDriver):
    name = "postgres"
    label = "PostgreSQL"
    dialect = "postgres"
    default_port = 5432
    available = True
    reduced_guarantees = False

    def connect(self, params: ConnParams, timeout: int):
        kwargs = dict(
            host=params.host,
            port=int(params.port),
            dbname=params.database,
            user=params.username,
            password=params.password,
            connect_timeout=timeout,
            autocommit=True,
        )
        if params.ssl_mode:
            kwargs["sslmode"] = params.ssl_mode
        return psycopg.connect(**kwargs)

    def set_session_read_only(self, conn) -> None:
        conn.execute("SET default_transaction_read_only = on")

    def apply_statement_timeout(self, conn, ms: int) -> None:
        conn.execute(f"SET statement_timeout = {int(ms)}")

    def run_select(self, conn, sql: str, limit: int) -> DriverResult:
        with conn.cursor() as cur:
            cur.execute(sql)
            return self._fetch_capped(cur, limit)
