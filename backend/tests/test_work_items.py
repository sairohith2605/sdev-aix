import json

import httpx
import pytest

from app.connectors.azure_devops import AzureDevOpsClient
from app.services.work_items import WorkItemService


def test_map_work_item_matches_existing_frontend_shape():
    from app.services.work_items import map_work_item

    result = map_work_item(
        {
            "id": 42,
            "fields": {
                "System.Title": "Add secure sign-in",
                "System.WorkItemType": "User Story",
                "System.State": "Active",
                "System.AssignedTo": {"id": "u-1", "displayName": "Avery Chen"},
                "System.IterationPath": "Product\\Client Team\\Sprint 4",
                "System.ChangedDate": "2026-06-01T10:00:00Z",
                "Microsoft.VSTS.Common.Priority": 1,
                "System.Description": "A formatted description.",
                "Microsoft.VSTS.Common.AcceptanceCriteria": "- It works",
            },
        }
    )
    assert result == {
        "id": 42,
        "title": "Add secure sign-in",
        "summary": "Add secure sign-in",
        "description": "A formatted description.",
        "acceptanceCriteria": "- It works",
        "type": "User Story",
        "state": "Active",
        "priority": 1,
        "assignedTo": "Avery Chen",
        "assignedToId": "u-1",
        "sprintId": "Product\\Client Team\\Sprint 4",
        "sprintName": "Product\\Client Team\\Sprint 4",
        "iterationPath": "Product\\Client Team\\Sprint 4",
        "updatedAt": "2026-06-01T10:00:00Z",
    }


def test_work_item_routes_keep_frontend_response_shape(client):
    items = client.get("/api/work-items?limit=1")
    assignees = client.get("/api/work-items/facets/assignees")
    sprints = client.get("/api/work-items/facets/sprints")
    states = client.get("/api/work-items/facets/states")
    detail = client.get("/api/work-items/42")

    assert items.status_code == 200
    assert items.json() == {
        "items": [],
        "total": 0,
        "nextCursor": None,
        "previousCursor": None,
        "hasMore": False,
    }
    assert assignees.json() == {"assignees": []}
    assert sprints.json() == {"sprints": []}
    assert states.json() == {"states": []}
    assert detail.status_code == 404
    assert detail.json()["code"] == "WORK_ITEM_NOT_FOUND"


@pytest.mark.parametrize("client", [False], indirect=True)
def test_work_item_routes_require_a_connection(client):
    response = client.get("/api/work-items")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ADO_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_list_queries_team_project_and_maps_filter_facets():
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith("/_apis/wit/wiql"):
            return httpx.Response(
                200,
                json={
                    "workItems": [{"id": 42}, {"id": 43}],
                },
            )
        if request.url.path.endswith("/_apis/wit/workitemsbatch"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": 42,
                            "fields": {
                                "System.Title": "Add secure sign-in",
                                "System.WorkItemType": "User Story",
                                "System.State": "Active",
                                "System.AssignedTo": {
                                    "id": "u-1",
                                    "displayName": "Avery Chen",
                                },
                                "System.IterationPath": (
                                    "Product\\Client Team\\Sprint 4"
                                ),
                                "System.ChangedDate": "2026-06-01T10:00:00Z",
                                "Microsoft.VSTS.Common.Priority": 1,
                            },
                        },
                        {
                            "id": 43,
                            "fields": {
                                "System.Title": "Unassigned bug",
                                "System.WorkItemType": "Bug",
                                "System.State": "New",
                                "System.IterationPath": (
                                    "Product\\Client Team\\Sprint 3"
                                ),
                                "System.ChangedDate": "2026-05-30T10:00:00Z",
                                "Microsoft.VSTS.Common.Priority": 2,
                            },
                        },
                    ]
                },
            )
        if request.url.path.endswith("/_apis/work/teamsettings/iterations"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "name": "Sprint 3",
                            "path": "Product\\Client Team\\Sprint 3",
                            "attributes": {"timeFrame": "past"},
                        },
                        {
                            "name": "Sprint 4",
                            "path": "Product\\Client Team\\Sprint 4",
                            "attributes": {"timeFrame": "current"},
                        },
                    ]
                },
            )
        return httpx.Response(404, json={"message": "unexpected endpoint"})

    client = AzureDevOpsClient("contoso", "pat", transport=httpx.MockTransport(handler))
    service = WorkItemService(client, "project-id", "Product", "team-id")

    page = await service.list(search="sign-in", limit=1)
    assignees = await service.assignees()
    sprints = await service.sprints()

    assert page["items"][0]["id"] == 42
    assert page["total"] == 2
    assert page["hasMore"] is True
    assert page["nextCursor"]
    assert {entry["label"] for entry in assignees["assignees"]} == {
        "Avery Chen",
        "Unassigned",
    }
    assert sprints["sprints"] == [
        {
            "id": "Product\\Client Team\\Sprint 4",
            "label": "Sprint 4",
            "iterationPath": "Product\\Client Team\\Sprint 4",
            "isCurrent": True,
        }
    ]
    wiql_request = next(
        request for request in calls if request.url.path.endswith("/_apis/wit/wiql")
    )
    wiql = wiql_request.content.decode()
    assert "System.TeamProject] = 'Product'" in wiql
    assert "System.Title] CONTAINS 'sign-in'" in wiql

    batch_request = next(
        request
        for request in calls
        if request.url.path.endswith("/_apis/wit/workitemsbatch")
    )
    batch_body = json.loads(batch_request.content)
    assert "fields" in batch_body
    assert "$expand" not in batch_body
