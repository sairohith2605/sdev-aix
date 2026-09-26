from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_origin: str = "http://localhost:5173"
    database_url: str = "sqlite:///./data/sdev-aix.db"
    credential_encryption_key: str = ""
    credential_encryption_key_file: Path | None = None
    ado_api_version: str = "7.1"
    ado_request_timeout_seconds: float = Field(default=15.0, gt=0, le=60)

    @model_validator(mode="after")
    def load_credential_encryption_key_file(self) -> "Settings":
        if self.credential_encryption_key_file is None:
            return self
        try:
            self.credential_encryption_key = (
                self.credential_encryption_key_file.read_text(encoding="ascii").strip()
            )
        except OSError as error:
            raise ValueError(
                "CREDENTIAL_ENCRYPTION_KEY_FILE must point to a readable file"
            ) from error
        return self

    @property
    def sqlite_path(self) -> Path:
        prefix = "sqlite:///"
        if not self.database_url.startswith(prefix):
            raise ValueError("Only SQLite DATABASE_URL is supported in this milestone")
        path = Path(self.database_url.removeprefix(prefix))
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[1] / path
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()
