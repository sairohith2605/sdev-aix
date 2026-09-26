from fastapi import APIRouter, Depends, Query
from pydantic import TypeAdapter

from app.dependencies import get_work_item_service
from app.errors import ConnectorError, raise_http_error
from app.schemas import (
    WorkItemAssigneesResponse,
    WorkItemListResponse,
    WorkItemResponse,
    WorkItemSprintsResponse,
    WorkItemStatesResponse,
)
from app.services.work_items import WorkItemService

router = APIRouter(prefix="/work-items", tags=["work-items"])


@router.get("")
async def list_work_items(
    q: str = "",
    type: str | None = None,
    state: str | None = None,
    assignee: str | None = None,
    sprint: str | None = None,
    limit: int = Query(default=10, ge=1, le=100),
    cursor: str | None = None,
    service: WorkItemService = Depends(get_work_item_service),
):
    try:
        result = await service.list(
            search=q,
            item_type=type,
            state=state,
            assignee=assignee,
            sprint=sprint,
            limit=limit,
            cursor=cursor,
        )
        return (
            TypeAdapter(WorkItemListResponse)
            .validate_python(result)
            .model_dump(by_alias=True)
        )
    except ConnectorError as error:
        return raise_http_error(error)


@router.get("/facets/assignees")
async def work_item_assignees(
    q: str = "",
    service: WorkItemService = Depends(get_work_item_service),
):
    try:
        result = await service.assignees(q)
        return (
            TypeAdapter(WorkItemAssigneesResponse)
            .validate_python(result)
            .model_dump(by_alias=True)
        )
    except ConnectorError as error:
        return raise_http_error(error)


@router.get("/facets/sprints")
async def work_item_sprints(
    q: str = "",
    service: WorkItemService = Depends(get_work_item_service),
):
    try:
        result = await service.sprints(q)
        return (
            TypeAdapter(WorkItemSprintsResponse)
            .validate_python(result)
            .model_dump(by_alias=True)
        )
    except ConnectorError as error:
        return raise_http_error(error)


@router.get("/facets/states", response_model=WorkItemStatesResponse)
async def work_item_states(
    service: WorkItemService = Depends(get_work_item_service),
):
    try:
        return {"states": await service.states()}
    except ConnectorError as error:
        return raise_http_error(error)


@router.get("/{work_item_id}")
async def work_item_detail(
    work_item_id: int,
    service: WorkItemService = Depends(get_work_item_service),
):
    try:
        result = await service.get(work_item_id)
        return (
            TypeAdapter(WorkItemResponse)
            .validate_python(result)
            .model_dump(by_alias=True)
        )
    except ConnectorError as error:
        return raise_http_error(error)
