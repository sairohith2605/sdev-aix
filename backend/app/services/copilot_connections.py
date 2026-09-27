import sqlite3
from contextlib import closing
from datetime import UTC, datetime

from pydantic import BaseModel, SecretStr

from app.config import Settings
from app.db import initialize_plan_schema
from app.errors import PlanError
from app.security import CredentialCipher


class CopilotCredentialRequest(BaseModel):
    pat: SecretStr


class CopilotConnectionSummary(BaseModel):
    connected: bool
    pat_configured: bool


class CopilotConnectionService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        initialize_plan_schema(settings.sqlite_path)

    def _cipher(self) -> CredentialCipher:
        try:
            return CredentialCipher(self.settings.credential_encryption_key)
        except ValueError:
            raise PlanError(
                "Backend credential encryption is not configured.",
                503,
                "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
            ) from None

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.settings.sqlite_path, timeout=5)

    def summary(self) -> CopilotConnectionSummary:
        with closing(self._connect()) as connection:
            exists = connection.execute(
                "SELECT 1 FROM copilot_connection WHERE id = 1"
            ).fetchone()
        return CopilotConnectionSummary(
            connected=bool(exists), pat_configured=bool(exists)
        )

    def active_pat(self) -> str:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT encrypted_pat FROM copilot_connection WHERE id = 1"
            ).fetchone()
        if not row:
            raise PlanError(
                "Connect GitHub Copilot in Connections first.",
                409,
                "COPILOT_NOT_CONFIGURED",
            )
        try:
            return self._cipher().decrypt(row[0])
        except ValueError:
            raise PlanError(
                "Stored GitHub Copilot credential cannot be decrypted.",
                503,
                "COPILOT_CREDENTIAL_INVALID",
            ) from None

    async def verify(self, pat: str) -> None:
        if not pat.strip():
            raise PlanError("Enter a GitHub Copilot PAT.", 422, "COPILOT_PAT_REQUIRED")
        from app.providers.copilot import CopilotAnalysisError, CopilotAnalysisProvider

        try:
            await CopilotAnalysisProvider(
                self.settings.copilot_model,
                self.settings.copilot_timeout_seconds,
                self.settings.copilot_home,
            ).verify(pat)
        except CopilotAnalysisError as error:
            raise PlanError(str(error), 403, error.code) from None

    async def save(self, pat: str) -> CopilotConnectionSummary:
        await self.verify(pat)
        encrypted = self._cipher().encrypt(pat.strip())
        now = datetime.now(UTC).isoformat()
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO copilot_connection
                        (id, encrypted_pat, created_at, updated_at)
                    VALUES (1, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        encrypted_pat = excluded.encrypted_pat,
                        updated_at = excluded.updated_at
                    """,
                    (encrypted, now, now),
                )
        return self.summary()

    def disconnect(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("DELETE FROM copilot_connection WHERE id = 1")
