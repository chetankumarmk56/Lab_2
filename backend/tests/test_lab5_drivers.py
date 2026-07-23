"""Unit tests for the driver registry + connection registry."""
import pytest

from app.lab5 import registry
from app.lab5.drivers import DriverUnavailable, available_drivers, get_driver


def test_available_drivers_shape():
    by_id = {d["id"]: d for d in available_drivers()}
    assert by_id["postgres"]["available"] is True  # psycopg is a hard dependency
    assert by_id["mssql"]["reduced_guarantees"] is True  # no session read-only in T-SQL
    for d in by_id.values():
        assert set(d) == {"id", "label", "available", "default_port", "reduced_guarantees"}


def test_get_driver_unknown_raises():
    with pytest.raises(DriverUnavailable):
        get_driver("oracle")


def test_get_driver_returns_instance():
    assert get_driver("postgres").dialect == "postgres"
    assert get_driver("mysql").dialect == "mysql"
    assert get_driver("mssql").dialect == "tsql"


def test_registry_lifecycle():
    sentinel = object()
    registry.register(4242, sentinel)
    reg = registry.get(4242)
    assert reg is not None and reg.server is sentinel
    assert reg.key == "userdb_4242"
    assert registry.tool_ids(4242) == ["mcp__userdb_4242__run_query", "mcp__userdb_4242__list_tables"]
    registry.unregister(4242)
    assert registry.get(4242) is None
    registry.unregister(4242)  # idempotent, no error
