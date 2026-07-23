"""Lab 5 — friendly, secret-free error classification and redaction.

Raw driver exceptions (and DSNs) must never reach the client, the agent, or the
logs. `classify` maps a native exception to a fixed category + a friendly message;
`redact` scrubs any secret (and DSN-embedded credentials) from a string before it
is logged or returned.
"""
from __future__ import annotations

import re
from typing import Iterable

# ── Friendly error categories (the ONLY error detail exposed to users) ──
AUTH_FAILED = "auth_failed"
HOST_UNREACHABLE = "host_unreachable"
DB_NOT_FOUND = "db_not_found"
SSL_ERROR = "ssl_error"
PORT_BLOCKED = "port_blocked"
TIMEOUT = "timeout"
DRIVER_UNAVAILABLE = "driver_unavailable"
PERMISSION_DENIED = "permission_denied"
UNKNOWN = "unknown"

FRIENDLY = {
    AUTH_FAILED: "Authentication failed — check the username and password.",
    HOST_UNREACHABLE: "Could not reach the host — check the host/IP and that it is publicly reachable.",
    DB_NOT_FOUND: "That database does not exist on the server.",
    SSL_ERROR: "The server requires or rejected SSL — check your SSL settings.",
    PORT_BLOCKED: "The port appears closed or blocked — check the port and any firewall.",
    TIMEOUT: "The connection timed out — the host or port may be unreachable.",
    DRIVER_UNAVAILABLE: "That database engine is not available in this deployment.",
    PERMISSION_DENIED: "The database user lacks permission for that operation.",
    UNKNOWN: "Could not connect to the database — check the details and try again.",
}

# Ordered (first match wins). Each entry: (category, [case-insensitive regex fragments]).
_PATTERNS: list[tuple[str, list[str]]] = [
    (TIMEOUT, [r"timeout", r"timed out"]),
    (AUTH_FAILED, [r"password authentication failed", r"authentication failed",
                   r"access denied", r"login failed", r"role \".*\" does not exist",
                   r"role .* does not exist", r"authentication"]),
    (DB_NOT_FOUND, [r"database \".*\" does not exist", r"database .* does not exist",
                    r"unknown database", r"cannot open database"]),
    (SSL_ERROR, [r"ssl", r"certificate", r"tls"]),
    (PERMISSION_DENIED, [r"permission denied", r"insufficient privilege", r"not allowed",
                         r"must be owner", r"read.?only"]),
    (PORT_BLOCKED, [r"connection refused", r"actively refused", r"no route to host",
                    r"can't connect to mysql server", r"could not connect to server"]),
    (HOST_UNREACHABLE, [r"could not translate host", r"name or service not known",
                        r"no such host", r"getaddrinfo", r"unreachable", r"unknown server host"]),
]


def classify(exc: Exception, driver_name: str = "") -> tuple[str, str]:
    """Return (category, friendly_message) for a native driver exception."""
    msg = str(exc).lower()
    for category, fragments in _PATTERNS:
        for frag in fragments:
            if re.search(frag, msg):
                return category, FRIENDLY[category]
    return UNKNOWN, FRIENDLY[UNKNOWN]


def redact(text: str, secrets: Iterable[str] = ()) -> str:
    """Remove known secrets and any DSN/kwarg-embedded credentials from a string."""
    out = text or ""
    for secret in secrets:
        if secret:
            out = out.replace(secret, "***")
    # scheme://user:password@host  ->  scheme://user:***@host
    out = re.sub(r"(://[^:@/\s]+):[^@/\s]+@", r"\1:***@", out)
    # password=... / pwd=... / passwd=...
    out = re.sub(r"(?i)\b(password|passwd|pwd)\s*=\s*'?[^\s'\";,)]+'?", r"\1=***", out)
    return out
