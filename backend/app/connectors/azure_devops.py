import base64
from typing import Any
from urllib.parse import quote

import httpx

from app.errors import ConnectorError


class AzureDevOpsClient:
    def __init__(
        self,
        organization: str,
        pat: str,
        api_version: str = "7.1",
        timeout: float = 15,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.organization = organization.strip().strip("/")
        self.api_version = api_version
        self.timeout = timeout
        token = base64.b64encode(f":{pat}".encode()).decode("ascii")
        self._headers = {
            "Authorization": f"Basic {token}",
            "Accept": "application/json",
        }
        self._transport = transport
        self._base = f"https://dev.azure.com/{quote(self.organization, safe='')}"

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
    ) -> dict[str, Any]:
        query = {"api-version": self.api_version, **(params or {})}
        try:
            async with httpx.AsyncClient(
                headers=self._headers,
                timeout=self.timeout,
                transport=self._transport,
            ) as client:
                response = await client.request(
                    method,
                    f"{self._base}{path}",
                    params=query,
                    json=json,
                )
        except httpx.TimeoutException as error:
            raise ConnectorError(
                "Azure DevOps did not respond in time.", 504, "ADO_TIMEOUT"
            ) from error
        except httpx.RequestError as error:
            raise ConnectorError(
                "Could not connect to Azure DevOps.", 502, "ADO_UNAVAILABLE"
            ) from error

        if response.status_code == 401:
            raise ConnectorError(
                "The PAT is invalid or expired.", 401, "ADO_UNAUTHORIZED"
            )
        if response.status_code == 403:
            raise ConnectorError(
                "The PAT does not have sufficient Azure DevOps permissions.",
                403,
                "ADO_FORBIDDEN",
            )
        if response.status_code == 404:
            raise ConnectorError(
                "The requested Azure DevOps resource was not found.",
                404,
                "ADO_NOT_FOUND",
            )
        if response.status_code == 429:
            raise ConnectorError(
                "Azure DevOps is rate limiting requests. Try again shortly.",
                429,
                "ADO_RATE_LIMITED",
            )
        if response.is_error:
            raise ConnectorError(
                f"Azure DevOps request failed ({response.status_code}).",
                502,
                "ADO_UPSTREAM_ERROR",
            )
        if response.status_code == 204 or not response.content:
            return {}
        try:
            payload = response.json()
        except ValueError as error:
            raise ConnectorError(
                "Azure DevOps returned an invalid response.", 502, "ADO_BAD_RESPONSE"
            ) from error
        if not isinstance(payload, dict):
            raise ConnectorError(
                "Azure DevOps returned an invalid response.", 502, "ADO_BAD_RESPONSE"
            )
        return payload

    async def test_connection(self) -> dict[str, Any]:
        return await self._request("GET", "/_apis/projects", params={"$top": 1})

    async def list_projects(self) -> list[dict[str, str]]:
        payload = await self._request(
            "GET", "/_apis/projects", params={"$top": 1000, "stateFilter": "wellFormed"}
        )
        return [
            {"id": str(item["id"]), "name": str(item["name"])}
            for item in payload.get("value", [])
            if isinstance(item, dict) and item.get("id") and item.get("name")
        ]

    async def list_teams(self, project_id: str) -> list[dict[str, str]]:
        payload = await self._request(
            "GET",
            f"/_apis/projects/{quote(project_id, safe='')}/teams",
            params={"$top": 1000},
        )
        return [
            {"id": str(item["id"]), "name": str(item["name"])}
            for item in payload.get("value", [])
            if isinstance(item, dict) and item.get("id") and item.get("name")
        ]

    async def list_team_iterations(
        self, project_id: str, team_id: str
    ) -> list[dict[str, Any]]:
        project = quote(project_id, safe="")
        team = quote(team_id, safe="")
        payload = await self._request(
            "GET",
            f"/{project}/{team}/_apis/work/teamsettings/iterations",
        )
        return [
            item
            for item in payload.get("values", payload.get("value", []))
            if isinstance(item, dict)
        ]

    async def query_work_item_ids(self, project_name: str, query: str) -> list[int]:
        payload = await self._request(
            "POST",
            f"/{quote(project_name, safe='')}/_apis/wit/wiql",
            json={"query": query},
        )
        ids = [
            item.get("id")
            for item in payload.get("workItems", [])
            if isinstance(item, dict)
        ]
        return [
            int(work_item_id) for work_item_id in ids if isinstance(work_item_id, int)
        ]

    async def get_work_items(self, ids: list[int]) -> list[dict[str, Any]]:
        if not ids:
            return []
        payload = await self._request(
            "POST",
            "/_apis/wit/workitemsbatch",
            json={
                "ids": ids,
                "fields": [
                    "System.Id",
                    "System.Title",
                    "System.Description",
                    "System.WorkItemType",
                    "System.State",
                    "System.AssignedTo",
                    "System.IterationPath",
                    "System.ChangedDate",
                    "Microsoft.VSTS.Common.Priority",
                    "Microsoft.VSTS.Common.AcceptanceCriteria",
                ],
            },
        )
        return [item for item in payload.get("value", []) if isinstance(item, dict)]
