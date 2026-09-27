from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from app.errors import PlanError
from app.planning.models import (
    Plan,
    PlanAnalysis,
    PlanAnswer,
    PlanClarificationRound,
    PlanMessage,
    PlanQuestion,
    PlanSection,
    PlanSource,
    PlanVersionRequest,
    PlanWorkItem,
    SavePlanRequest,
    SubmitClarificationsRequest,
)
from app.planning.store import PlanStore


def _message(
    role: Literal["user", "agent"], content: str, now: datetime
) -> PlanMessage:
    return PlanMessage(id=str(uuid4()), role=role, content=content, createdAt=now)


class PlanService:
    def __init__(self, store: PlanStore) -> None:
        self.store = store

    def list(self) -> list[Plan]:
        return self.store.list()

    def get(self, plan_id: str) -> Plan:
        plan = self.store.get(plan_id)
        if plan is None:
            raise PlanError("Plan not found.", 404, "PLAN_NOT_FOUND")
        return plan

    def create_from_story(
        self,
        work_item: dict,
        source: PlanSource,
        questions: list[PlanQuestion],
        *,
        enqueue_analysis: bool = False,
    ) -> Plan:
        source = source.model_copy(
            update={"organization": source.organization.casefold()}
        )
        snapshot = PlanWorkItem.model_validate(work_item)
        existing = self.store.find_by_source(
            source.organization, source.projectId, snapshot.id
        )
        if existing:
            return existing

        now = datetime.now(UTC)
        plan = Plan(
            id=str(uuid4()),
            workItemId=snapshot.id,
            source=source,
            workItem=snapshot,
            status="clarifying",
            clarificationRounds=[
                PlanClarificationRound(
                    id=str(uuid4()),
                    questions=questions,
                    answers=[],
                    createdAt=now,
                    submittedAt=None,
                )
            ]
            if questions
            else [],
            conversation=[
                _message(
                    "agent",
                    "I reviewed the work item. Please answer the clarification "
                    "questions before drafting.",
                    now,
                )
            ]
            if questions
            else [],
            functionalPlan=[],
            technicalPlan=[],
            revision=0,
            revisionHistory=[],
            version=1,
            createdAt=now,
            updatedAt=now,
            finalizedAt=None,
        )
        if self.store.create(plan, enqueue_analysis=enqueue_analysis):
            return plan
        existing = self.store.find_by_source(
            source.organization, source.projectId, snapshot.id
        )
        if existing is None:
            raise PlanError(
                "Could not save this plan. Try again.", 409, "PLAN_CREATE_CONFLICT"
            )
        return existing

    def submit_clarifications(
        self, plan_id: str, request: SubmitClarificationsRequest
    ) -> Plan:
        plan = self.get(plan_id)
        round_index = next(
            (
                i
                for i, item in enumerate(plan.clarificationRounds)
                if item.id == request.roundId
            ),
            None,
        )
        if plan.status != "clarifying" or round_index is None:
            raise PlanError(
                "This plan is not accepting answers.", 409, "PLAN_NOT_CLARIFYING"
            )
        round_ = plan.clarificationRounds[round_index]
        question_ids = [question.id for question in round_.questions]
        answer_ids = [answer.questionId for answer in request.answers]
        if len(answer_ids) != len(question_ids) or set(answer_ids) != set(question_ids):
            raise PlanError("Answer every question once.", 422, "INVALID_PLAN_ANSWERS")
        answers = [
            answer.model_copy(
                update={"value": "" if answer.unknown else answer.value.strip()}
            )
            for answer in request.answers
        ]
        if round_.submittedAt is not None:
            if round_.answers == answers:
                return plan
            raise PlanError("This round was already submitted.", 409, "ROUND_SUBMITTED")
        self._check_version(plan, request.expectedVersion)
        if round_index != len(plan.clarificationRounds) - 1:
            raise PlanError(
                "This round is no longer current.", 409, "ROUND_NOT_CURRENT"
            )
        now = datetime.now(UTC)
        rounds = list(plan.clarificationRounds)
        rounds[round_index] = round_.model_copy(
            update={"answers": answers, "submittedAt": now}
        )
        updated = plan.model_copy(
            update={
                "clarificationRounds": rounds,
                "conversation": [
                    *plan.conversation,
                    PlanMessage(
                        id=f"user-{round_.id}",
                        role="user",
                        content="\n".join(
                            f"{answer.questionId}: "
                            f"{'I don’t know' if answer.unknown else answer.value}"
                            for answer in answers
                        ),
                        createdAt=now,
                    ),
                ],
                "updatedAt": now,
                "version": plan.version + 1,
            }
        )
        if not self.store.submit_answers(updated, plan.version, round_.id):
            self._check_version(self.get(plan_id), plan.version)
            raise PlanError("Plan not found.", 404, "PLAN_NOT_FOUND")
        return updated

    def project_graph(self, plan_id: str, run_id: str, state: dict) -> Plan:
        plan = self.get(plan_id)
        now = datetime.now(UTC)
        round_data = state.get("current_round")
        rounds = list(plan.clarificationRounds)
        conversation = list(plan.conversation)
        if round_data and not any(item.id == round_data["id"] for item in rounds):
            rounds.append(
                PlanClarificationRound(
                    id=round_data["id"],
                    questions=[
                        PlanQuestion.model_validate(question)
                        for question in round_data["questions"]
                    ],
                    answers=[],
                    createdAt=now,
                    submittedAt=None,
                )
            )
            answer_history = state.get("answer_history", [])
            if answer_history:
                previous = answer_history[-1]
                rounds = [
                    item.model_copy(
                        update={
                            "answers": [
                                PlanAnswer.model_validate(answer)
                                for answer in previous["answers"]
                            ],
                            "submittedAt": item.submittedAt or now,
                        }
                    )
                    if item.id == previous["roundId"]
                    else item
                    for item in rounds
                ]
                user_message_id = f"user-{previous['roundId']}"
                if not any(message.id == user_message_id for message in conversation):
                    conversation.append(
                        PlanMessage(
                            id=user_message_id,
                            role="user",
                            content="\n".join(
                                "{}: {}".format(
                                    answer["questionId"],
                                    "I don’t know"
                                    if answer["unknown"]
                                    else answer["value"],
                                )
                                for answer in previous["answers"]
                            ),
                            createdAt=now,
                        )
                    )
            conversation.append(
                PlanMessage(
                    id=f"agent-{round_data['id']}",
                    role="agent",
                    content="I reviewed the story. Please answer these questions "
                    "so I can prepare a useful plan.",
                    createdAt=now,
                )
            )
        elif not round_data:
            message_id = f"agent-ready-{len(rounds)}"
            if not any(message.id == message_id for message in conversation):
                conversation.append(
                    PlanMessage(
                        id=message_id,
                        role="agent",
                        content="I have enough context to prepare a provisional draft.",
                        createdAt=now,
                    )
                )
        updated = plan.model_copy(
            update={
                "analysis": PlanAnalysis.model_validate(state["analysis"]),
                "clarificationRounds": rounds,
                "conversation": conversation,
                "updatedAt": now,
                "version": plan.version + 1,
            }
        )
        status = "awaiting_input" if round_data else "ready_for_draft"
        if not self.store.finish_run(updated, plan.version, run_id, status):
            raise PlanError(
                "Plan changed during analysis.", 409, "PLAN_VERSION_CONFLICT"
            )
        return updated

    @staticmethod
    def _check_version(plan: Plan, expected_version: int) -> None:
        if plan.version != expected_version:
            raise PlanError(
                "This plan changed since it was opened. Reload and try again.",
                409,
                "PLAN_VERSION_CONFLICT",
            )

    def _persist(self, plan: Plan, previous_version: int) -> Plan:
        if not self.store.replace(plan, previous_version):
            self._check_version(self.get(plan.id), previous_version)
            raise PlanError("Plan not found.", 404, "PLAN_NOT_FOUND")
        return plan

    @staticmethod
    def _validate_sections(current: list[PlanSection], next: list[PlanSection]) -> None:
        if [(s.id, s.title) for s in current] != [(s.id, s.title) for s in next]:
            raise PlanError(
                "Edit existing section content without changing its identity.",
                422,
                "INVALID_PLAN_SECTIONS",
            )

    def save(self, plan_id: str, request: SavePlanRequest) -> Plan:
        plan = self.get(plan_id)
        self._check_version(plan, request.expectedVersion)
        if plan.status != "review":
            raise PlanError(
                "Only provisional plans can be edited.", 409, "PLAN_READ_ONLY"
            )
        if request.workItemId != plan.workItemId:
            raise PlanError(
                "Work item does not match this plan.", 422, "PLAN_ITEM_MISMATCH"
            )
        self._validate_sections(plan.functionalPlan, request.functionalPlan)
        self._validate_sections(plan.technicalPlan, request.technicalPlan)
        history = [
            revision.model_copy(
                update={
                    "functionalPlan": request.functionalPlan,
                    "technicalPlan": request.technicalPlan,
                }
            )
            if revision.revision == plan.revision
            else revision
            for revision in plan.revisionHistory
        ]
        updated = plan.model_copy(
            update={
                "functionalPlan": request.functionalPlan,
                "technicalPlan": request.technicalPlan,
                "revisionHistory": history,
                "updatedAt": datetime.now(UTC),
                "version": plan.version + 1,
            }
        )
        return self._persist(updated, plan.version)

    def finalize(self, plan_id: str, request: PlanVersionRequest) -> Plan:
        plan = self.get(plan_id)
        self._check_version(plan, request.expectedVersion)
        if plan.status != "review":
            raise PlanError(
                "Only reviewed plans can be finalized.", 409, "PLAN_NOT_REVIEWABLE"
            )
        if (
            plan.revision < 1
            or not any(
                revision.revision == plan.revision for revision in plan.revisionHistory
            )
            or not plan.functionalPlan
            or not plan.technicalPlan
            or any(
                not section.content.strip()
                for section in [*plan.functionalPlan, *plan.technicalPlan]
            )
            or any(round_.submittedAt is None for round_ in plan.clarificationRounds)
        ):
            raise PlanError(
                "Complete the questions and review both plans before finalizing.",
                409,
                "PLAN_INCOMPLETE",
            )
        now = datetime.now(UTC)
        updated = plan.model_copy(
            update={
                "status": "finalized",
                "finalizedAt": now,
                "updatedAt": now,
                "version": plan.version + 1,
                "conversation": [
                    *plan.conversation,
                    _message("user", "Approved and finalized the plan.", now),
                    _message(
                        "agent", f"Plan finalized at revision {plan.revision}.", now
                    ),
                ],
            }
        )
        return self._persist(updated, plan.version)

    def reopen(self, plan_id: str, request: PlanVersionRequest) -> Plan:
        plan = self.get(plan_id)
        self._check_version(plan, request.expectedVersion)
        if plan.status != "finalized":
            raise PlanError(
                "Only finalized plans can be reopened.", 409, "PLAN_NOT_FINALIZED"
            )
        now = datetime.now(UTC)
        updated = plan.model_copy(
            update={
                "status": "review",
                "finalizedAt": None,
                "updatedAt": now,
                "version": plan.version + 1,
                "conversation": [
                    *plan.conversation,
                    _message("user", "Reopened the plan for revision.", now),
                    _message("agent", "The plan is open for review again.", now),
                ],
            }
        )
        return self._persist(updated, plan.version)

    def delete(self, plan_id: str) -> None:
        if not self.store.delete(plan_id):
            raise PlanError("Plan not found.", 404, "PLAN_NOT_FOUND")
