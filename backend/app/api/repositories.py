from fastapi import APIRouter, Depends, Query

from app.codebase.models import (
    RepositoryBrowseResponse,
    RepositoryConnectionSummary,
    RepositoryConnectRequest,
    RepositoryReindexRequest,
)
from app.dependencies import get_repository_service
from app.errors import RepositoryError, raise_http_error
from app.services.repositories import RepositoryService

router = APIRouter(prefix="/connections/repository", tags=["connections"])


@router.get("", response_model=RepositoryConnectionSummary)
def summary(service: RepositoryService = Depends(get_repository_service)):
    return service.summary()


@router.get("/browse", response_model=RepositoryBrowseResponse)
def browse(
    path: str | None = Query(default=None, max_length=2000),
    offset: int = Query(default=0, ge=0, le=10_000),
    service: RepositoryService = Depends(get_repository_service),
):
    try:
        return service.browse(path, offset)
    except RepositoryError as error:
        return raise_http_error(error)


@router.put("", response_model=RepositoryConnectionSummary)
def connect(
    request: RepositoryConnectRequest,
    service: RepositoryService = Depends(get_repository_service),
):
    try:
        return service.connect(request)
    except RepositoryError as error:
        return raise_http_error(error)


@router.post("/index", response_model=RepositoryConnectionSummary)
def reindex(
    request: RepositoryReindexRequest,
    service: RepositoryService = Depends(get_repository_service),
):
    try:
        return service.reindex(include_uncommitted=request.includeUncommitted)
    except RepositoryError as error:
        return raise_http_error(error)


@router.delete("")
def disconnect(service: RepositoryService = Depends(get_repository_service)):
    service.disconnect()
    return {"connected": False}
