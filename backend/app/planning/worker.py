import asyncio
import json
import logging

from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command
from pydantic import ValidationError

from app.codebase.retrieval import RepositoryRetriever
from app.codebase.store import RepositoryStore
from app.config import Settings, get_settings
from app.errors import PlanError
from app.planning.graph import build_clarification_graph
from app.planning.store import PlanStore
from app.providers.copilot import CopilotAnalysisError, CopilotAnalysisProvider
from app.services.copilot_connections import CopilotConnectionService
from app.services.plans import PlanService
from app.services.repositories import RepositoryService

logger = logging.getLogger(__name__)


class PlanningWorker:
    def __init__(
        self, settings: Settings, provider: CopilotAnalysisProvider | None = None
    ) -> None:
        self.settings = settings
        self.store = PlanStore(settings.sqlite_path)
        self.service = PlanService(self.store)
        self.credentials = CopilotConnectionService(settings)
        self.provider = provider or CopilotAnalysisProvider(
            settings.copilot_model,
            settings.copilot_timeout_seconds,
            settings.copilot_home,
        )
        self.retriever = RepositoryRetriever(
            RepositoryStore(settings.sqlite_path),
            max_context_chars=settings.repository_context_chars,
        )
        self.repository_service = RepositoryService(settings)

    async def process_one(self, graph) -> bool:
        job = self.store.claim_next()
        if job is None:
            return False
        try:
            plan = self.service.get(job["plan_id"])
            if job["action"] in {"draft", "revise"}:
                if plan.version != job["base_version"]:
                    raise PlanError(
                        "Plan changed during generation.", 409, "PLAN_VERSION_CONFLICT"
                    )
                feedback = (
                    json.loads(job["input_payload"])["feedback"]
                    if job["action"] == "revise"
                    else None
                )
                generated = await self.provider.generate(
                    plan, self.credentials.active_pat(), feedback=feedback
                )
                self.service.project_generation(plan.id, job, generated)
                return True
            config = {"configurable": {"thread_id": plan.id}}
            snapshot = await graph.aget_state(config)
            values = snapshot.values or {}
            if job["action"] == "analyze":
                if values.get("stage") not in {"awaiting_input", "ready_for_draft"}:
                    graph_input = None
                    if not values:
                        story = plan.workItem.model_dump(mode="json")
                        repository_context = (
                            self.retriever.retrieve(story)
                            if self.repository_service.summary().connected
                            else None
                        )
                        graph_input = {
                            "story": story,
                            "repository_context": repository_context.model_dump(
                                mode="json"
                            )
                            if repository_context
                            else None,
                        }
                    await graph.ainvoke(
                        graph_input,
                        config,
                        durability="sync",
                    )
            else:
                if job["round_id"] not in values.get("completed_round_ids", []):
                    if "await_answer" not in snapshot.next:
                        raise RuntimeError("Checkpoint is not awaiting answers")
                    round_ = next(
                        item
                        for item in plan.clarificationRounds
                        if item.id == job["round_id"]
                    )
                    await graph.ainvoke(
                        Command(
                            resume={
                                "roundId": round_.id,
                                "answers": [
                                    answer.model_dump() for answer in round_.answers
                                ],
                            }
                        ),
                        config,
                        durability="sync",
                    )
                elif values.get("stage") == "assessing_answers":
                    # Resume a follow-up generation that failed after the user
                    # answer had already been recorded in the plan store.
                    await graph.ainvoke(None, config, durability="sync")
            snapshot = await graph.aget_state(config)
            values = snapshot.values or {}
            if values.get("stage") not in {"awaiting_input", "ready_for_draft"}:
                raise RuntimeError("Graph stopped without a clarification checkpoint")
            self.service.project_graph(plan.id, job["id"], values)
        except CopilotAnalysisError as error:
            self.store.fail_run(job["id"], error.code)
            logger.warning("Plan run failed: %s", error.code)
        except PlanError as error:
            self.store.fail_run(job["id"], error.code)
            logger.warning("Plan run failed: %s", error.code)
        except ValidationError as error:
            self.store.fail_run(job["id"], "PLANNER_INVALID_STATE")
            safe_errors = [(item["loc"], item["type"]) for item in error.errors()]
            logger.error("Plan run validation failed: %s", safe_errors)
        except Exception as error:
            self.store.fail_run(job["id"], "PLANNER_RUN_FAILED")
            logger.error(
                "Plan run failed (%s): PLANNER_RUN_FAILED", type(error).__name__
            )
        return True

    async def run(self) -> None:
        self.settings.graph_checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        self.store.interrupt_running()
        async with AsyncSqliteSaver.from_conn_string(
            str(self.settings.graph_checkpoint_path)
        ) as checkpointer:
            checkpointer.serde = JsonPlusSerializer(allowed_msgpack_modules=[])
            graph = build_clarification_graph(
                self.provider, self.credentials, checkpointer
            )
            while True:
                if not await self.process_one(graph):
                    await asyncio.sleep(1)


def main() -> None:
    try:
        asyncio.run(PlanningWorker(get_settings()).run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
