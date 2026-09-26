from fastapi import APIRouter, Depends

from app.dependencies import get_connection_service_dependency
from app.errors import ConnectorError, raise_http_error
from app.schemas import (
    AdoResource,
    ConnectionSummary,
    ConnectionTestRequest,
    ProjectSelectionRequest,
    SaveConnectionRequest,
)
from app.services.connections import ConnectionService

router = APIRouter(prefix="/connections/azure-devops", tags=["connections"])


@router.get("", response_model=ConnectionSummary)
def connection_summary(
    service: ConnectionService = Depends(get_connection_service_dependency),
):
    return service.summary()


@router.post("/test")
async def test_connection(
    request: ConnectionTestRequest,
    service: ConnectionService = Depends(get_connection_service_dependency),
):
    try:
        await service.test(request.organization, request.pat.get_secret_value())
    except ConnectorError as error:
        return raise_http_error(error)
    return {"connected": True, "organization": request.organization}


@router.post("/projects", response_model=list[AdoResource])
async def list_projects(
    request: ConnectionTestRequest,
    service: ConnectionService = Depends(get_connection_service_dependency),
):
    try:
        await service.test(request.organization, request.pat.get_secret_value())
        return await service.projects(
            request.organization, request.pat.get_secret_value()
        )
    except ConnectorError as error:
        return raise_http_error(error)


@router.post("/teams", response_model=list[AdoResource])
async def list_teams(
    request: ProjectSelectionRequest,
    service: ConnectionService = Depends(get_connection_service_dependency),
):
    try:
        await service.test(request.organization, request.pat.get_secret_value())
        return await service.teams(
            request.organization,
            request.pat.get_secret_value(),
            request.project_id,
        )
    except ConnectorError as error:
        return raise_http_error(error)


@router.put("", response_model=ConnectionSummary)
async def save_connection(
    request: SaveConnectionRequest,
    service: ConnectionService = Depends(get_connection_service_dependency),
):
    try:
        return await service.save(request)
    except ConnectorError as error:
        return raise_http_error(error)


@router.delete("")
def disconnect(
    service: ConnectionService = Depends(get_connection_service_dependency),
):
    service.disconnect()
    return {"connected": False}
