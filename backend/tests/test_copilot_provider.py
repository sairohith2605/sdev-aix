import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from copilot.session_events import AssistantMessageData

from app.planning.models import PlanSource
from app.planning.store import PlanStore
from app.providers import copilot
from app.services.plans import PlanService
from tests.test_plans import story


def valid_analysis() -> dict:
    return {
        "goal": "Show employees in a grid",
        "facts": [{"statement": "Sorting is required", "source": "acceptanceCriteria"}],
        "gaps": ["No row limit stated"],
        "assumptions": [],
        "questions": [
            {"prompt": "How many rows?", "rationale": "Plan pagination behavior"}
        ],
    }


class FakeSession:
    def __init__(self, responses: list[str | Exception]) -> None:
        self.responses = responses
        self.prompts: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def send_and_wait(self, prompt: str, *, timeout: float):
        self.prompts.append(prompt)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return SimpleNamespace(
            data=AssistantMessageData(content=response, message_id="fake-message")
        )


class FakeClient:
    def __init__(self, session: FakeSession) -> None:
        self.session = session
        self.options: dict = {}
        self.session_options: dict = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def create_session(self, **kwargs):
        self.session_options = kwargs
        return self.session


def fake_provider(monkeypatch, tmp_path: Path, responses: list[str | Exception]):
    client = FakeClient(FakeSession(responses))

    def client_factory(**kwargs):
        client.options = kwargs
        return client

    monkeypatch.setattr(copilot, "CopilotClient", client_factory)
    provider = copilot.CopilotAnalysisProvider("auto", 2, tmp_path / "copilot")
    return provider, client


@pytest.mark.asyncio
async def test_provider_uses_pat_and_tool_free_mode(monkeypatch, tmp_path: Path):
    provider, client = fake_provider(
        monkeypatch, tmp_path, [json.dumps(valid_analysis())]
    )

    result = await provider.analyze(
        {"id": 42, "title": "Employees", "description": "<p>Show a grid.</p>"},
        "secret-pat",
    )

    assert result.goal == "Show employees in a grid"
    assert client.options["mode"] == "empty"
    assert client.options["github_token"] == "secret-pat"
    assert client.options["use_logged_in_user"] is False
    assert client.session_options["available_tools"] == []
    assert client.session_options["enable_skills"] is False
    assert client.session_options["infinite_sessions"] == {"enabled": False}
    assert "secret-pat" not in client.session.prompts[0]
    assert "Show a grid" in client.session.prompts[0]


@pytest.mark.asyncio
async def test_invalid_output_gets_one_correction_attempt(monkeypatch, tmp_path: Path):
    provider, client = fake_provider(
        monkeypatch, tmp_path, ["not JSON", json.dumps(valid_analysis())]
    )

    result = await provider.analyze({"id": 42, "title": "Employees"}, "pat")

    assert result.facts[0].source == "acceptanceCriteria"
    assert len(client.session.prompts) == 2
    assert "corrected" in client.session.prompts[1]


@pytest.mark.asyncio
async def test_json_fence_is_accepted_without_another_model_call(
    monkeypatch, tmp_path: Path
):
    provider, client = fake_provider(
        monkeypatch, tmp_path, ["```json\n" + json.dumps(valid_analysis()) + "\n```"]
    )

    result = await provider.analyze({"id": 42, "title": "Employees"}, "pat")

    assert result.goal == "Show employees in a grid"
    assert len(client.session.prompts) == 1


@pytest.mark.asyncio
async def test_invalid_output_fails_without_returning_model_text(
    monkeypatch, tmp_path: Path
):
    provider, client = fake_provider(
        monkeypatch, tmp_path, ["secret story", "still bad"]
    )

    with pytest.raises(copilot.CopilotAnalysisError) as error:
        await provider.analyze({"id": 42, "title": "Employees"}, "pat")

    assert error.value.code == "COPILOT_INVALID_OUTPUT"
    assert "secret story" not in str(error.value)
    assert "invalid JSON" in str(error.value)
    assert len(client.session.prompts) == 2


@pytest.mark.asyncio
async def test_schema_failure_reports_only_a_safe_field_and_error_type(
    monkeypatch, tmp_path: Path
):
    invalid = {**valid_analysis(), "goal": ""}
    provider, _ = fake_provider(
        monkeypatch, tmp_path, [json.dumps(invalid), json.dumps(invalid)]
    )

    with pytest.raises(copilot.CopilotAnalysisError) as error:
        await provider.analyze({"id": 42, "title": "Employees"}, "pat")

    assert error.value.code == "COPILOT_INVALID_OUTPUT"
    assert "schema root" in str(error.value)
    assert "Employees" not in str(error.value)


@pytest.mark.asyncio
async def test_provider_failure_does_not_expose_raw_error(monkeypatch, tmp_path: Path):
    provider, _ = fake_provider(
        monkeypatch, tmp_path, [RuntimeError("Authorization secret-pat failed")]
    )

    with pytest.raises(copilot.CopilotAnalysisError) as error:
        await provider.analyze({"id": 42, "title": "Employees"}, "secret-pat")

    assert error.value.code == "COPILOT_REQUEST_FAILED"
    assert "secret-pat" not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure", "code"),
    [
        ("Copilot returned 401: invalid token", "COPILOT_UNAUTHORIZED"),
        ("Copilot returned 403: organization policy", "COPILOT_FORBIDDEN"),
    ],
)
async def test_provider_reports_access_failures_without_raw_sdk_details(
    monkeypatch, tmp_path: Path, failure: str, code: str
):
    provider, _ = fake_provider(
        monkeypatch, tmp_path, [RuntimeError(f"{failure}; secret-pat")]
    )

    with pytest.raises(copilot.CopilotAnalysisError) as error:
        await provider.analyze({"id": 42, "title": "Employees"}, "secret-pat")

    assert error.value.code == code
    assert "secret-pat" not in str(error.value)


@pytest.mark.asyncio
async def test_missing_pat_is_reported_before_starting_a_client(
    monkeypatch, tmp_path: Path
):
    provider, _ = fake_provider(monkeypatch, tmp_path, [])

    with pytest.raises(copilot.CopilotAnalysisError) as error:
        await provider.analyze({"id": 42, "title": "Employees"}, " ")

    assert error.value.code == "COPILOT_PAT_REQUIRED"
    assert not provider.data_path.exists()


@pytest.mark.asyncio
async def test_draft_uses_pinned_input_and_denies_tools(monkeypatch, tmp_path: Path):
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan = service.create_from_story(
        story(), PlanSource(organization="a", projectId="b"), []
    )
    provider, client = fake_provider(
        monkeypatch,
        tmp_path,
        [
            json.dumps(
                {
                    "functionalPlan": [
                        {"id": "f1", "title": "Overview", "content": "Show a grid"}
                    ],
                    "technicalPlan": [
                        {"id": "t1", "title": "Implementation", "content": "Test it"}
                    ],
                }
            )
        ],
    )
    result = await provider.generate(plan, "secret-pat")
    assert result.technicalPlan[0].content == "Test it"
    assert client.session_options["available_tools"] == []
    assert client.session_options["enable_skills"] is False
    assert "secret-pat" not in client.session.prompts[0]
    assert '"repositoryContext": null' in client.session.prompts[0]


@pytest.mark.asyncio
async def test_draft_rejects_unpinned_evidence_without_exposing_output(
    monkeypatch, tmp_path: Path
):
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan = service.create_from_story(
        story(), PlanSource(organization="a", projectId="b"), []
    )
    invalid = json.dumps(
        {
            "functionalPlan": [
                {
                    "id": "f1",
                    "title": "Overview",
                    "content": "secret-value [evidence:made-up]",
                }
            ],
            "technicalPlan": [
                {"id": "t1", "title": "Implementation", "content": "Test it"}
            ],
        }
    )
    provider, client = fake_provider(monkeypatch, tmp_path, [invalid, invalid])
    with pytest.raises(copilot.CopilotAnalysisError) as error:
        await provider.generate(plan, "secret-pat")
    assert error.value.code == "COPILOT_INVALID_OUTPUT"
    assert "secret-value" not in str(error.value)
    assert len(client.session.prompts) == 2
