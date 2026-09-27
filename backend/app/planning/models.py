from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.codebase.models import RepositoryContext
from app.schemas import WorkItemResponse


class PlanSource(BaseModel):
    organization: str = Field(min_length=1)
    projectId: str = Field(min_length=1)


class PlanWorkItem(WorkItemResponse):
    description: str = ""
    acceptanceCriteria: str = ""
    updatedAt: datetime

    @field_validator("description", "acceptanceCriteria", mode="before")
    @classmethod
    def normalize_empty_text(cls, value: str | None) -> str:
        return value or ""


class PlanSection(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    content: str


class PlanQuestion(BaseModel):
    id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    rationale: str


class PlanAnswer(BaseModel):
    questionId: str = Field(min_length=1)
    value: str
    unknown: bool

    @model_validator(mode="after")
    def answer_or_unknown(self) -> "PlanAnswer":
        if not self.unknown and not self.value.strip():
            raise ValueError("Provide an answer or mark it unknown")
        return self


class PlanClarificationRound(BaseModel):
    id: str
    questions: list[PlanQuestion]
    answers: list[PlanAnswer]
    createdAt: datetime
    submittedAt: datetime | None


class PlanMessage(BaseModel):
    id: str
    role: Literal["user", "agent"]
    content: str
    createdAt: datetime


class PlanRevision(BaseModel):
    revision: int = Field(ge=1)
    feedback: str
    functionalPlan: list[PlanSection]
    technicalPlan: list[PlanSection]
    createdAt: datetime


class PlanFact(BaseModel):
    statement: str
    source: Literal["title", "description", "acceptanceCriteria"]


class PlanAnalysisQuestion(BaseModel):
    prompt: str
    rationale: str


class PlanAnalysis(BaseModel):
    goal: str
    facts: list[PlanFact]
    gaps: list[str]
    assumptions: list[str]
    questions: list[PlanAnalysisQuestion]


class Plan(BaseModel):
    id: str
    workItemId: int = Field(gt=0)
    source: PlanSource
    workItem: PlanWorkItem
    analysis: PlanAnalysis | None = None
    repositoryContext: RepositoryContext | None = None
    status: Literal["clarifying", "review", "finalized"]
    clarificationRounds: list[PlanClarificationRound]
    conversation: list[PlanMessage]
    functionalPlan: list[PlanSection]
    technicalPlan: list[PlanSection]
    revision: int = Field(ge=0)
    revisionHistory: list[PlanRevision]
    version: int = Field(ge=1)
    createdAt: datetime
    updatedAt: datetime
    finalizedAt: datetime | None

    @model_validator(mode="after")
    def validate_identity(self) -> "Plan":
        if self.workItem.id != self.workItemId:
            raise ValueError("Plan work item does not match its snapshot")
        return self


class SavePlanRequest(BaseModel):
    workItemId: int = Field(gt=0)
    expectedVersion: int = Field(ge=1)
    functionalPlan: list[PlanSection]
    technicalPlan: list[PlanSection]


class PlanVersionRequest(BaseModel):
    expectedVersion: int = Field(ge=1)


class PlanRevisionRequest(PlanVersionRequest):
    feedback: str = Field(min_length=1, max_length=4000)


class SubmitClarificationsRequest(PlanVersionRequest):
    roundId: str = Field(min_length=1)
    answers: list[PlanAnswer]
