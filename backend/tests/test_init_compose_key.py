from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from app import init_compose_key


def test_ensure_key_creates_valid_key_with_restricted_permissions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key_path = tmp_path / "credential_encryption_key"
    monkeypatch.setattr(init_compose_key, "KEY_PATH", key_path)

    init_compose_key.ensure_key()

    key = key_path.read_bytes().strip()
    Fernet(key)
    assert key_path.stat().st_mode & 0o777 == 0o400


def test_ensure_key_preserves_existing_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key_path = tmp_path / "credential_encryption_key"
    key_path.write_bytes(Fernet.generate_key() + b"\n")
    original_key = key_path.read_bytes()
    monkeypatch.setattr(init_compose_key, "KEY_PATH", key_path)

    init_compose_key.ensure_key()

    assert key_path.read_bytes() == original_key


def test_ensure_key_refuses_to_replace_invalid_existing_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key_path = tmp_path / "credential_encryption_key"
    key_path.write_bytes(b"invalid-key\n")
    monkeypatch.setattr(init_compose_key, "KEY_PATH", key_path)

    with pytest.raises(SystemExit, match="refusing to replace it"):
        init_compose_key.ensure_key()

    assert key_path.read_bytes() == b"invalid-key\n"
