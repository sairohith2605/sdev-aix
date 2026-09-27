import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import ConnectionStore
from app.dependencies import get_plan_service
from app.main import app
from app.planning.models import (
    PlanAnswer,
    PlanQuestion,
    PlanRevision,
    PlanSection,
    PlanSource,
)
from app.planning.store import PlanStore
from app.services.plans import PlanService


def story() -> dict:
    return {
        "id": 42,
        "title": "View employees",
        "summary": "View employees",
        "description": None,
        "acceptanceCriteria": None,
        "type": "User Story",
        "state": "Active",
        "priority": 2,
        "assignedTo": None,
        "assignedToId": None,
        "sprintId": "Product\\Sprint 1",
        "sprintName": "Sprint 1",
        "iterationPath": "Product\\Sprint 1",
        "updatedAt": "2026-09-20T12:00:00Z",
    }


def source(organization: str = "contoso") -> PlanSource:
    return PlanSource(organization=organization, projectId="project-1")


def create_review_plan(service: PlanService) -> str:
    plan = service.create_from_story(
        story(),
        source(),
        [PlanQuestion(id="q1", prompt="Who uses the grid?", rationale="Scope")],
    )
    now = datetime.now(UTC)
    answered = plan.clarificationRounds[0].model_copy(
        update={
            "answers": [PlanAnswer(questionId="q1", value="HR", unknown=False)],
            "submittedAt": now,
        }
    )
    functional = [PlanSection(id="f1", title="Overview", content="Show an HR grid")]
    technical = [PlanSection(id="t1", title="Implementation", content="Design a table")]
    draft = plan.model_copy(
        update={
            "status": "review",
            "clarificationRounds": [answered],
            "functionalPlan": functional,
            "technicalPlan": technical,
            "revision": 1,
            "revisionHistory": [
                PlanRevision(
                    revision=1,
                    feedback="Initial provisional draft",
                    functionalPlan=functional,
                    technicalPlan=technical,
                    createdAt=now,
                )
            ],
            "updatedAt": now,
            "version": 2,
        }
    )
    assert service.store.replace(draft, plan.version)
    return plan.id


def test_plan_migration_preserves_connection_and_is_repeatable(tmp_path: Path) -> None:
    database = tmp_path / "existing.db"
    connection_store = ConnectionStore(database)
    connection_store.save(
        {
            "organization": "contoso",
            "project_id": "project-1",
            "project_name": "Product",
            "team_id": "team-1",
            "team_name": "Product Team",
            "encrypted_pat": "encrypted-existing-pat",
            "created_at": "2026-09-20T12:00:00Z",
            "updated_at": "2026-09-20T12:00:00Z",
        }
    )

    store = PlanStore(database)
    PlanStore(database)

    assert store.list() == []
    assert connection_store.get()["encrypted_pat"] == "encrypted-existing-pat"
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 1


def test_internal_creation_is_idempotent_per_source_and_survives_restart(
    tmp_path: Path,
) -> None:
    database = tmp_path / "plans.db"
    service = PlanService(PlanStore(database))

    plan = service.create_from_story(story(), source("Contoso"), [])
    duplicate = service.create_from_story(story(), source(), [])
    different_org = service.create_from_story(story(), source("another-org"), [])

    assert duplicate.id == plan.id
    assert different_org.id != plan.id
    assert (
        service.create_from_story(
            story(), PlanSource(organization="contoso", projectId="project-2"), []
        ).id
        != plan.id
    )
    assert plan.source.organization == "contoso"
    assert plan.workItem.description == ""
    assert plan.workItem.acceptanceCriteria == ""
    assert (
        PlanService(PlanStore(database)).get(plan.id).model_dump() == plan.model_dump()
    )
    assert len(service.list()) == 3


def test_api_persists_edits_finalization_reopen_and_deletion(tmp_path: Path) -> None:
    database = tmp_path / "plans.db"
    service = PlanService(PlanStore(database))
    plan_id = create_review_plan(service)
    app.dependency_overrides[get_plan_service] = lambda: service

    try:
        with TestClient(app) as client:
            initial = client.get(f"/api/plans/{plan_id}")
            assert initial.status_code == 200
            assert initial.json()["workItem"]["description"] == ""
            assert initial.json()["workItem"]["updatedAt"].endswith("Z")
            assert client.get("/api/plans").json()[0]["id"] == plan_id
            assert (
                client.post("/api/plans", json={"workItemId": 42}).json()["code"]
                == "PLANNER_NOT_READY"
            )

            request = {
                "workItemId": 42,
                "expectedVersion": 2,
                "functionalPlan": [
                    {"id": "f1", "title": "Overview", "content": "Updated HR grid"}
                ],
                "technicalPlan": [
                    {"id": "t1", "title": "Implementation", "content": "New table"}
                ],
            }
            saved = client.put(f"/api/plans/{plan_id}", json=request)
            assert saved.status_code == 200
            assert saved.json()["version"] == 3
            assert (
                saved.json()["revisionHistory"][0]["functionalPlan"][0]["content"]
                == "Updated HR grid"
            )

            stale = client.put(f"/api/plans/{plan_id}", json=request)
            assert stale.status_code == 409
            assert stale.json()["code"] == "PLAN_VERSION_CONFLICT"

            finalized = client.post(
                f"/api/plans/{plan_id}/finalize", json={"expectedVersion": 3}
            )
            assert finalized.status_code == 200
            assert finalized.json()["status"] == "finalized"
            assert finalized.json()["finalizedAt"] is not None
            assert (
                client.put(
                    f"/api/plans/{plan_id}", json={**request, "expectedVersion": 4}
                ).status_code
                == 409
            )

        restarted = PlanService(PlanStore(database))
        assert restarted.get(plan_id).status == "finalized"
        assert restarted.get(plan_id).conversation[-1].role == "agent"
        assert restarted.get(plan_id).clarificationRounds[0].answers[0].value == "HR"
        assert restarted.get(plan_id).revisionHistory[0].technicalPlan[0].content == (
            "New table"
        )

        with TestClient(app) as client:
            reopened = client.post(
                f"/api/plans/{plan_id}/reopen", json={"expectedVersion": 4}
            )
            assert reopened.json()["status"] == "review"
            assert reopened.json()["version"] == 5
            assert reopened.json()["finalizedAt"] is None
            assert client.delete(f"/api/plans/{plan_id}").status_code == 204
            missing = client.get(f"/api/plans/{plan_id}")
            assert missing.status_code == 404
            assert missing.json()["code"] == "PLAN_NOT_FOUND"
    finally:
        app.dependency_overrides.pop(get_plan_service, None)


def test_finalization_rejects_unreviewed_or_empty_plans(tmp_path: Path) -> None:
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan = service.create_from_story(story(), source(), [])
    app.dependency_overrides[get_plan_service] = lambda: service
    try:
        with TestClient(app) as client:
            result = client.post(
                f"/api/plans/{plan.id}/finalize", json={"expectedVersion": 1}
            )
            assert result.status_code == 409
            assert result.json()["code"] == "PLAN_NOT_REVIEWABLE"
            draft = plan.model_copy(
                update={"status": "review", "revision": 1, "version": 2}
            )
            assert service.store.replace(draft, 1)
            incomplete = client.post(
                f"/api/plans/{plan.id}/finalize", json={"expectedVersion": 2}
            )
            assert incomplete.status_code == 409
            assert incomplete.json()["code"] == "PLAN_INCOMPLETE"
    finally:
        app.dependency_overrides.pop(get_plan_service, None)
