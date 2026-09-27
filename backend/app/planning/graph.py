from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt


class PlanningState(TypedDict, total=False):
    story: dict[str, Any]
    repository_context: dict[str, Any] | None
    analysis: dict[str, Any]
    current_round: dict[str, Any] | None
    next_questions: list[dict[str, str]]
    completed_round_ids: list[str]
    answer_history: list[dict[str, Any]]
    stage: str


def build_clarification_graph(provider: Any, credentials: Any, checkpointer: Any):
    async def analyze(state: PlanningState) -> dict:
        repository_context = state.get("repository_context")
        if repository_context:
            result = await provider.analyze(
                state["story"],
                credentials.active_pat(),
                repository_context=repository_context,
            )
        else:
            result = await provider.analyze(state["story"], credentials.active_pat())
        return {
            "analysis": result.model_dump(),
            "completed_round_ids": [],
            "answer_history": [],
            "next_questions": [q.model_dump() for q in result.questions],
            "stage": "analyzing",
        }

    def route_questions(state: PlanningState) -> str:
        return "prepare_round" if state.get("next_questions") else "ready"

    def prepare_round(state: PlanningState) -> dict:
        round_number = len(state.get("completed_round_ids", [])) + 1
        questions = [
            {
                "id": f"r{round_number}-q{number}",
                "prompt": question["prompt"],
                "rationale": question["rationale"],
            }
            for number, question in enumerate(state["next_questions"], 1)
        ]
        return {
            "current_round": {"id": f"round-{round_number}", "questions": questions},
            "next_questions": [],
            "stage": "awaiting_input",
        }

    def await_answer(state: PlanningState) -> dict:
        round_ = state["current_round"]
        answer = interrupt(round_)
        if not isinstance(answer, dict) or answer.get("roundId") != round_["id"]:
            raise ValueError("Clarification round does not match the checkpoint")
        return {
            "answer_history": [
                *state.get("answer_history", []),
                {"roundId": round_["id"], "answers": answer["answers"]},
            ],
            "completed_round_ids": [
                *state.get("completed_round_ids", []),
                round_["id"],
            ],
            "current_round": None,
            "stage": "assessing_answers",
        }

    def route_follow_up(state: PlanningState) -> str:
        if len(state["completed_round_ids"]) >= 2:
            return "ready"
        latest = state["answer_history"][-1]["answers"]
        return (
            "follow_up"
            if state["analysis"]["gaps"] or any(answer["unknown"] for answer in latest)
            else "ready"
        )

    async def follow_up(state: PlanningState) -> dict:
        arguments = (
            state["story"],
            state["analysis"],
            state["answer_history"][-1]["answers"],
            credentials.active_pat(),
        )
        repository_context = state.get("repository_context")
        if repository_context:
            result = await provider.follow_up(
                *arguments, repository_context=repository_context
            )
        else:
            result = await provider.follow_up(*arguments)
        return {"next_questions": [q.model_dump() for q in result.questions]}

    def ready(state: PlanningState) -> dict:
        return {"stage": "ready_for_draft", "current_round": None}

    builder = StateGraph(PlanningState)
    builder.add_node("analyze", analyze)
    builder.add_node("prepare_round", prepare_round)
    builder.add_node("await_answer", await_answer)
    builder.add_node("follow_up", follow_up)
    builder.add_node("ready", ready)
    builder.add_edge(START, "analyze")
    builder.add_conditional_edges(
        "analyze", route_questions, ["prepare_round", "ready"]
    )
    builder.add_edge("prepare_round", "await_answer")
    builder.add_conditional_edges(
        "await_answer", route_follow_up, ["follow_up", "ready"]
    )
    builder.add_conditional_edges(
        "follow_up", route_questions, ["prepare_round", "ready"]
    )
    builder.add_edge("ready", END)
    return builder.compile(checkpointer=checkpointer)
