"""Lab 5 — persistence for lab5_connections (read-write DATABASE_URL only).

Listing returns METADATA ONLY (never the ciphertext). The full row — including
the password ciphertext — is read only by `get_row_sync`, which runs inside the
sync DB worker just before decryption; callers must never return it to a client.
Sync psycopg + asyncio.to_thread, matching the rest of the backend.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

from ..config import DATABASE_URL

# Columns safe to expose (password_ciphertext is deliberately excluded).
_PUBLIC_COLS = (
    "id, name, driver, host, port, database, username, ssl_mode, "
    "status, last_error_category, last_verified_at, created_at, updated_at"
)


def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _rows(cur) -> list[dict]:
    cols = [d.name for d in cur.description]
    return [{c: _jsonable(v) for c, v in zip(cols, row)} for row in cur.fetchall()]


# ── sync ops ──
def _insert_sync(meta: dict, ciphertext: bytes) -> int:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO lab5_connections "
                "(name, driver, host, port, database, username, password_ciphertext, ssl_mode, status) "
                "VALUES (%(name)s, %(driver)s, %(host)s, %(port)s, %(database)s, %(username)s, "
                "        %(ciphertext)s, %(ssl_mode)s, 'saved') RETURNING id",
                {**meta, "ciphertext": ciphertext},
            )
            return cur.fetchone()[0]


def _list_sync() -> list[dict]:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_PUBLIC_COLS} FROM lab5_connections ORDER BY id DESC")
            return _rows(cur)


def get_row_sync(conn_id: int) -> dict | None:
    """Full row INCLUDING password_ciphertext — for the sync DB worker only."""
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, driver, host, port, database, username, "
                "password_ciphertext, ssl_mode, status FROM lab5_connections WHERE id = %s",
                (conn_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d.name for d in cur.description]
            return dict(zip(cols, row))


def get_public_sync(conn_id: int) -> dict | None:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_PUBLIC_COLS} FROM lab5_connections WHERE id = %s", (conn_id,))
            rows = _rows(cur)
            return rows[0] if rows else None


def _set_status_sync(conn_id: int, status: str, category: str | None) -> None:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE lab5_connections SET status = %s, last_error_category = %s, "
                "updated_at = now(), "
                "last_verified_at = CASE WHEN %s = 'verified' THEN now() ELSE last_verified_at END "
                "WHERE id = %s",
                (status, category, status, conn_id),
            )


def _delete_sync(conn_id: int) -> bool:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM lab5_connections WHERE id = %s", (conn_id,))
            return cur.rowcount > 0


# ── async wrappers ──
async def insert_connection(meta: dict, ciphertext: bytes) -> int:
    return await asyncio.to_thread(_insert_sync, meta, ciphertext)


async def list_connections() -> list[dict]:
    return await asyncio.to_thread(_list_sync)


async def get_public(conn_id: int) -> dict | None:
    return await asyncio.to_thread(get_public_sync, conn_id)


async def set_status(conn_id: int, status: str, last_error_category: str | None = None) -> None:
    await asyncio.to_thread(_set_status_sync, conn_id, status, last_error_category)


async def delete_connection(conn_id: int) -> bool:
    return await asyncio.to_thread(_delete_sync, conn_id)
