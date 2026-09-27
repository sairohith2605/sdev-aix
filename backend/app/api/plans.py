from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from app.dependencies import get_plan_service
from app.errors import PlanError, raise_http_error
from app.planning.models import Plan, PlanVersionRequest, SavePlanRequest
from app.services.plans import PlanService

router = APIRouter(prefix="/plans", tags=["plans"])


def _not_ready() -> JSONResponse:
    return raise_http_error(
        PlanError(
            "Agent planning is not available yet. The saved-plan API is ready.",
            503,
            "PLANNER_NOT_READY",
        )
    )


@router.get("", response_model=list[Plan])
def list_plans(service: PlanService = Depends(get_plan_service)):
    return service.list()


@router.post("")
def create_plan():
    return _not_ready()


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
@router.post("/{plan_id}/draft")
@router.post("/{plan_id}/revisions")
def agent_action_not_ready(plan_id: str):
    return _not_ready()


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: str, service: PlanService = Depends(get_plan_service)):
    try:
        service.delete(plan_id)
    except PlanError as error:
        return raise_http_error(error)
    return Response(status_code=204)
