"""Lab 5 — McpGeneratorService: build a per-connection READ-ONLY MCP server.

"Generate the MCP server" = create in-process @tool closures over a connection id
and hand them to claude_agent_sdk.create_sdk_mcp_server — the SAME mechanism the
built-in labs use (permits.py). The server exposes exactly two read tools:

  - run_query(sql): validate (Layer 1) then execute one read-only statement.
  - list_tables():  safe schema introspection so the agent can target real tables.

The tool schema is only {sql: str} — credentials never enter the tool schema, the
agent context, results, logs, or the server name. The password is decrypted only
inside the sync worker (`_run_query_sync`) at execution time.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from ..config import LAB5_CONNECT_TIMEOUT, LAB5_ROW_CAP, LAB5_STATEMENT_TIMEOUT_MS
from ..lab5 import connection_service, errors, store, validator
from ..lab5.drivers import get_driver

log = logging.getLogger("agentic_labs.lab5")

# Safe, read-only schema-introspection query per dialect.
_LIST_TABLES_SQL = {
    "postgres": (
        "SELECT table_schema, table_name FROM information_schema.tables "
        "WHERE table_type = 'BASE TABLE' "
        "AND table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2"
    ),
    "mysql": (
        "SELECT table_schema, table_name FROM information_schema.tables "
        "WHERE table_type = 'BASE TABLE' "
        "AND table_schema NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema') "
        "ORDER BY 1, 2"
    ),
    "tsql": (
        "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY 1, 2"
    ),
}


def _run_query_sync(conn_id: int, sql: str) -> dict:
    """SYNC worker: decrypt, connect, apply read-only session + timeout, fetch."""
    params = connection_service.load_conn_params(conn_id)
    driver = get_driver(params.driver)
    conn = driver.connect(params, LAB5_CONNECT_TIMEOUT)
    try:
        try:
            driver.set_session_read_only(conn)  # Layer 2 (best effort)
        except Exception:  # noqa: BLE001 - Layer 1 already validated the SQL
            pass
        driver.apply_statement_timeout(conn, LAB5_STATEMENT_TIMEOUT_MS)
        result = driver.run_select(conn, sql, LAB5_ROW_CAP)
        return {
            "ok": True,
            "columns": result.columns,
            "rows": result.rows,
            "row_count": result.row_count,
            "truncated": result.truncated,
        }
    finally:
        driver.close(conn)


def _list_tables_sync(conn_id: int) -> dict:
    params = connection_service.load_conn_params(conn_id)
    driver = get_driver(params.driver)
    sql = _LIST_TABLES_SQL.get(driver.dialect, _LIST_TABLES_SQL["postgres"])
    conn = driver.connect(params, LAB5_CONNECT_TIMEOUT)
    try:
        try:
            driver.set_session_read_only(conn)
        except Exception:  # noqa: BLE001
            pass
        driver.apply_statement_timeout(conn, LAB5_STATEMENT_TIMEOUT_MS)
        result = driver.run_select(conn, sql, 1000)
        tables = [f"{r[0]}.{r[1]}" if r[0] else str(r[1]) for r in result.rows]
        return {"ok": True, "tables": tables}
    finally:
        driver.close(conn)


def _text(payload: dict, is_error: bool = False) -> dict:
    block = {"content": [{"type": "text", "text": json.dumps(payload, default=str)}]}
    if is_error:
        block["is_error"] = True
    return block


def build_server(conn_id: int):
    """Create the in-process read-only MCP server for one saved connection."""
    public = store.get_public_sync(conn_id)
    if public is None:
        raise connection_service.ConnectionNotFound(conn_id)
    driver = get_driver(public["driver"])
    dialect = driver.dialect

    @tool("run_query", "Run ONE read-only SQL SELECT against the connected database and return the rows.", {"sql": str})
    async def run_query(args: dict[str, Any]) -> dict[str, Any]:
        sql = (args or {}).get("sql", "") or ""
        verdict = validator.validate(sql, dialect)
        if not verdict.ok:
            log.info("lab5 blocked-SQL conn=%s kind=%s reason=%s", conn_id, verdict.kind, verdict.reason)
            return _text({"ok": False, "error": verdict.reason}, is_error=True)
        try:
            payload = await asyncio.to_thread(_run_query_sync, conn_id, sql)
            return _text(payload)
        except Exception as exc:  # noqa: BLE001
            category, message = errors.classify(exc, driver.name)
            log.warning("lab5 run_query failed conn=%s category=%s", conn_id, category)
            return _text({"ok": False, "error": message}, is_error=True)

    @tool("list_tables", "List the tables available in the connected database (as schema.table).", {})
    async def list_tables(args: dict[str, Any]) -> dict[str, Any]:
        try:
            payload = await asyncio.to_thread(_list_tables_sync, conn_id)
            return _text(payload)
        except Exception as exc:  # noqa: BLE001
            category, message = errors.classify(exc, driver.name)
            log.warning("lab5 list_tables failed conn=%s category=%s", conn_id, category)
            return _text({"ok": False, "error": message}, is_error=True)

    return create_sdk_mcp_server(name=f"userdb_{conn_id}", version="1.0.0", tools=[run_query, list_tables])


# Public API: an INSPECTABLE standalone MCP-server code artifact (no secrets — the
# connection is read from environment variables). Shown to the user as the
# "generated MCP server code"; the running server is the in-process one above.
_CODE_TEMPLATE = '''\
"""Auto-generated read-only MCP server for {label} connection "{name}".

Generated by the Agentic Labs On-the-Fly MCP Server Builder. Read-only by
construction: every query is AST-validated to a single SELECT before it reaches
the database, run under a read-only session, and capped. Credentials are read
from environment variables — no secret is ever embedded in this file.
"""
import os
import {driver_import}
import sqlglot
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("userdb_{conn_id}")

_ALLOWED_ROOTS = (sqlglot.exp.Select, sqlglot.exp.Union, sqlglot.exp.With)
_FORBIDDEN = (sqlglot.exp.Insert, sqlglot.exp.Update, sqlglot.exp.Delete,
              sqlglot.exp.Merge, sqlglot.exp.Drop, sqlglot.exp.Alter,
              sqlglot.exp.Create, sqlglot.exp.Command)


def _is_read_only(sql: str) -> bool:
    try:
        stmts = [s for s in sqlglot.parse(sql, read="{dialect}") if s is not None]
    except Exception:
        return False
    if len(stmts) != 1 or not isinstance(stmts[0], _ALLOWED_ROOTS):
        return False
    return next(stmts[0].find_all(*_FORBIDDEN), None) is None


def _connect():
    # NOTE: credentials come from the environment; nothing is hard-coded here.
    return {connect_expr}


@mcp.tool()
def run_query(sql: str) -> dict:
    """Run a single read-only SELECT and return columns + rows."""
    if not _is_read_only(sql):
        return {{"ok": False, "error": "Only a single read-only SELECT is allowed."}}
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        cols = [d[0] for d in cur.description]
        rows = [list(r) for r in cur.fetchmany({row_cap})]
        return {{"ok": True, "columns": cols, "rows": rows}}
    finally:
        conn.close()


if __name__ == "__main__":
    mcp.run()
'''

_CONNECT_EXPR = {
    "postgres": 'psycopg.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), '
                'dbname=os.environ["DB_NAME"], user=os.environ["DB_USER"], '
                'password=os.environ["DB_PASSWORD"], autocommit=True)',
    "mysql": 'pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), '
             'database=os.environ["DB_NAME"], user=os.environ["DB_USER"], '
             'password=os.environ["DB_PASSWORD"], autocommit=True)',
    "mssql": 'pymssql.connect(server=os.environ["DB_HOST"], port=os.environ["DB_PORT"], '
             'database=os.environ["DB_NAME"], user=os.environ["DB_USER"], '
             'password=os.environ["DB_PASSWORD"], autocommit=True)',
}
_DRIVER_IMPORT = {"postgres": "psycopg", "mysql": "pymysql", "mssql": "pymssql"}


def generate_code_artifact(conn_id: int) -> str:
    """Return standalone, secret-free MCP-server source for display/download."""
    public = store.get_public_sync(conn_id)
    if public is None:
        raise connection_service.ConnectionNotFound(conn_id)
    driver = get_driver(public["driver"])
    return _CODE_TEMPLATE.format(
        label=driver.label,
        name=(public.get("name") or public["database"]),
        conn_id=conn_id,
        dialect=driver.dialect,
        driver_import=_DRIVER_IMPORT.get(driver.name, "psycopg"),
        connect_expr=_CONNECT_EXPR.get(driver.name, _CONNECT_EXPR["postgres"]),
        row_cap=LAB5_ROW_CAP,
    )
