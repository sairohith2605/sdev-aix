import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_copilot_connection_service
from app.main import app
from app.providers.copilot import CopilotAnalysisError, CopilotAnalysisProvider
from app.services.copilot_connections import CopilotConnectionService


def test_copilot_pat_test_save_rotation_and_disconnect(
    settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    verified: list[str] = []

    async def verify(self, token: str) -> None:
        verified.append(token)
        if token == "bad-token":
            raise CopilotAnalysisError("COPILOT_FORBIDDEN", "Copilot access denied.")

    monkeypatch.setattr(CopilotAnalysisProvider, "verify", verify)
    service = CopilotConnectionService(settings)
    app.dependency_overrides[get_copilot_connection_service] = lambda: service
    try:
        with TestClient(app) as client:
            assert client.get("/api/connections/github-copilot").json() == {
                "connected": False,
                "pat_configured": False,
            }
            checked = client.post(
                "/api/connections/github-copilot/test", json={"pat": "private-pat"}
            )
            assert checked.json() == {"connected": True}
            saved = client.put(
                "/api/connections/github-copilot", json={"pat": "private-pat"}
            )
            assert saved.json() == {"connected": True, "pat_configured": True}
            assert "private-pat" not in saved.text
            assert service.active_pat() == "private-pat"

            denied = client.put(
                "/api/connections/github-copilot", json={"pat": "bad-token"}
            )
            assert denied.status_code == 403
            assert service.active_pat() == "private-pat"

            rotated = client.put(
                "/api/connections/github-copilot", json={"pat": "rotated-pat"}
            )
            assert rotated.status_code == 200
            assert service.active_pat() == "rotated-pat"
            with sqlite3.connect(settings.sqlite_path) as connection:
                encrypted = connection.execute(
                    "SELECT encrypted_pat FROM copilot_connection WHERE id = 1"
                ).fetchone()[0]
            assert "rotated-pat" not in encrypted

            assert client.delete("/api/connections/github-copilot").json() == {
                "connected": False
            }
            assert not service.summary().connected
    finally:
        app.dependency_overrides.pop(get_copilot_connection_service, None)
    assert verified == ["private-pat", "private-pat", "bad-token", "rotated-pat"]
