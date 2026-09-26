import base64
import json
from datetime import UTC, datetime
from typing import Any

from app.connectors.azure_devops import AzureDevOpsClient
from app.errors import ConnectorError

ITEM_FIELDS = [
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
]


def _literal(value: str) -> str:
    return value.replace("'", "''")


def _wiql_search(value: str) -> str:
    escaped = value.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")
    return _literal(escaped)


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        offset = payload.get("offset")
        if isinstance(offset, int) and offset >= 0:
            return offset
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    return 0


def _encode_cursor(offset: int) -> str:
    payload = json.dumps({"offset": offset}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _identity(value: Any) -> tuple[str | None, str | None]:
    if not isinstance(value, dict):
        if isinstance(value, str):
            return value, value
        return None, None
    label = value.get("displayName") or value.get("uniqueName")
    identity_id = value.get("uniqueName") or value.get("id") or value.get("descriptor")
    return (str(label) if label else None, str(identity_id) if identity_id else None)


def map_work_item(raw: dict[str, Any]) -> dict[str, Any]:
    fields = raw.get("fields", {})
    assigned_to, assigned_to_id = _identity(fields.get("System.AssignedTo"))
    changed_at = fields.get("System.ChangedDate") or datetime.now(UTC).isoformat()
    parsed_changed_at = datetime.fromisoformat(changed_at.replace("Z", "+00:00"))
    if parsed_changed_at.tzinfo is None:
        parsed_changed_at = parsed_changed_at.replace(tzinfo=UTC)
    updated_at = parsed_changed_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    priority_raw = fields.get("Microsoft.VSTS.Common.Priority", 2)
    priority = max(1, min(int(priority_raw) if str(priority_raw).isdigit() else 2, 4))
    raw_type = str(fields.get("System.WorkItemType") or "User Story")
    type_label = (
        raw_type if raw_type in {"User Story", "Bug"} else f"{raw_type} · Other"
    )
    description = fields.get("System.Description")
    acceptance = fields.get("Microsoft.VSTS.Common.AcceptanceCriteria")
    title = str(fields.get("System.Title") or f"Work item #{raw.get('id')}")
    return {
        "id": int(raw["id"]),
        "title": title,
        "summary": title,
        "description": str(description) if description else None,
        "acceptanceCriteria": str(acceptance) if acceptance else None,
        "type": type_label,
        "state": str(fields.get("System.State") or "New"),
        "priority": priority,
        "assignedTo": assigned_to,
        "assignedToId": assigned_to_id,
        "sprintId": str(fields.get("System.IterationPath") or "unassigned"),
        "sprintName": str(fields.get("System.IterationPath") or "Unassigned"),
        "iterationPath": str(fields.get("System.IterationPath") or ""),
        "updatedAt": updated_at,
    }


class WorkItemService:
    def __init__(
        self,
        client: AzureDevOpsClient,
        project_id: str,
        project_name: str,
        team_id: str,
    ) -> None:
        self.client = client
        self.project_id = project_id
        self.project_name = project_name
        self.team_id = team_id

    async def team_iterations(self) -> list[dict[str, Any]]:
        return await self.client.list_team_iterations(self.project_id, self.team_id)

    def _base_clauses(self) -> list[str]:
        return [f"[System.TeamProject] = '{_literal(self.project_name)}'"]

    async def states(self) -> list[str]:
        items = await self._query_items()
        return sorted({item["state"] for item in items}, key=str.casefold)

    async def _query_items(
        self,
        *,
        search: str = "",
        item_type: str | None = None,
        state: str | None = None,
        assignee: str | None = None,
        sprint: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses = self._base_clauses()
        if item_type:
            if item_type == "bug":
                clauses.append("[System.WorkItemType] = 'Bug'")
            elif item_type == "story":
                clauses.append("[System.WorkItemType] = 'User Story'")
            elif item_type == "other":
                clauses.append("[System.WorkItemType] NOT IN ('Bug', 'User Story')")
        if state:
            clauses.append(f"[System.State] = '{_literal(state)}'")
        if assignee:
            clauses.append(f"[System.AssignedTo] = '{_literal(assignee)}'")
        if sprint:
            clauses.append(f"[System.IterationPath] = '{_literal(sprint)}'")
        if search.strip():
            clauses.append(f"[System.Title] CONTAINS '{_wiql_search(search.strip())}'")
        wiql = (
            "SELECT [System.Id] FROM WorkItems WHERE "
            + " AND ".join(clauses)
            + " ORDER BY [System.ChangedDate] DESC"
        )
        ids = await self.client.query_work_item_ids(self.project_name, wiql)
        items: list[dict[str, Any]] = []
        for start in range(0, len(ids), 200):
            batch = await self.client.get_work_items(ids[start : start + 200])
            items.extend(map_work_item(item) for item in batch)
        return items

    async def list(
        self,
        *,
        search: str = "",
        item_type: str | None = None,
        state: str | None = None,
        assignee: str | None = None,
        sprint: str | None = None,
        limit: int = 10,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        if not 1 <= limit <= 100:
            raise ConnectorError(
                "Page size must be between 1 and 100.", 422, "INVALID_LIMIT"
            )
        all_items = await self._query_items(
            search=search,
            item_type=item_type,
            state=state,
            assignee=assignee,
            sprint=sprint,
        )
        offset = min(_decode_cursor(cursor), len(all_items))
        page_items = all_items[offset : offset + limit]
        next_offset = offset + len(page_items)
        previous_offset = max(offset - limit, 0)
        return {
            "items": page_items,
            "total": len(all_items),
            "nextCursor": _encode_cursor(next_offset)
            if next_offset < len(all_items)
            else None,
            "previousCursor": _encode_cursor(previous_offset) if offset > 0 else None,
            "hasMore": next_offset < len(all_items),
        }

    async def get(self, work_item_id: int) -> dict[str, Any]:
        items = await self.client.get_work_items([work_item_id])
        if not items:
            raise ConnectorError("Work item not found.", 404, "WORK_ITEM_NOT_FOUND")
        return map_work_item(items[0])

    async def assignees(self, search: str = "") -> dict[str, Any]:
        items = await self._query_items()
        unique: dict[str, str] = {}
        for item in items:
            label = item["assignedTo"]
            identity_id = item["assignedToId"]
            if label and identity_id:
                unique[identity_id] = label
        query = search.strip().casefold()
        values = [
            {"id": identity_id, "label": label}
            for identity_id, label in unique.items()
            if not query or query in label.casefold()
        ]
        if any(item["assignedTo"] is None for item in items) and (
            not query or query in "unassigned"
        ):
            values.insert(0, {"id": "unassigned", "label": "Unassigned"})
        return {"assignees": values}

    async def sprints(self, search: str = "") -> dict[str, Any]:
        iterations = await self.team_iterations()
        current = [
            item
            for item in iterations
            if (item.get("attributes") or {}).get("timeFrame") == "current"
        ]
        source = iterations if search.strip() else (current or iterations)
        query = search.strip().casefold()
        values = []
        for item in source:
            path = str(item.get("path") or item.get("name") or "")
            name = str(item.get("name") or path.rsplit("\\", 1)[-1])
            if query and query not in f"{name} {path}".casefold():
                continue
            values.append(
                {
                    "id": path,
                    "label": name,
                    "iterationPath": path,
                    "isCurrent": item in current,
                }
            )
        if search.strip() and not values:
            values = []
        return {"sprints": values}
