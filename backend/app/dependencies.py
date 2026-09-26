from app.config import Settings, get_settings
from app.connectors.azure_devops import AzureDevOpsClient
from app.db import ConnectionStore
from app.errors import ConnectorError
from app.services.connections import ConnectionService
from app.services.work_items import WorkItemService


def get_connection_service(
    settings: Settings | None = None,
    store: ConnectionStore | None = None,
) -> ConnectionService:
    active_settings = settings or get_settings()
    active_store = store or ConnectionStore(active_settings.sqlite_path)
    return ConnectionService(
        active_settings,
        active_store,
        client_factory=lambda organization, pat, **kwargs: get_ado_client(
            organization, pat, active_settings, kwargs.get("transport")
        ),
    )


def get_work_item_service() -> WorkItemService:
    connection_service = get_connection_service()
    try:
        record, client = connection_service.active()
    except ConnectorError as error:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=error.status_code,
            detail={
                "message": error.message,
                "code": error.code,
                "status": error.status_code,
            },
        ) from error
    return WorkItemService(
        client,
        record["project_id"],
        record["project_name"],
        record["team_id"],
    )


def get_connection_service_dependency() -> ConnectionService:
    return get_connection_service()


def get_ado_client(
    organization: str,
    pat: str,
    settings: Settings | None = None,
    transport=None,
) -> AzureDevOpsClient:
    active_settings = settings or get_settings()
    return AzureDevOpsClient(
        organization,
        pat,
        api_version=active_settings.ado_api_version,
        timeout=active_settings.ado_request_timeout_seconds,
        transport=transport,
    )


def create_ado_client(
    organization: str,
    pat: str,
    settings: Settings | None = None,
    transport=None,
) -> AzureDevOpsClient:
    return get_ado_client(organization, pat, settings, transport)
