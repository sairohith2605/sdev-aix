import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.codebase.models import RepositoryContext
from app.dependencies import get_plan_service
from app.errors import PlanError
from app.main import app
from app.planning.drafting import GeneratedPlan, generation_prompt, validate_generation
from app.planning.models import (
    PlanRevisionRequest,
    PlanSource,
    PlanVersionRequest,
    SavePlanRequest,
)
from app.planning.store import PlanStore
from app.services.plans import PlanService
from tests.test_plans import story


def generated(content: str = "Show employees") -> GeneratedPlan:
    return GeneratedPlan.model_validate(
        {
            "functionalPlan": [{"id": "f1", "title": "Overview", "content": content}],
            "technicalPlan": [
                {"id": "t1", "title": "Implementation", "content": "Add tests"}
            ],
        }
    )


def ready_plan(service: PlanService) -> str:
    plan = service.create_from_story(
        story(),
        PlanSource(organization="contoso", projectId="p1"),
        [],
        enqueue_analysis=True,
    )
    run = service.store.claim_next()
    service.project_graph(
        plan.id,
        run["id"],
        {
            "analysis": {
                "goal": "View employees",
                "facts": [{"statement": "View employees", "source": "title"}],
                "gaps": [],
                "assumptions": [],
                "questions": [],
            },
            "current_round": None,
        },
    )
    return plan.id


def test_generation_schema_and_pinned_citations(tmp_path: Path):
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan = service.create_from_story(
        story(), PlanSource(organization="a", projectId="b"), []
    )
    assert '"repositoryContext": null' in generation_prompt(plan)
    with pytest.raises(ValueError):
        validate_generation(generated("See [evidence:invented]"), plan, revision=False)
    with pytest.raises(ValidationError):
        generated(" ")
    with pytest.raises(ValidationError):
        GeneratedPlan.model_validate(
            {
                "functionalPlan": [{"id": "same", "title": "A", "content": "a"}],
                "technicalPlan": [{"id": "same", "title": "B", "content": "b"}],
            }
        )


def test_generation_uses_saved_evidence_without_repository_lookup(tmp_path: Path):
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan_id = ready_plan(service)
    plan = service.get(plan_id)
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
            "profile": "Python service",
            "evidence": [
                {
                    "chunkId": "chunk-1",
                    "commitSha": "abc123",
                    "snapshotId": "abc123",
                    "contentHash": "content-hash",
                    "path": "src/employees.py",
                    "language": "python",
                    "symbol": "list_employees",
                    "kind": "function",
                    "startLine": 1,
                    "endLine": 5,
                    "excerpt": "def list_employees(): pass",
                    "reason": "Matched employee",
                }
            ],
        }
    )
    updated = plan.model_copy(update={"repositoryContext": context, "version": 3})
    assert service.store.replace(updated, plan.version)
    run = service.request_generation(
        plan_id, PlanVersionRequest(expectedVersion=3), "draft"
    )
    assert run["base_version"] == 3
    prompt = generation_prompt(service.get(plan_id))
    assert "src/employees.py" in prompt and '"snapshotId": "abc123"' in prompt
    validate_generation(generated("Use [evidence:chunk-1]"), updated, revision=False)
    with pytest.raises(ValueError):
        validate_generation(generated("Use [evidence:other]"), updated, revision=False)


def test_draft_revision_queue_and_atomic_projection(tmp_path: Path):
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan_id = ready_plan(service)
    initial = service.get(plan_id)
    request = PlanVersionRequest(expectedVersion=initial.version)
    first = service.request_generation(plan_id, request, "draft")
    assert first["status"] == "queued"
    assert service.request_generation(plan_id, request, "draft")["id"] == first["id"]
    with pytest.raises(PlanError) as error:
        service.request_generation(plan_id, request, "revise")
    assert error.value.code == "PLAN_NOT_REVIEWABLE"
    claimed = service.store.claim_next()
    assert claimed["id"] == first["id"]
    with pytest.raises(PlanError) as error:
        service.request_generation(
            plan_id, PlanVersionRequest(expectedVersion=1), "draft"
        )
    assert (
        error.value.code == "PLAN_RUN_ACTIVE"
        or error.value.code == "PLAN_VERSION_CONFLICT"
    )
    projected = service.project_generation(plan_id, claimed, generated())
    assert projected.revision == 1 and projected.status == "review"
    assert service.store.latest_run(plan_id)["status"] == "completed"
    assert (
        service.get(plan_id).revisionHistory[0].functionalPlan
        == projected.functionalPlan
    )

    edited = service.save(
        plan_id,
        SavePlanRequest(
            workItemId=42,
            expectedVersion=projected.version,
            functionalPlan=[{"id": "f1", "title": "Overview", "content": "Reviewed"}],
            technicalPlan=projected.technicalPlan,
        ),
    )
    revision = service.request_generation(
        plan_id,
        PlanRevisionRequest(expectedVersion=edited.version, feedback="Improve testing"),
        "revise",
    )
    with pytest.raises(PlanError) as error:
        service.save(
            plan_id,
            SavePlanRequest(
                workItemId=42,
                expectedVersion=edited.version,
                functionalPlan=edited.functionalPlan,
                technicalPlan=edited.technicalPlan,
            ),
        )
    assert error.value.code == "PLAN_RUN_ACTIVE"
    claimed = service.store.claim_next()
    assert claimed["id"] == revision["id"]
    with pytest.raises(ValueError):
        validate_generation(
            GeneratedPlan.model_validate(
                {
                    "functionalPlan": [
                        {"id": "different", "title": "Overview", "content": "X"}
                    ],
                    "technicalPlan": [
                        {"id": "t1", "title": "Implementation", "content": "Y"}
                    ],
                }
            ),
            edited,
            revision=True,
        )
    revised = service.project_generation(
        plan_id, claimed, generated("Revised behavior")
    )
    assert revised.revision == 2
    assert revised.revisionHistory[0].functionalPlan[0].content == "Reviewed"
    assert revised.revisionHistory[1].feedback == "Improve testing"
    assert service.get(plan_id).conversation[-2].content == "Improve testing"


def test_failed_generation_retries_without_losing_draft(tmp_path: Path):
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan_id = ready_plan(service)
    run = service.request_generation(
        plan_id, PlanVersionRequest(expectedVersion=2), "draft"
    )
    service.store.claim_next()
    service.store.fail_run(run["id"], "COPILOT_INVALID_OUTPUT")
    assert service.get(plan_id).revision == 0
    assert service.store.retry_run(plan_id)
    assert service.store.claim_next()["id"] == run["id"]
    service.store.fail_run(run["id"], "COPILOT_INVALID_OUTPUT")
    assert service.store.latest_run(plan_id)["error_code"] == "COPILOT_INVALID_OUTPUT"


def test_interrupted_generation_is_retryable_after_restart(tmp_path: Path):
    database = tmp_path / "plans.db"
    service = PlanService(PlanStore(database))
    plan_id = ready_plan(service)
    run = service.request_generation(
        plan_id, PlanVersionRequest(expectedVersion=2), "draft"
    )
    assert service.store.claim_next()["id"] == run["id"]
    restarted = PlanService(PlanStore(database))
    restarted.store.interrupt_running()
    assert restarted.store.latest_run(plan_id)["error_code"] == "RUN_INTERRUPTED"
    assert restarted.get(plan_id).revision == 0
    assert restarted.store.retry_run(plan_id)
    assert restarted.store.claim_next()["id"] == run["id"]


def test_generation_api_returns_accepted_run(tmp_path: Path):
    service = PlanService(PlanStore(tmp_path / "plans.db"))
    plan_id = ready_plan(service)
    app.dependency_overrides[get_plan_service] = lambda: service
    try:
        with TestClient(app) as client:
            missing = client.post(f"/api/plans/{plan_id}/draft", json={})
            assert missing.status_code == 422
            response = client.post(
                f"/api/plans/{plan_id}/draft", json={"expectedVersion": 2}
            )
            assert response.status_code == 202
            assert response.json()["action"] == "draft"
            assert client.get(f"/api/plans/{plan_id}/run").json()["status"] == "queued"
            with sqlite3.connect(service.store.database_path) as connection:
                payload = connection.execute(
                    "SELECT input_payload FROM plan_runs WHERE id = ?",
                    (response.json()["id"],),
                ).fetchone()[0]
            assert json.loads(payload) == {"feedback": ""}
            assert (
                client.post(
                    f"/api/plans/{plan_id}/draft", json={"expectedVersion": 2}
                ).json()["id"]
                == response.json()["id"]
            )
            assert (
                client.post(
                    f"/api/plans/{plan_id}/revisions",
                    json={"expectedVersion": 2, "feedback": "Not yet"},
                ).status_code
                == 409
            )
            claimed = service.store.claim_next()
            service.project_generation(plan_id, claimed, generated())
            revision = client.post(
                f"/api/plans/{plan_id}/revisions",
                json={"expectedVersion": 3, "feedback": "Add sorting tests"},
            )
            assert revision.status_code == 202
            assert revision.json()["action"] == "revise"
            assert revision.json()["baseVersion"] == 3
            blocked = client.post(
                f"/api/plans/{plan_id}/finalize", json={"expectedVersion": 3}
            )
            assert blocked.status_code == 409
            assert blocked.json()["code"] == "PLAN_RUN_ACTIVE"
            assert (
                client.post(
                    f"/api/plans/{plan_id}/revisions",
                    json={"expectedVersion": 2, "feedback": "Stale"},
                ).status_code
                == 409
            )
    finally:
        app.dependency_overrides.pop(get_plan_service, None)
