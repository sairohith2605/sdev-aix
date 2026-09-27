import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.db import initialize_plan_schema
from app.planning.models import Plan


class PlanStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        initialize_plan_schema(database_path)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def get(self, plan_id: str) -> Plan | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT payload FROM plans WHERE id = ?", (plan_id,)
            ).fetchone()
        return Plan.model_validate_json(row["payload"]) if row else None

    def list(self) -> list[Plan]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                "SELECT payload FROM plans ORDER BY updated_at DESC, id DESC"
            ).fetchall()
        return [Plan.model_validate_json(row["payload"]) for row in rows]

    def find_by_source(
        self, organization: str, project_id: str, work_item_id: int
    ) -> Plan | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT payload FROM plans WHERE organization = ? "
                "AND project_id = ? AND work_item_id = ?",
                (organization, project_id, work_item_id),
            ).fetchone()
        return Plan.model_validate_json(row["payload"]) if row else None

    def create(self, plan: Plan, *, enqueue_analysis: bool = False) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    """
                    INSERT INTO plans (
                        id, organization, project_id, work_item_id,
                        status, updated_at, version, payload
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(organization, project_id, work_item_id) DO NOTHING
                    """,
                    (
                        plan.id,
                        plan.source.organization,
                        plan.source.projectId,
                        plan.workItemId,
                        plan.status,
                        plan.updatedAt.isoformat(),
                        plan.version,
                        plan.model_dump_json(),
                    ),
                )
                if cursor.rowcount != 1:
                    return False
                if enqueue_analysis:
                    self._insert_run(connection, plan.id, "analyze", "")
                return True

    @staticmethod
    def _insert_run(
        connection: sqlite3.Connection, plan_id: str, action: str, round_id: str
    ) -> None:
        now = datetime.now(UTC).isoformat()
        connection.execute(
            """
            INSERT INTO plan_runs
                (id, plan_id, action, round_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'queued', ?, ?)
            """,
            (str(uuid4()), plan_id, action, round_id, now, now),
        )

    def replace(self, plan: Plan, expected_version: int) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    """
                    UPDATE plans SET status = ?, updated_at = ?,
                        version = ?, payload = ?
                    WHERE id = ? AND version = ? AND NOT EXISTS (
                        SELECT 1 FROM plan_runs WHERE plan_id = ?
                        AND action IN ('draft', 'revise')
                        AND status IN ('queued', 'running')
                    )
                    """,
                    (
                        plan.status,
                        plan.updatedAt.isoformat(),
                        plan.version,
                        plan.model_dump_json(),
                        plan.id,
                        expected_version,
                        plan.id,
                    ),
                )
                return cursor.rowcount == 1

    def submit_answers(self, plan: Plan, expected_version: int, round_id: str) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    """
                    UPDATE plans SET updated_at = ?, version = ?, payload = ?
                    WHERE id = ? AND version = ?
                    """,
                    (
                        plan.updatedAt.isoformat(),
                        plan.version,
                        plan.model_dump_json(),
                        plan.id,
                        expected_version,
                    ),
                )
                if cursor.rowcount != 1:
                    return False
                self._insert_run(connection, plan.id, "resume", round_id)
                return True

    def latest_run(self, plan_id: str) -> dict | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT * FROM plan_runs WHERE plan_id = ? "
                "ORDER BY created_at DESC, id DESC LIMIT 1",
                (plan_id,),
            ).fetchone()
        return dict(row) if row else None

    def active_generation(self, plan_id: str) -> bool:
        with closing(self.connect()) as connection:
            return (
                connection.execute(
                    "SELECT 1 FROM plan_runs WHERE plan_id = ? "
                    "AND action IN ('draft', 'revise') "
                    "AND status IN ('queued', 'running') LIMIT 1",
                    (plan_id,),
                ).fetchone()
                is not None
            )

    def enqueue_generation(
        self, plan_id: str, expected_version: int, action: str, feedback: str = ""
    ) -> dict | None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                active = connection.execute(
                    "SELECT * FROM plan_runs WHERE plan_id = ? "
                    "AND action IN ('draft', 'revise') "
                    "AND status IN ('queued', 'running') LIMIT 1",
                    (plan_id,),
                ).fetchone()
                if active:
                    if (
                        active["action"] == action
                        and active["base_version"] == expected_version
                        and json.loads(active["input_payload"]).get("feedback", "")
                        == feedback
                    ):
                        return dict(active)
                    return None
                row = connection.execute(
                    "SELECT version, payload FROM plans WHERE id = ?", (plan_id,)
                ).fetchone()
                if not row or row["version"] != expected_version:
                    return None
                plan = Plan.model_validate_json(row["payload"])
                latest = connection.execute(
                    "SELECT action, status FROM plan_runs WHERE plan_id = ? "
                    "ORDER BY created_at DESC, id DESC LIMIT 1",
                    (plan_id,),
                ).fetchone()
                if action == "draft":
                    if (
                        plan.status != "clarifying"
                        or plan.revision != 0
                        or any(
                            round_.submittedAt is None
                            for round_ in plan.clarificationRounds
                        )
                        or not latest
                        or latest["status"] != "ready_for_draft"
                    ):
                        return None
                    if connection.execute(
                        "SELECT 1 FROM plan_runs WHERE plan_id = ? "
                        "AND action = 'draft' LIMIT 1",
                        (plan_id,),
                    ).fetchone():
                        return None
                elif action == "revise":
                    if plan.status != "review" or not feedback.strip():
                        return None
                else:
                    return None
                run_id = str(uuid4())
                now = datetime.now(UTC).isoformat()
                connection.execute(
                    """INSERT INTO plan_runs
                       (id, plan_id, action, round_id, status, created_at, updated_at,
                        base_version, input_payload)
                       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)""",
                    (
                        run_id,
                        plan_id,
                        action,
                        "" if action == "draft" else run_id,
                        now,
                        now,
                        expected_version,
                        json.dumps({"feedback": feedback}),
                    ),
                )
                return dict(
                    connection.execute(
                        "SELECT * FROM plan_runs WHERE id = ?", (run_id,)
                    ).fetchone()
                )

    def interrupt_running(self) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute(
                    "UPDATE plan_runs SET status = 'failed', "
                    "error_code = 'RUN_INTERRUPTED' WHERE status = 'running'"
                )

    def claim_next(self) -> dict | None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT * FROM plan_runs WHERE status = 'queued' "
                    "ORDER BY created_at, id LIMIT 1"
                ).fetchone()
                if row is None:
                    return None
                connection.execute(
                    "UPDATE plan_runs SET status = 'running', updated_at = ? "
                    "WHERE id = ?",
                    (datetime.now(UTC).isoformat(), row["id"]),
                )
        return dict(row)

    def fail_run(self, run_id: str, code: str) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute(
                    "UPDATE plan_runs SET status = 'failed', error_code = ?, "
                    "updated_at = ? WHERE id = ? AND status = 'running'",
                    (code, datetime.now(UTC).isoformat(), run_id),
                )

    def retry_run(self, plan_id: str) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT id, status, base_version FROM plan_runs WHERE plan_id = ? "
                    "ORDER BY created_at DESC, id DESC LIMIT 1",
                    (plan_id,),
                ).fetchone()
                if row is None or row["status"] != "failed":
                    return False
                if row["base_version"] is not None:
                    current = connection.execute(
                        "SELECT version FROM plans WHERE id = ?", (plan_id,)
                    ).fetchone()
                    if not current or current["version"] != row["base_version"]:
                        return False
                    if connection.execute(
                        "SELECT 1 FROM plan_runs WHERE plan_id = ? "
                        "AND status IN ('queued', 'running') LIMIT 1",
                        (plan_id,),
                    ).fetchone():
                        return False
                return (
                    connection.execute(
                        "UPDATE plan_runs SET status = 'queued', error_code = NULL, "
                        "updated_at = ? WHERE id = ? AND status = 'failed'",
                        (datetime.now(UTC).isoformat(), row["id"]),
                    ).rowcount
                    == 1
                )

    def finish_run(
        self, plan: Plan, previous_version: int, run_id: str, status: str
    ) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    "UPDATE plans SET updated_at = ?, version = ?, payload = ? "
                    "WHERE id = ? AND version = ?",
                    (
                        plan.updatedAt.isoformat(),
                        plan.version,
                        plan.model_dump_json(),
                        plan.id,
                        previous_version,
                    ),
                )
                if cursor.rowcount != 1:
                    return False
                if (
                    connection.execute(
                        "UPDATE plan_runs SET status = ?, updated_at = ? "
                        "WHERE id = ? AND status = 'running'",
                        (status, datetime.now(UTC).isoformat(), run_id),
                    ).rowcount
                    != 1
                ):
                    raise RuntimeError("Plan run was not active")
                return True

    def finish_generation(self, plan: Plan, previous_version: int, run_id: str) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    """UPDATE plans SET status = ?, updated_at = ?,
                           version = ?, payload = ?
                       WHERE id = ? AND version = ? AND EXISTS (
                           SELECT 1 FROM plan_runs WHERE id = ? AND plan_id = ?
                           AND base_version = ? AND status = 'running'
                       )""",
                    (
                        plan.status,
                        plan.updatedAt.isoformat(),
                        plan.version,
                        plan.model_dump_json(),
                        plan.id,
                        previous_version,
                        run_id,
                        plan.id,
                        previous_version,
                    ),
                )
                if cursor.rowcount != 1:
                    return False
                if (
                    connection.execute(
                        "UPDATE plan_runs SET status = 'completed', updated_at = ? "
                        "WHERE id = ? AND status = 'running'",
                        (datetime.now(UTC).isoformat(), run_id),
                    ).rowcount
                    != 1
                ):
                    raise RuntimeError("Generation run was not active")
                return True

    def delete(self, plan_id: str) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    "DELETE FROM plans WHERE id = ?", (plan_id,)
                )
                return cursor.rowcount == 1
