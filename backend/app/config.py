import os
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
    copilot_model: str = "auto"
    copilot_timeout_seconds: float = Field(default=90.0, gt=0, le=300)
    copilot_data_path: Path = Path("./data/copilot")
    repository_allowed_roots: str = ""
    repository_max_file_bytes: int = Field(default=512_000, ge=10_000, le=2_000_000)
    repository_context_chars: int = Field(default=40_000, ge=4_000, le=100_000)

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

    @property
    def copilot_home(self) -> Path:
        if self.copilot_data_path.is_absolute():
            return self.copilot_data_path
        return Path(__file__).resolve().parents[1] / self.copilot_data_path

    @property
    def graph_checkpoint_path(self) -> Path:
        return self.sqlite_path.with_name("langgraph-checkpoints.db")

    @property
    def repository_roots(self) -> list[Path]:
        return [
            Path(value).expanduser().resolve()
            for value in self.repository_allowed_roots.split(os.pathsep)
            if value.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
