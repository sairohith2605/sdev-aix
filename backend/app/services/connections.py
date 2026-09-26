from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.connectors.azure_devops import AzureDevOpsClient
from app.db import ConnectionStore
from app.errors import ConnectorError
from app.schemas import ConnectionSummary, SaveConnectionRequest
from app.security import CredentialCipher


class ConnectionService:
    def __init__(
        self,
        settings: Settings,
        store: ConnectionStore,
        client_factory: Callable[..., AzureDevOpsClient] | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.client_factory = client_factory or AzureDevOpsClient

    def _cipher(self) -> CredentialCipher:
        if not self.settings.credential_encryption_key:
            raise ConnectorError(
                "Backend credential encryption is not configured.",
                503,
                "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
            )
        try:
            return CredentialCipher(self.settings.credential_encryption_key)
        except ValueError as error:
            raise ConnectorError(
                "Backend credential encryption key is invalid.",
                503,
                "CREDENTIAL_ENCRYPTION_INVALID",
            ) from error

    def client(self, organization: str, pat: str) -> AzureDevOpsClient:
        return self.client_factory(
            organization,
            pat,
            api_version=self.settings.ado_api_version,
            timeout=self.settings.ado_request_timeout_seconds,
        )

    async def test(self, organization: str, pat: str) -> None:
        await self.client(organization, pat).test_connection()

    async def projects(self, organization: str, pat: str) -> list[dict[str, str]]:
        return await self.client(organization, pat).list_projects()

    async def teams(
        self, organization: str, pat: str, project_id: str
    ) -> list[dict[str, str]]:
        return await self.client(organization, pat).list_teams(project_id)

    async def save(self, request: SaveConnectionRequest) -> ConnectionSummary:
        cipher = self._cipher()
        client = self.client(request.organization, request.pat.get_secret_value())
        await client.test_connection()
        projects = await client.list_projects()
        selected_project = next(
            (project for project in projects if project["id"] == request.project_id),
            None,
        )
        if selected_project is None:
            raise ConnectorError(
                "Selected project is not available in this organization.",
                422,
                "ADO_PROJECT_MISMATCH",
            )
        teams = await client.list_teams(request.project_id)
        selected_team = next(
            (team for team in teams if team["id"] == request.team_id), None
        )
        if selected_team is None:
            raise ConnectorError(
                "Selected team is not available in this project.",
                422,
                "ADO_TEAM_MISMATCH",
            )

        now = datetime.now(UTC).isoformat()
        self.store.save(
            {
                "organization": request.organization,
                "project_id": request.project_id,
                "project_name": selected_project["name"],
                "team_id": request.team_id,
                "team_name": selected_team["name"],
                "encrypted_pat": cipher.encrypt(request.pat.get_secret_value()),
                "created_at": now,
                "updated_at": now,
            }
        )
        return self.summary()

    def summary(self) -> ConnectionSummary:
        record = self.store.get()
        if not record:
            return ConnectionSummary(connected=False)
        return ConnectionSummary(
            connected=True,
            organization=record["organization"],
            project_id=record["project_id"],
            project_name=record["project_name"],
            team_id=record["team_id"],
            team_name=record["team_name"],
            pat_configured=True,
        )

    def active(self) -> tuple[dict[str, Any], AzureDevOpsClient]:
        record = self.store.get()
        if not record:
            raise ConnectorError(
                "Connect an Azure DevOps project and team first.",
                409,
                "ADO_NOT_CONFIGURED",
            )
        pat = self._cipher().decrypt(record["encrypted_pat"])
        return record, self.client(record["organization"], pat)

    def disconnect(self) -> None:
        self.store.delete()
