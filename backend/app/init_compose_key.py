import os
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet

KEY_PATH = Path("/data/credential_encryption_key")


def ensure_key() -> None:
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)

    try:
        key = KEY_PATH.read_bytes().strip()
    except FileNotFoundError:
        key = Fernet.generate_key()
        descriptor, temporary_path = tempfile.mkstemp(
            prefix=".credential_encryption_key.", dir=KEY_PATH.parent
        )
        try:
            os.fchmod(descriptor, 0o400)
            with os.fdopen(descriptor, "wb") as temporary_file:
                temporary_file.write(key + b"\n")
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            try:
                os.link(temporary_path, KEY_PATH)
            except FileExistsError:
                key = KEY_PATH.read_bytes().strip()
        finally:
            Path(temporary_path).unlink(missing_ok=True)

    try:
        Fernet(key)
    except (TypeError, ValueError) as error:
        raise SystemExit(
            f"Invalid credential encryption key at {KEY_PATH}; refusing to replace it."
        ) from error


if __name__ == "__main__":
    ensure_key()
