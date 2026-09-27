import json

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.dependencies import (
    get_connection_service_dependency,
    get_copilot_connection_service,
    get_plan_service,
)
from app.errors import ConnectorError, PlanError, raise_http_error
from app.planning.models import (
    Plan,
    PlanRevisionRequest,
    PlanSource,
    PlanVersionRequest,
    SavePlanRequest,
    SubmitClarificationsRequest,
)
from app.services.connections import ConnectionService
from app.services.copilot_connections import CopilotConnectionService
from app.services.plans import PlanService
from app.services.work_items import WorkItemService

router = APIRouter(prefix="/plans", tags=["plans"])


class CreatePlanRequest(BaseModel):
    workItemId: int = Field(gt=0)


@router.get("", response_model=list[Plan])
def list_plans(service: PlanService = Depends(get_plan_service)):
    return service.list()


@router.post("", response_model=Plan, status_code=201)
async def create_plan(
    request: CreatePlanRequest,
    response: Response,
    service: PlanService = Depends(get_plan_service),
    ado: ConnectionService = Depends(get_connection_service_dependency),
    copilot: CopilotConnectionService = Depends(get_copilot_connection_service),
):
    try:
        copilot.active_pat()
        record, ado_client = ado.active()
        source = PlanSource(
            organization=record["organization"], projectId=record["project_id"]
        )
        existing = service.store.find_by_source(
            source.organization.casefold(), source.projectId, request.workItemId
        )
        if existing:
            response.status_code = 200
            return existing
        story = await WorkItemService(
            ado_client,
            record["project_id"],
            record["project_name"],
            record["team_id"],
        ).get(request.workItemId)
        plan = service.create_from_story(story, source, [], enqueue_analysis=True)
        return plan
    except (PlanError, ConnectorError) as error:
        return raise_http_error(error)


@router.get("/{plan_id}", response_model=Plan)
def get_plan(plan_id: str, service: PlanService = Depends(get_plan_service)):
    try:
        return service.get(plan_id)
    except PlanError as error:
        return raise_http_error(error)


@router.put("/{plan_id}", response_model=Plan)
def save_plan(
    plan_id: str,
    request: SavePlanRequest,
    service: PlanService = Depends(get_plan_service),
):
    try:
        return service.save(plan_id, request)
    except PlanError as error:
        return raise_http_error(error)


@router.post("/{plan_id}/finalize", response_model=Plan)
def finalize_plan(
    plan_id: str,
    request: PlanVersionRequest,
    service: PlanService = Depends(get_plan_service),
):
    try:
        return service.finalize(plan_id, request)
    except PlanError as error:
        return raise_http_error(error)


@router.post("/{plan_id}/reopen", response_model=Plan)
def reopen_plan(
    plan_id: str,
    request: PlanVersionRequest,
    service: PlanService = Depends(get_plan_service),
):
    try:
        return service.reopen(plan_id, request)
    except PlanError as error:
        return raise_http_error(error)


@router.post("/{plan_id}/clarifications")
def submit_clarifications(
    plan_id: str,
    request: SubmitClarificationsRequest,
    service: PlanService = Depends(get_plan_service),
):
    try:
        return service.submit_clarifications(plan_id, request)
    except PlanError as error:
        return raise_http_error(error)


def _run_response(plan_id: str, run: dict) -> dict:
    return {
        "id": run["id"],
        "planId": plan_id,
        "status": run["status"],
        "errorCode": run["error_code"],
        "action": run["action"],
        "baseVersion": run["base_version"],
        "feedback": json.loads(run["input_payload"]).get("feedback")
        if run["action"] == "revise"
        else None,
    }


@router.post("/{plan_id}/draft", status_code=202)
def generate_draft(
    plan_id: str,
    request: PlanVersionRequest,
    service: PlanService = Depends(get_plan_service),
):
    try:
        return _run_response(
            plan_id, service.request_generation(plan_id, request, "draft")
        )
    except PlanError as error:
        return raise_http_error(error)


@router.post("/{plan_id}/revisions", status_code=202)
def request_revision(
    plan_id: str,
    request: PlanRevisionRequest,
    service: PlanService = Depends(get_plan_service),
):
    try:
        return _run_response(
            plan_id, service.request_generation(plan_id, request, "revise")
        )
    except PlanError as error:
        return raise_http_error(error)


@router.get("/{plan_id}/run")
def run_status(plan_id: str, service: PlanService = Depends(get_plan_service)):
    try:
        service.get(plan_id)
        run = service.store.latest_run(plan_id)
        if run is None:
            raise PlanError("Plan run not found.", 404, "PLAN_RUN_NOT_FOUND")
        return _run_response(plan_id, run)
    except PlanError as error:
        return raise_http_error(error)


@router.post("/{plan_id}/run/retry")
def retry_run(plan_id: str, service: PlanService = Depends(get_plan_service)):
    try:
        service.get(plan_id)
        if not service.store.retry_run(plan_id):
            raise PlanError("No failed plan run to retry.", 409, "PLAN_RUN_NOT_FAILED")
        return run_status(plan_id, service)
    except PlanError as error:
        return raise_http_error(error)


@router.delete("/{plan_id}", status_code=204)
async def delete_plan(plan_id: str, service: PlanService = Depends(get_plan_service)):
    try:
        service.delete(plan_id)
    except PlanError as error:
        return raise_http_error(error)
    return Response(status_code=204)
