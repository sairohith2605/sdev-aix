from pathlib import Path

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command

from app.planning.analysis import StoryAnalysis
from app.planning.graph import build_clarification_graph
from app.planning.models import PlanSource, SubmitClarificationsRequest
from app.planning.worker import PlanningWorker
from tests.test_plans import story


class FakeCredentials:
    def active_pat(self) -> str:
        return "private-token"


class FakeAnalysisProvider:
    def __init__(self, questions: list[dict], follow_up: list[dict] | None = None):
        self.questions = questions
        self.follow_up_questions = follow_up or []
        self.calls = 0

    async def analyze(self, story: dict, pat: str) -> StoryAnalysis:
        assert pat == "private-token"
        self.calls += 1
        return StoryAnalysis.model_validate(
            {
                "goal": story["title"],
                "facts": [{"statement": "Title is present", "source": "title"}],
                "gaps": ["Unknown outcome"] if self.follow_up_questions else [],
                "assumptions": [],
                "questions": self.questions,
            }
        )

    async def follow_up(self, story, analysis, answers, pat) -> StoryAnalysis:
        assert pat == "private-token"
        assert answers
        self.calls += 1
        return StoryAnalysis.model_validate(
            {
                "goal": story["title"],
                "facts": [{"statement": "Title is present", "source": "title"}],
                "gaps": [],
                "assumptions": [],
                "questions": self.follow_up_questions,
            }
        )


@pytest.mark.asyncio
async def test_graph_interrupts_and_resumes_from_a_new_checkpointer(tmp_path: Path):
    path = str(tmp_path / "checkpoints.db")
    provider = FakeAnalysisProvider(
        [{"prompt": "Who uses this?", "rationale": "Need the audience"}],
        [{"prompt": "What if unknown?", "rationale": "Need an assumption"}],
    )
    config = {"configurable": {"thread_id": "plan-1"}}
    async with AsyncSqliteSaver.from_conn_string(path) as saver:
        graph = build_clarification_graph(provider, FakeCredentials(), saver)
        await graph.ainvoke(
            {"story": {"id": 42, "title": "View employees"}},
            config,
            durability="sync",
        )
        snapshot = await graph.aget_state(config)
        assert snapshot.values["current_round"]["id"] == "round-1"
        assert "await_answer" in snapshot.next

    async with AsyncSqliteSaver.from_conn_string(path) as saver:
        graph = build_clarification_graph(provider, FakeCredentials(), saver)
        await graph.ainvoke(
            Command(
                resume={
                    "roundId": "round-1",
                    "answers": [{"questionId": "r1-q1", "value": "", "unknown": True}],
                }
            ),
            config,
            durability="sync",
        )
        snapshot = await graph.aget_state(config)
        assert snapshot.values["current_round"]["id"] == "round-2"
        assert snapshot.values["completed_round_ids"] == ["round-1"]
        await graph.ainvoke(
            Command(
                resume={
                    "roundId": "round-2",
                    "answers": [
                        {
                            "questionId": "r2-q1",
                            "value": "Treat as assumption",
                            "unknown": False,
                        }
                    ],
                }
            ),
            config,
            durability="sync",
        )
        snapshot = await graph.aget_state(config)
        assert snapshot.values["stage"] == "ready_for_draft"
        assert provider.calls == 2


@pytest.mark.asyncio
async def test_complete_story_skips_clarifications(tmp_path: Path):
    provider = FakeAnalysisProvider([])
    config = {"configurable": {"thread_id": "plan-2"}}
    async with AsyncSqliteSaver.from_conn_string(
        str(tmp_path / "complete.db")
    ) as saver:
        graph = build_clarification_graph(provider, FakeCredentials(), saver)
        await graph.ainvoke(
            {"story": {"id": 43, "title": "Complete story"}},
            config,
            durability="sync",
        )
        snapshot = await graph.aget_state(config)
        assert snapshot.values["stage"] == "ready_for_draft"
        assert snapshot.next == ()


@pytest.mark.asyncio
async def test_worker_projects_round_and_resumes_after_restart(
    tmp_path: Path, settings
):
    settings = settings.model_copy(
        update={
            "database_url": f"sqlite:///{tmp_path / 'worker.db'}",
            "copilot_data_path": tmp_path / "copilot",
        }
    )
    provider = FakeAnalysisProvider(
        [{"prompt": "Who uses this?", "rationale": "Need the audience"}]
    )
    worker = PlanningWorker(settings, provider=provider)
    worker.credentials = FakeCredentials()
    plan = worker.service.create_from_story(
        story(),
        PlanSource(organization="contoso", projectId="project-1"),
        [],
        enqueue_analysis=True,
    )
    path = str(tmp_path / "graph.db")
    async with AsyncSqliteSaver.from_conn_string(path) as saver:
        graph = build_clarification_graph(provider, worker.credentials, saver)
        assert await worker.process_one(graph)
        assert worker.store.latest_run(plan.id)["status"] == "awaiting_input"
        current = worker.service.get(plan.id)
        assert current.clarificationRounds[0].questions[0].prompt == "Who uses this?"
        worker.service.submit_clarifications(
            plan.id,
            SubmitClarificationsRequest(
                expectedVersion=current.version,
                roundId="round-1",
                answers=[
                    {"questionId": "r1-q1", "value": "HR admins", "unknown": False}
                ],
            ),
        )

    restarted = PlanningWorker(settings, provider=provider)
    restarted.credentials = FakeCredentials()
    async with AsyncSqliteSaver.from_conn_string(path) as saver:
        graph = build_clarification_graph(provider, restarted.credentials, saver)
        assert await restarted.process_one(graph)
    assert restarted.store.latest_run(plan.id)["status"] == "ready_for_draft"
    restored = restarted.service.get(plan.id)
    assert restored.clarificationRounds[0].answers[0].value == "HR admins"
    assert restored.conversation[-1].role == "agent"
    assert provider.calls == 1
