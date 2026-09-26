from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.config import Settings
from app.connectors.azure_devops import AzureDevOpsClient
from app.db import ConnectionStore
from app.dependencies import (
    get_connection_service_dependency,
    get_settings,
    get_work_item_service,
)
from app.main import app
from app.services.connections import ConnectionService
from app.services.work_items import WorkItemService


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_origin="http://localhost:5173",
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        credential_encryption_key=Fernet.generate_key().decode("ascii"),
    )


@pytest.fixture
def client(settings: Settings, request) -> Iterator[TestClient]:
    app.dependency_overrides[get_settings] = lambda: settings
    store = ConnectionStore(settings.sqlite_path)
    connection_service = ConnectionService(settings, store)
    connected = getattr(request, "param", True)
    if connected:
        store.save(
            {
                "organization": "test",
                "project_id": "project-id",
                "project_name": "Product",
                "team_id": "team-id",
                "team_name": "Team",
                "encrypted_pat": connection_service._cipher().encrypt("pat"),
                "created_at": "2026-06-01T10:00:00Z",
                "updated_at": "2026-06-01T10:00:00Z",
            }
        )
    app.dependency_overrides[get_connection_service_dependency] = lambda: (
        connection_service
    )
    if connected:
        app.dependency_overrides[get_work_item_service] = lambda: WorkItemService(
            AzureDevOpsClient(
                "test",
                "pat",
                transport=httpx.MockTransport(
                    lambda request: httpx.Response(
                        200, json={"value": [], "workItems": []}
                    )
                ),
            ),
            "project-id",
            "Product",
            "team-id",
        )
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
