import base64

import httpx
import pytest

from app.connectors.azure_devops import AzureDevOpsClient
from app.errors import ConnectorError
from app.services.work_items import WorkItemService, map_work_item


@pytest.mark.asyncio
async def test_pat_is_sent_using_basic_auth_and_connection_test_accepts_org_projects():
    seen_authorization: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_authorization.append(request.headers["authorization"])
        return httpx.Response(200, json={"value": []})

    client = AzureDevOpsClient(
        "example-org",
        "personal-token",
        transport=httpx.MockTransport(handler),
    )

    await client.test_connection()

    assert seen_authorization == [
        "Basic " + base64.b64encode(b":personal-token").decode()
    ]


@pytest.mark.asyncio
async def test_invalid_pat_has_actionable_error():
    client = AzureDevOpsClient(
        "example-org",
        "bad-token",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(401, json={"message": "unauthorized"})
        ),
    )

    with pytest.raises(ConnectorError, match="invalid or expired") as error:
        await client.test_connection()

    assert error.value.status_code == 401
    assert error.value.code == "ADO_UNAUTHORIZED"


def test_work_item_mapping_preserves_ui_schema_and_maps_unknown_state_safely():
    mapped = map_work_item(
        {
            "id": 15,
            "fields": {
                "System.Title": "Implement connector",
                "System.WorkItemType": "Task",
                "System.State": "Committed",
                "System.AssignedTo": {"id": "user-1", "displayName": "Alex"},
                "System.IterationPath": "Project\\Team\\Sprint 3",
                "System.ChangedDate": "2026-06-01T10:00:00Z",
                "Microsoft.VSTS.Common.Priority": 2,
            },
        }
    )

    assert mapped == {
        "id": 15,
        "title": "Implement connector",
        "summary": "Implement connector",
        "description": None,
        "acceptanceCriteria": None,
        "type": "Task · Other",
        "state": "Committed",
        "priority": 2,
        "assignedTo": "Alex",
        "assignedToId": "user-1",
        "sprintId": "Project\\Team\\Sprint 3",
        "sprintName": "Project\\Team\\Sprint 3",
        "iterationPath": "Project\\Team\\Sprint 3",
        "updatedAt": "2026-06-01T10:00:00Z",
    }


@pytest.mark.asyncio
async def test_team_iterations_return_current_window_or_search_results():
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        if request.url.path.endswith("/iterations"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "i1",
                            "name": "Sprint 2",
                            "path": "Project\\Team\\Sprint 2",
                            "attributes": {"timeFrame": "past"},
                        },
                        {
                            "id": "i2",
                            "name": "Sprint 3",
                            "path": "Project\\Team\\Sprint 3",
                            "attributes": {"timeFrame": "current"},
                        },
                    ]
                },
            )
        return httpx.Response(200, json={"workItems": []})

    client = AzureDevOpsClient(
        "example-org", "pat", transport=httpx.MockTransport(handler)
    )
    service = WorkItemService(client, "project-id", "Project", "team-id")

    current = await service.sprints()
    matching = await service.sprints("Sprint 2")

    assert current["sprints"] == [
        {
            "id": "Project\\Team\\Sprint 3",
            "label": "Sprint 3",
            "iterationPath": "Project\\Team\\Sprint 3",
            "isCurrent": True,
        }
    ]
    assert len(matching["sprints"]) == 1
    assert matching["sprints"][0]["isCurrent"] is False
    assert all("team-id" in path for path in requested_paths)
