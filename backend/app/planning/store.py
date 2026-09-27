import sqlite3
from contextlib import closing
from pathlib import Path

from app.db import initialize_plan_schema
from app.planning.models import Plan


class PlanStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        initialize_plan_schema(database_path)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
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

    def create(self, plan: Plan) -> bool:
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
                return cursor.rowcount == 1

    def replace(self, plan: Plan, expected_version: int) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    """
                    UPDATE plans SET status = ?, updated_at = ?,
                        version = ?, payload = ?
                    WHERE id = ? AND version = ?
                    """,
                    (
                        plan.status,
                        plan.updatedAt.isoformat(),
                        plan.version,
                        plan.model_dump_json(),
                        plan.id,
                        expected_version,
                    ),
                )
                return cursor.rowcount == 1

    def delete(self, plan_id: str) -> bool:
        with closing(self.connect()) as connection:
            with connection:
                cursor = connection.execute(
                    "DELETE FROM plans WHERE id = ?", (plan_id,)
                )
                return cursor.rowcount == 1
