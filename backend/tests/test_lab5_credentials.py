"""Unit tests for Fernet credential encryption, fail-fast key handling, redaction."""
import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.lab5 import credentials, errors


def test_encrypt_decrypt_roundtrip():
    token = credentials.encrypt("s3cr3t-pw")
    assert token != b"s3cr3t-pw"
    assert credentials.decrypt(token) == "s3cr3t-pw"


def test_ciphertext_differs_each_call():
    # Fernet embeds a random IV/timestamp, so two encryptions differ.
    assert credentials.encrypt("same") != credentials.encrypt("same")


def test_wrong_key_raises_invalid_token():
    token = credentials.encrypt("x")
    stranger = Fernet(Fernet.generate_key())
    with pytest.raises(InvalidToken):
        stranger.decrypt(token)


def test_missing_key_fails_fast(monkeypatch):
    monkeypatch.setattr(credentials, "_fernet", None)
    monkeypatch.setattr(credentials, "CREDENTIAL_ENCRYPTION_KEY", None)
    with pytest.raises(credentials.CredentialKeyError):
        credentials.encrypt("x")


def test_redact_masks_secret_and_dsn():
    assert "hunter2" not in errors.redact("connecting with password=hunter2 to host", ["hunter2"])
    masked = errors.redact("postgresql://user:p4ssw0rd@host:5432/db")
    assert "p4ssw0rd" not in masked and "***" in masked


def test_classify_maps_categories():
    def e(msg):
        return Exception(msg)

    assert errors.classify(e("password authentication failed for user"))[0] == errors.AUTH_FAILED
    assert errors.classify(e('database "nope" does not exist'))[0] == errors.DB_NOT_FOUND
    assert errors.classify(e("could not translate host name to address"))[0] == errors.HOST_UNREACHABLE
    assert errors.classify(e("Connection refused"))[0] == errors.PORT_BLOCKED
    assert errors.classify(e("connection timed out"))[0] == errors.TIMEOUT
    # friendly messages never echo the raw exception
    _, msg = errors.classify(e("password authentication failed for user 'admin'"))
    assert "admin" not in msg
