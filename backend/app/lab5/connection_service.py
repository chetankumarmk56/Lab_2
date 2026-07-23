"""Lab 5 — ConnectionService: orchestrates save / list / test / delete.

Owns the credential lifecycle boundary: encrypts on save, decrypts just-in-time
(inside the sync worker) to build ConnParams, and maps every driver failure to a
friendly, secret-free category. Never returns a password or ciphertext.
"""
from __future__ import annotations

import asyncio
import logging

from ..config import LAB5_CONNECT_TIMEOUT
from . import credentials, errors, store
from .drivers import DriverUnavailable, get_driver
from .drivers.base import ConnParams

log = logging.getLogger("agentic_labs.lab5")


class ConnectionNotFound(Exception):
    pass


async def save_connection(payload) -> int:
    """Encrypt the password and persist metadata + ciphertext. Returns the new id."""
    ciphertext = credentials.encrypt(payload.password)
    meta = {
        "name": (payload.name or None),
        "driver": payload.driver,
        "host": payload.host.strip(),
        "port": int(payload.port),
        "database": payload.database.strip(),
        "username": payload.username.strip(),
        "ssl_mode": (payload.ssl_mode or None),
    }
    conn_id = await store.insert_connection(meta, ciphertext)
    log.info("lab5 connection saved id=%s driver=%s host=%s", conn_id, meta["driver"], meta["host"])
    return conn_id


async def list_connections() -> list[dict]:
    return await store.list_connections()


def load_conn_params(conn_id: int) -> ConnParams:
    """SYNC — read the row and decrypt the password just-in-time. Worker-thread only."""
    row = store.get_row_sync(conn_id)
    if row is None:
        raise ConnectionNotFound(conn_id)
    password = credentials.decrypt(row["password_ciphertext"])
    return ConnParams(
        driver=row["driver"],
        host=row["host"],
        port=row["port"],
        database=row["database"],
        username=row["username"],
        password=password,
        ssl_mode=row.get("ssl_mode"),
    )


async def test_connection(conn_id: int) -> dict:
    """Attempt a real connection + trivial read. Friendly result, no stack traces."""
    public = await store.get_public(conn_id)
    if public is None:
        raise ConnectionNotFound(conn_id)
    try:
        driver = get_driver(public["driver"])
    except DriverUnavailable as exc:
        await store.set_status(conn_id, "failed", errors.DRIVER_UNAVAILABLE)
        return {"ok": False, "category": errors.DRIVER_UNAVAILABLE, "message": str(exc)}

    def _probe() -> None:
        driver.probe(load_conn_params(conn_id), LAB5_CONNECT_TIMEOUT)

    try:
        await asyncio.to_thread(_probe)
    except Exception as exc:  # noqa: BLE001 - classify, never forward the raw error
        category, message = driver.classify_error(exc)
        log.warning("lab5 test_connection failed id=%s category=%s", conn_id, category)
        await store.set_status(conn_id, "failed", category)
        return {"ok": False, "category": category, "message": message}

    await store.set_status(conn_id, "tested")
    log.info("lab5 test_connection ok id=%s", conn_id)
    return {"ok": True, "category": "connected", "message": "Connected successfully."}


async def delete_connection(conn_id: int) -> dict:
    """Unregister the live server (if any) and delete the encrypted row."""
    from . import registry  # lazy import avoids an import cycle

    registry.unregister(conn_id)
    removed = await store.delete_connection(conn_id)
    if not removed:
        raise ConnectionNotFound(conn_id)
    log.info("lab5 connection deleted id=%s", conn_id)
    return {"ok": True}
