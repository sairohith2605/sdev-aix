import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.planning.analysis import StoryAnalysis
from app.probes import copilot


@pytest.mark.asyncio
async def test_probe_loads_connected_story_and_prints_only_analysis(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture, tmp_path: Path
) -> None:
    monkeypatch.setenv("COPILOT_GITHUB_TOKEN", "github-secret")
    monkeypatch.setattr(
        copilot,
        "get_settings",
        lambda: SimpleNamespace(
            copilot_model="auto", copilot_timeout_seconds=90, copilot_home=tmp_path
        ),
    )

    class Connection:
        def active(self):
            return (
                {"project_id": "project", "project_name": "Product", "team_id": "team"},
                object(),
            )

    monkeypatch.setattr(
        copilot, "get_connection_service", lambda settings: Connection()
    )

    class WorkItems:
        def __init__(self, client, project_id, project_name, team_id):
            assert (project_id, project_name, team_id) == ("project", "Product", "team")

        async def get(self, work_item_id):
            assert work_item_id == 42
            return {"id": 42, "title": "Employees", "description": "Show a grid"}

    monkeypatch.setattr(copilot, "WorkItemService", WorkItems)

    class Provider:
        def __init__(self, model, timeout, data_path):
            assert (model, timeout, data_path) == ("auto", 90, tmp_path)

        async def analyze(self, story, token):
            assert story["id"] == 42
            assert token == "github-secret"
            return StoryAnalysis.model_validate(
                {
                    "goal": "Show employees",
                    "facts": [{"statement": "Grid requested", "source": "description"}],
                    "gaps": [],
                    "assumptions": [],
                    "questions": [],
                }
            )

    monkeypatch.setattr(copilot, "CopilotAnalysisProvider", Provider)

    assert await copilot.probe(42) == 0
    output = capsys.readouterr()
    assert json.loads(output.out)["goal"] == "Show employees"
    assert "github-secret" not in output.out + output.err


@pytest.mark.asyncio
async def test_probe_without_pat_does_not_fetch_story(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    monkeypatch.delenv("COPILOT_GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(
        copilot,
        "get_connection_service",
        lambda settings: pytest.fail("ADO must not be called without Copilot PAT"),
    )

    assert await copilot.probe(42) == 2
    assert "COPILOT_PAT_REQUIRED" in capsys.readouterr().err
