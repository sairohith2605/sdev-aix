import base64
from typing import Any

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.connectors.azure_devops import AzureDevOpsClient
from app.db import ConnectionStore
from app.dependencies import get_connection_service_dependency
from app.errors import ConnectorError
from app.main import app
from app.schemas import SaveConnectionRequest
from app.services.connections import ConnectionService


def ado_handler(routes: dict[str, Any]):
    def handler(request: httpx.Request) -> httpx.Response:
        authorization = request.headers.get("authorization", "")
        assert authorization.startswith("Basic ")
        decoded = base64.b64decode(authorization.removeprefix("Basic ")).decode()
        assert decoded.startswith(":")

        route = routes.get((request.method, request.url.path))
        if isinstance(route, Exception):
            raise route
        if route is None:
            return httpx.Response(404, json={"message": "missing"})
        if isinstance(route, httpx.Response):
            return route
        return httpx.Response(200, json=route)

    return handler


@pytest.mark.asyncio
async def test_connection_discovers_projects_and_team_and_persists_encrypted_pat(
    settings, tmp_path
):
    settings = settings.model_copy(
        update={"credential_encryption_key": Fernet.generate_key().decode()}
    )
    store = ConnectionStore(tmp_path / "connections.sqlite")
    transport = httpx.MockTransport(
        ado_handler(
            {
                ("GET", "/org/_apis/projects"): {
                    "value": [{"id": "p1", "name": "Product"}]
                },
                ("GET", "/org/_apis/projects/p1/teams"): {
                    "value": [{"id": "t1", "name": "Client Team"}]
                },
            }
        )
    )

    def fake_client(_organization: str, _pat: str, **_kwargs):
        return AzureDevOpsClient("org", "secret-pat", transport=transport)

    service = ConnectionService(settings, store, client_factory=fake_client)

    await service.test("org", "secret-pat")
    projects = await service.projects("org", "secret-pat")
    teams = await service.teams("org", "secret-pat", "p1")
    summary = await service.save(
        SaveConnectionRequest(
            organization="org",
            pat="secret-pat",
            project_id="p1",
            project_name="Forged project name",
            team_id="t1",
            team_name="Forged team name",
        )
    )

    stored = store.get()
    assert projects == [{"id": "p1", "name": "Product"}]
    assert teams == [{"id": "t1", "name": "Client Team"}]
    assert summary.connected is True
    assert summary.team_name == "Client Team"
    assert stored is not None
    assert stored["encrypted_pat"] != "secret-pat"
    assert "secret-pat" not in str(summary.model_dump())


def test_store_connection_requires_encryption_key(settings, tmp_path):
    settings = settings.model_copy(update={"credential_encryption_key": ""})
    service = ConnectionService(settings, ConnectionStore(tmp_path / "empty.sqlite"))
    service.store.save(
        {
            "organization": "org",
            "project_id": "p1",
            "project_name": "Product",
            "team_id": "t1",
            "team_name": "Client Team",
            "encrypted_pat": "encrypted",
            "created_at": "now",
            "updated_at": "now",
        }
    )

    with pytest.raises(ConnectorError, match="credential encryption is not configured"):
        service.active()


def test_connection_http_flow_never_returns_pat(settings, tmp_path):
    transport = httpx.MockTransport(
        ado_handler(
            {
                ("GET", "/org/_apis/projects"): {
                    "value": [{"id": "p1", "name": "Product"}]
                },
                ("GET", "/org/_apis/projects/p1/teams"): {
                    "value": [{"id": "t1", "name": "Client Team"}]
                },
            }
        )
    )
    store = ConnectionStore(tmp_path / "http-connections.sqlite")
    service = ConnectionService(
        settings,
        store,
        client_factory=lambda organization, pat, **kwargs: AzureDevOpsClient(
            organization, pat, transport=transport
        ),
    )
    app.dependency_overrides[get_connection_service_dependency] = lambda: service
    try:
        with TestClient(app) as test_client:
            test_connection = test_client.post(
                "/api/connections/azure-devops/test",
                json={"organization": "org", "pat": "secret-pat"},
            )
            stored_projects = test_client.post(
                "/api/connections/azure-devops/projects",
                json={"organization": "org", "pat": "secret-pat"},
            )
            projects = stored_projects
            teams = test_client.post(
                "/api/connections/azure-devops/teams",
                json={
                    "organization": "org",
                    "pat": "secret-pat",
                    "project_id": "p1",
                    "project_name": "Product",
                },
            )
            saved = test_client.put(
                "/api/connections/azure-devops",
                json={
                    "organization": "org",
                    "pat": "secret-pat",
                    "project_id": "p1",
                    "project_name": "Product",
                    "team_id": "t1",
                    "team_name": "Client Team",
                },
            )
            summary = test_client.get("/api/connections/azure-devops")

        assert test_connection.status_code == 200
        assert projects.json() == [{"id": "p1", "name": "Product"}]
        assert teams.json() == [{"id": "t1", "name": "Client Team"}]
        assert saved.status_code == 200
        assert summary.json()["team_name"] == "Client Team"
        assert "secret-pat" not in saved.text + summary.text

        disconnected = test_client.delete("/api/connections/azure-devops")
        assert disconnected.status_code == 200
        assert disconnected.json() == {"connected": False}
        assert test_client.get("/api/connections/azure-devops").json() == {
            "connected": False,
            "organization": None,
            "project_id": None,
            "project_name": None,
            "team_id": None,
            "team_name": None,
            "pat_configured": False,
        }
    finally:
        app.dependency_overrides.clear()
