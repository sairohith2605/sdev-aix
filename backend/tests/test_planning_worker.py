from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.codebase.models import RepositoryContext
from app.config import Settings
from app.dependencies import get_copilot_connection_service, get_plan_service
from app.errors import PlanError
from app.main import app
from app.planning.analysis import StoryAnalysis
from app.planning.graph import build_clarification_graph
from app.planning.models import PlanQuestion, PlanSource, SubmitClarificationsRequest
from app.planning.store import PlanStore
from app.planning.worker import PlanningWorker
from app.services.plans import PlanService
from tests.test_plans import story


class FakeCredentials:
    def active_pat(self) -> str:
        return "private-token"


class FakeProvider:
    def __init__(self):
        self.repository_context = None

    async def analyze(self, story, pat, *, repository_context=None):
        assert pat == "private-token"
        self.repository_context = repository_context
        return StoryAnalysis.model_validate(
            {
                "goal": story["title"],
                "facts": [{"statement": "Title", "source": "title"}],
                "gaps": [],
                "assumptions": [],
                "questions": [
                    {"prompt": "Who uses this?", "rationale": "Clarify audience"}
                ],
            }
        )

    async def follow_up(self, story, analysis, answers, pat):
        raise AssertionError("No follow-up expected for a known answer")


@pytest.mark.asyncio
@asynccontextmanager
async def graph_for(worker: PlanningWorker, checkpoint_path: Path):
    async with AsyncSqliteSaver.from_conn_string(str(checkpoint_path)) as saver:
        saver.serde = JsonPlusSerializer(allowed_msgpack_modules=[])
        yield build_clarification_graph(worker.provider, worker.credentials, saver)


@pytest.mark.asyncio
async def test_worker_projects_analysis_and_resumes_from_durable_checkpoint(
    tmp_path: Path,
):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        copilot_data_path=tmp_path / "copilot",
    )
    provider = FakeProvider()
    worker = PlanningWorker(settings, provider=provider)
    worker.credentials = FakeCredentials()
    plan = worker.service.create_from_story(
        story(),
        PlanSource(organization="contoso", projectId="project-1"),
        [],
        enqueue_analysis=True,
    )

    async with graph_for(worker, tmp_path / "checkpoints.sqlite") as graph:
        assert await worker.process_one(graph)
    projected = worker.service.get(plan.id)
    assert worker.store.latest_run(plan.id)["status"] == "awaiting_input"
    assert projected.version == 2
    assert projected.clarificationRounds[0].questions[0].prompt == "Who uses this?"

    worker.service.submit_clarifications(
        plan.id,
        SubmitClarificationsRequest(
            expectedVersion=2,
            roundId="round-1",
            answers=[{"questionId": "r1-q1", "value": "HR admins", "unknown": False}],
        ),
    )
    async with graph_for(worker, tmp_path / "checkpoints.sqlite") as graph:
        assert await worker.process_one(graph)

    resumed = worker.service.get(plan.id)
    assert worker.store.latest_run(plan.id)["status"] == "ready_for_draft"
    assert resumed.clarificationRounds[0].answers[0].value == "HR admins"
    assert resumed.conversation[-1].role == "agent"


@pytest.mark.asyncio
async def test_worker_pins_repository_context_in_graph_and_plan(tmp_path: Path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'plans.db'}")
    provider = FakeProvider()
    worker = PlanningWorker(settings, provider=provider)
    worker.credentials = FakeCredentials()
    context = RepositoryContext.model_validate(
        {
            "snapshot": {
                "name": "employee-portal",
                "branch": "main",
                "commitSha": "abc123",
                "snapshotId": "abc123",
                "dirty": False,
                "indexedAt": "2026-09-27T10:00:00Z",
            },
            "profile": "Languages: python.",
            "evidence": [
                {
                    "chunkId": "chunk-1",
                    "commitSha": "abc123",
                    "snapshotId": "abc123",
                    "contentHash": "content-abc123",
                    "path": "src/employees.py",
                    "language": "python",
                    "symbol": "EmployeeDirectory",
                    "kind": "class",
                    "startLine": 1,
                    "endLine": 5,
                    "excerpt": "class EmployeeDirectory: pass",
                    "reason": "Matched story terms: employee",
                }
            ],
        }
    )

    class FakeRetriever:
        def retrieve(self, _story):
            return context

    worker.retriever = FakeRetriever()

    class ReadyRepository:
        def summary(self):
            return type("Summary", (), {"connected": True})()

    worker.repository_service = ReadyRepository()
    plan = worker.service.create_from_story(
        story(),
        PlanSource(organization="contoso", projectId="project-1"),
        [],
        enqueue_analysis=True,
    )

    async with graph_for(worker, tmp_path / "checkpoints.sqlite") as graph:
        assert await worker.process_one(graph)

    projected = worker.service.get(plan.id)
    assert projected.repositoryContext == context
    assert provider.repository_context["snapshot"]["snapshotId"] == "abc123"


def test_answer_endpoint_validates_and_queues_checkpoint_resume(tmp_path: Path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'plans.db'}")
    service = PlanService(PlanStore(settings.sqlite_path))
    plan = service.create_from_story(
        story(),
        PlanSource(organization="contoso", projectId="project-1"),
        [PlanQuestion(id="r1-q1", prompt="Who uses this?", rationale="Audience")],
    )
    app.dependency_overrides[get_plan_service] = lambda: service

    class MissingCopilot:
        def active_pat(self):
            raise PlanError("Copilot is unavailable", 409, "COPILOT_NOT_CONFIGURED")

    app.dependency_overrides[get_copilot_connection_service] = MissingCopilot
    try:
        from fastapi.testclient import TestClient

        with TestClient(app) as client:
            response = client.post(
                f"/api/plans/{plan.id}/clarifications",
                json={
                    "roundId": plan.clarificationRounds[0].id,
                    "expectedVersion": 1,
                    "answers": [
                        {"questionId": "r1-q1", "value": "HR", "unknown": False}
                    ],
                },
            )
            assert response.status_code == 200
            assert response.json()["version"] == 2
            status = client.get(f"/api/plans/{plan.id}/run")
            assert status.json()["status"] == "queued"
    finally:
        app.dependency_overrides.pop(get_plan_service, None)
        app.dependency_overrides.pop(get_copilot_connection_service, None)
