from fastapi import APIRouter, Depends

from app.dependencies import get_copilot_connection_service
from app.errors import PlanError, raise_http_error
from app.services.copilot_connections import (
    CopilotConnectionService,
    CopilotConnectionSummary,
    CopilotCredentialRequest,
)

router = APIRouter(prefix="/connections/github-copilot", tags=["connections"])


@router.get("", response_model=CopilotConnectionSummary)
def summary(
    service: CopilotConnectionService = Depends(get_copilot_connection_service),
):
    return service.summary()


@router.post("/test")
async def test_connection(
    request: CopilotCredentialRequest,
    service: CopilotConnectionService = Depends(get_copilot_connection_service),
):
    try:
        await service.verify(request.pat.get_secret_value())
        return {"connected": True}
    except PlanError as error:
        return raise_http_error(error)


@router.put("", response_model=CopilotConnectionSummary)
async def save(
    request: CopilotCredentialRequest,
    service: CopilotConnectionService = Depends(get_copilot_connection_service),
):
    try:
        return await service.save(request.pat.get_secret_value())
    except PlanError as error:
        return raise_http_error(error)


@router.delete("")
def disconnect(
    service: CopilotConnectionService = Depends(get_copilot_connection_service),
):
    service.disconnect()
    return {"connected": False}
