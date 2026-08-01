"""Lab 5 — CredentialService: the ONLY place plaintext target-DB passwords live.

Passwords are Fernet-encrypted with CREDENTIAL_ENCRYPTION_KEY and stored as
ciphertext (BYTEA) in lab5_connections. Plaintext exists only transiently: at
save time (to encrypt) and just-in-time inside the sync DB worker (to connect).

The key is REQUIRED — there is no hardcoded fallback and no silent ephemeral key.
To avoid breaking the other labs when the key isn't configured, the failure is
raised on first use (encrypt/decrypt), not at import.
"""
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken  # noqa: F401  (re-exported for callers/tests)

from ..config import CREDENTIAL_ENCRYPTION_KEY

_fernet: Fernet | None = None


class CredentialKeyError(RuntimeError):
    """Raised when CREDENTIAL_ENCRYPTION_KEY is missing or not a valid Fernet key."""


def _load_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = CREDENTIAL_ENCRYPTION_KEY
        if not key:
            raise CredentialKeyError(
                "CREDENTIAL_ENCRYPTION_KEY is not set. Lab 5 refuses to store credentials "
                "without an encryption key. Generate one with: "
                'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        try:
            _fernet = Fernet(key.encode("ascii") if isinstance(key, str) else key)
        except Exception as exc:  # noqa: BLE001
            raise CredentialKeyError("CREDENTIAL_ENCRYPTION_KEY is not a valid Fernet key.") from exc
    return _fernet


def is_configured() -> bool:
    """True if a usable encryption key is present (used for a startup warning)."""
    try:
        _load_fernet()
        return True
    except CredentialKeyError:
        return False


def encrypt(plaintext: str) -> bytes:
    """Encrypt a plaintext password into a Fernet token (bytes)."""
    return _load_fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(token: bytes) -> str:
    """Decrypt a Fernet token back to plaintext. Raises InvalidToken on wrong key."""
    return _load_fernet().decrypt(bytes(token)).decode("utf-8")


def generate_key() -> str:
    """Generate a fresh Fernet key (base64 str). Used by docs/tests, not at runtime."""
    return Fernet.generate_key().decode("ascii")
