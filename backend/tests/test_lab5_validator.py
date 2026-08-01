"""Unit tests for the Lab 5 read-only SQL validator (Layer 1), per dialect.

The validator is the highest-risk security surface: it must ALLOW read-only
selects and fail-closed-REJECT everything that could write, run DDL, execute a
command, hide a second statement, or invoke a side-effecting function.
"""
import pytest

from app.lab5.validator import validate

ALLOW = {
    "postgres": [
        "SELECT 1",
        "select * from t where name ilike '%a%'",
        "WITH c AS (SELECT id FROM t) SELECT * FROM c",
        "SELECT a FROM t UNION SELECT b FROM u",
        "SELECT * FROM (SELECT id FROM t) s",
        "  SeLeCt   1  ",
        "SELECT 1 /* comment with ; DROP TABLE t inside */",
        "SELECT 1 -- trailing DROP TABLE t\n",
        "SELECT count(*), max(fee) FROM permits WHERE status = 'Approved'",
    ],
    "mysql": [
        "SELECT 1",
        "SELECT `col` FROM `tbl` LIMIT 5",
        "WITH c AS (SELECT 1 AS x) SELECT * FROM c",
    ],
    "mssql": [
        "SELECT 1",
        "SELECT TOP 10 * FROM t",
        "WITH c AS (SELECT 1 AS x) SELECT * FROM c",
    ],
}

DENY = {
    "postgres": [
        "INSERT INTO t VALUES (1)",
        "UPDATE t SET x = 1",
        "DELETE FROM t",
        "DROP TABLE t",
        "ALTER TABLE t ADD COLUMN c int",
        "CREATE TABLE t (x int)",
        "TRUNCATE t",
        "GRANT SELECT ON t TO r",
        "REVOKE SELECT ON t FROM r",
        "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
        "SELECT 1; DROP TABLE t",
        "SELECT 1;-- x\nDELETE FROM t",
        "SELECT * INTO newt FROM t",
        "COPY t TO '/tmp/x'",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT pg_sleep(10)",
        "SELECT lo_export(1, '/tmp/x')",
        "SELECT pg_terminate_backend(123)",
        "SELECT pg_cancel_backend(123)",
        "SELECT pg_advisory_lock(1)",
        "SELECT setval('users_id_seq', 1)",
        "SELECT nextval('users_id_seq')",
        "notasqlstatement %%% garbage",
        "",
    ],
    "mysql": [
        "INSERT INTO t VALUES (1)",
        "DELETE FROM t",
        "DROP TABLE t",
        "SELECT load_file('/etc/passwd')",
        "SELECT benchmark(1000000, md5('x'))",
        "SELECT * FROM t INTO OUTFILE '/tmp/x'",
        "CALL myproc()",
        "SELECT get_lock('x', 10)",
        "SELECT sleep(5)",
        "SELECT 1; DROP TABLE t",
    ],
    "mssql": [
        "INSERT INTO t VALUES (1)",
        "DROP TABLE t",
        "EXEC xp_cmdshell 'dir'",
        "EXECUTE sp_who",
        "SELECT * INTO newt FROM t",
        "TRUNCATE TABLE t",
    ],
}


@pytest.mark.parametrize("dialect,sql", [(d, s) for d, items in ALLOW.items() for s in items])
def test_allow(dialect, sql):
    result = validate(sql, dialect)
    assert result.ok, f"expected ALLOW, got reject: {sql!r} -> {result.reason}"


@pytest.mark.parametrize("dialect,sql", [(d, s) for d, items in DENY.items() for s in items])
def test_deny(dialect, sql):
    result = validate(sql, dialect)
    assert not result.ok, f"expected DENY, but allowed: {sql!r}"
