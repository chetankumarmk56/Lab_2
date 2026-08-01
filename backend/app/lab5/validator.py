"""Lab 5 — SqlValidator: fail-closed, AST-based read-only enforcement (Layer 1).

Replaces the shallow ``^(select|with)`` regex used elsewhere. Runs BEFORE any DB
connection. Parses with sqlglot (dialect-aware) and rejects on the first failing
check. Any parser uncertainty is a rejection (fail closed — never default-allow).

Allowed: a SINGLE ``SELECT`` / ``WITH … SELECT`` / ``UNION`` of selects (incl.
subqueries and read-only CTEs). Everything else — DML, DDL, multi-statement,
write-CTEs, ``SELECT … INTO``, stored-proc/command calls, and a denylist of
side-effecting functions — is rejected with a clear, non-leaky message.
"""
from __future__ import annotations

from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

try:  # sqlglot renamed TokenizeError -> TokenError across versions
    from sqlglot.errors import TokenError as _TokenError
except ImportError:  # pragma: no cover
    _TokenError = ParseError

# driver name -> sqlglot dialect key
_DIALECT = {"postgres": "postgres", "mysql": "mysql", "mssql": "tsql"}


def _classes(*names: str) -> tuple:
    """Resolve exp.* classes by name, skipping any absent in this sqlglot version."""
    return tuple(c for c in (getattr(exp, n, None) for n in names) if isinstance(c, type))


# Data-modifying / DDL / command nodes forbidden ANYWHERE in the tree.
# exp.Command is sqlglot's catch-all for unmodeled statements (EXEC/EXECUTE/CALL/
# COPY/VACUUM/vendor commands) — rejecting it blocks stored procs and the like.
_FORBIDDEN = _classes(
    "Insert", "Update", "Delete", "Merge", "Drop", "Alter", "Create",
    "TruncateTable", "Command", "Grant", "Revoke", "Copy", "LoadData",
)

# Acceptable top-level (root) statement shapes for a read-only query.
_READ_ROOTS = _classes("Select", "Union", "Intersect", "Except", "With", "Paren", "Subquery")

# Side-effecting / OS / filesystem / admin / DoS functions a bare SELECT could
# invoke. A read-only transaction does NOT block admin/signal functions like
# pg_terminate_backend (they aren't MVCC writes), so Layer 1 must reject them.
_DANGEROUS_FUNCS = {
    # filesystem / OS / cross-db
    "lo_import", "lo_export", "pg_read_file", "pg_read_binary_file", "pg_ls_dir",
    "pg_stat_file", "dblink", "dblink_exec", "load_file", "xp_cmdshell",
    "openrowset", "openquery", "opendatasource", "sys_exec", "sys_eval",
    # time-based / DoS
    "pg_sleep", "sleep", "benchmark", "waitfor",
    # admin / signal (kill or disrupt other sessions — NOT caught by a RO txn)
    "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
    # advisory locks (session/DoS)
    "pg_advisory_lock", "pg_advisory_lock_shared", "pg_advisory_xact_lock",
    "pg_advisory_xact_lock_shared", "pg_advisory_unlock", "pg_advisory_unlock_all",
    "get_lock", "release_lock", "release_all_locks",
    # sequence mutation
    "setval", "nextval",
}


@dataclass
class ValidationResult:
    ok: bool
    reason: str | None = None
    kind: str = ""  # statement/root type — safe to log (never contains literals)


def _reject(reason: str, kind: str = "") -> ValidationResult:
    return ValidationResult(False, reason, kind)


def validate(sql: str, dialect: str = "postgres") -> ValidationResult:
    """Return a ValidationResult; ok=True only for a single read-only SELECT."""
    read = _DIALECT.get(dialect, "postgres")
    text = (sql or "").strip()
    if not text:
        return _reject("Empty query.")

    # 1. PARSE — fail closed on ANY parser error or surprise.
    try:
        statements = [s for s in sqlglot.parse(text, read=read) if s is not None]
    except (ParseError, _TokenError):
        return _reject("Could not parse this as a single read-only SELECT.")
    except Exception:  # noqa: BLE001 - never default-allow on parser uncertainty
        return _reject("Could not parse this as a single read-only SELECT.")

    # 2. SINGLE STATEMENT — blocks semicolon-chained / comment-hidden extra statements.
    if len(statements) != 1:
        return _reject("Only a single SQL statement is allowed.")

    root = statements[0]
    kind = type(root).__name__

    # 3. READ-ONLY ROOT — anything else (Insert/Update/Delete/Create/Command/…) rejected.
    if not isinstance(root, _READ_ROOTS):
        return _reject("Only read-only SELECT (or WITH … SELECT) statements are allowed.", kind)

    # 4. FORBIDDEN NODES anywhere — covers write-CTEs and writes nested in subqueries.
    if _FORBIDDEN:
        bad = next(root.find_all(*_FORBIDDEN), None)
        if bad is not None:
            return _reject("This query contains a write, DDL, or command operation, which is not allowed.", type(bad).__name__)

    # 5. SELECT … INTO — creates a table (PG / T-SQL) / writes a file (MySQL OUTFILE).
    into_cls = getattr(exp, "Into", None)
    if into_cls is not None and next(root.find_all(into_cls), None) is not None:
        return _reject("SELECT … INTO is not allowed (it writes data).", "Into")

    # 6. DANGEROUS FUNCTIONS — scan ALL function nodes (typed + anonymous). For an
    #    Anonymous node the real name is `.name` (sql_name() returns "ANONYMOUS");
    #    for a typed builtin it's sql_name(). Check both.
    for fn in root.find_all(exp.Func):
        candidates: set[str] = set()
        nm = (getattr(fn, "name", "") or "").lower()
        if nm:
            candidates.add(nm)
        try:
            sn = (fn.sql_name() or "").lower()
            if sn and sn != "anonymous":
                candidates.add(sn)
        except Exception:  # noqa: BLE001
            pass
        hit = candidates & _DANGEROUS_FUNCS
        if hit:
            return _reject(f"The function {next(iter(hit))}() is not allowed.", "function")

    # 7. PASS.
    return ValidationResult(True, None, kind)
