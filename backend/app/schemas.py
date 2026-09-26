from pydantic import BaseModel, Field, SecretStr, field_validator


class ConnectionTestRequest(BaseModel):
    organization: str = Field(min_length=1, max_length=100)
    pat: SecretStr

    @field_validator("organization")
    @classmethod
    def clean_organization(cls, value: str) -> str:
        value = value.strip().strip("/")
        if not value or any(character.isspace() for character in value):
            raise ValueError("Enter a valid Azure DevOps organization name")
        return value

    @field_validator("pat")
    @classmethod
    def validate_pat(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("PAT is required")
        return SecretStr(value.get_secret_value().strip())


class ProjectSelectionRequest(ConnectionTestRequest):
    project_id: str = Field(min_length=1)
    project_name: str = Field(min_length=1)


class SaveConnectionRequest(ProjectSelectionRequest):
    team_id: str = Field(min_length=1)
    team_name: str = Field(min_length=1)


class AdoResource(BaseModel):
    id: str
    name: str


class ConnectionSummary(BaseModel):
    connected: bool
    organization: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    team_id: str | None = None
    team_name: str | None = None
    pat_configured: bool = False


class WorkItemResponse(BaseModel):
    id: int
    title: str
    summary: str
    description: str | None = None
    acceptanceCriteria: str | None = None
    type: str
    state: str
    priority: int
    assignedTo: str | None = None
    assignedToId: str | None = None
    sprintId: str
    sprintName: str
    iterationPath: str
    updatedAt: str


class WorkItemListResponse(BaseModel):
    items: list[WorkItemResponse]
    total: int
    nextCursor: str | None
    previousCursor: str | None
    hasMore: bool


class WorkItemAssignee(BaseModel):
    id: str
    label: str


class WorkItemAssigneesResponse(BaseModel):
    assignees: list[WorkItemAssignee]


class WorkItemSprint(BaseModel):
    id: str
    label: str
    iterationPath: str
    isCurrent: bool


class WorkItemSprintsResponse(BaseModel):
    sprints: list[WorkItemSprint]


class WorkItemStatesResponse(BaseModel):
    states: list[str]
