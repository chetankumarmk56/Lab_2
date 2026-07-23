"""Lab 5 — driver registry. Guarded imports so a missing engine degrades to
`available: False` instead of crashing app import.

To add an engine later (Oracle, SQLite): implement a DatabaseDriver subclass,
import it here, and add it to _INSTANCES — nothing else changes.
"""
from __future__ import annotations

from .base import ConnParams, DatabaseDriver, DriverResult, DriverUnavailable, cell  # noqa: F401
from .mssql import SqlServerDriver
from .mysql import MySQLDriver
from .postgres import PostgresDriver

_INSTANCES: dict[str, DatabaseDriver] = {
    d.name: d() for d in (PostgresDriver, MySQLDriver, SqlServerDriver)
}


def get_driver(name: str) -> DatabaseDriver:
    """Return the driver for `name`, or raise DriverUnavailable (unknown/absent)."""
    driver = _INSTANCES.get((name or "").lower())
    if driver is None:
        raise DriverUnavailable(f"Unknown database engine: {name!r}.")
    if not driver.available:
        raise DriverUnavailable(f"The {driver.label} driver is not available in this deployment.")
    return driver


def available_drivers() -> list[dict]:
    """Metadata for the wizard's engine picker (all engines, with availability)."""
    return [
        {
            "id": d.name,
            "label": d.label,
            "available": d.available,
            "default_port": d.default_port,
            "reduced_guarantees": d.reduced_guarantees,
        }
        for d in _INSTANCES.values()
    ]
