from pathlib import Path

import pytest

from app.config import Settings


def test_settings_load_credential_encryption_key_from_file(tmp_path: Path) -> None:
    key_file = tmp_path / "credential_encryption_key"
    key_file.write_text("local-test-key\n", encoding="ascii")

    settings = Settings(credential_encryption_key_file=key_file)

    assert settings.credential_encryption_key == "local-test-key"


def test_settings_reject_unreadable_credential_encryption_key_file(
    tmp_path: Path,
) -> None:
    key_file = tmp_path / "missing-key"

    with pytest.raises(ValueError, match="must point to a readable file"):
        Settings(credential_encryption_key_file=key_file)
