import sqlite3
from pathlib import Path
from typing import Any


class ConnectionStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS ado_connection (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    organization TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    team_id TEXT NOT NULL,
                    team_name TEXT NOT NULL,
                    encrypted_pat TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def get(self) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM ado_connection WHERE id = 1"
            ).fetchone()
        return dict(row) if row else None

    def save(self, connection_data: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO ado_connection (
                    id, organization, project_id, project_name, team_id,
                    team_name, encrypted_pat, created_at, updated_at
                ) VALUES (1, :organization, :project_id, :project_name, :team_id,
                    :team_name, :encrypted_pat, :created_at, :updated_at)
                ON CONFLICT(id) DO UPDATE SET
                    organization = excluded.organization,
                    project_id = excluded.project_id,
                    project_name = excluded.project_name,
                    team_id = excluded.team_id,
                    team_name = excluded.team_name,
                    encrypted_pat = excluded.encrypted_pat,
                    updated_at = excluded.updated_at
                """,
                connection_data,
            )

    def delete(self) -> None:
        with self.connect() as connection:
            connection.execute("DELETE FROM ado_connection WHERE id = 1")
