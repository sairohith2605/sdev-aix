import sqlite3
from contextlib import closing
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


def initialize_plan_schema(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database_path, timeout=5)) as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > 7:
            raise RuntimeError("This database requires a newer sdev-aix version")
        if version == 7:
            return
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version > 7:
                raise RuntimeError("This database requires a newer sdev-aix version")
            if version < 1:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS plans (
                        id TEXT PRIMARY KEY,
                        organization TEXT NOT NULL,
                        project_id TEXT NOT NULL,
                        work_item_id INTEGER NOT NULL CHECK (work_item_id > 0),
                        status TEXT NOT NULL CHECK (status IN (
                            'clarifying', 'review', 'finalized'
                        )),
                        updated_at TEXT NOT NULL,
                        version INTEGER NOT NULL CHECK (version > 0),
                        payload TEXT NOT NULL,
                        UNIQUE (organization, project_id, work_item_id)
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS plans_updated_at_idx "
                    "ON plans(updated_at DESC)"
                )
            if version < 2:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS copilot_connection (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        encrypted_pat TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS plan_runs (
                        id TEXT PRIMARY KEY,
                        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                        action TEXT NOT NULL CHECK (action IN ('analyze', 'resume')),
                        round_id TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL CHECK (
                            status IN ('queued', 'running', 'awaiting_input',
                                'ready_for_draft', 'failed')
                        ),
                        error_code TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (plan_id, action, round_id)
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS plan_runs_status_idx "
                    "ON plan_runs(status, created_at)"
                )
            if version < 3:
                connection.execute("PRAGMA user_version = 3")
            if version < 4:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS repository_connection (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        root_path TEXT NOT NULL,
                        name TEXT NOT NULL,
                        branch TEXT,
                        commit_sha TEXT NOT NULL,
                        snapshot_id TEXT NOT NULL,
                        dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
                        indexed_at TEXT NOT NULL,
                        file_count INTEGER NOT NULL CHECK (file_count >= 0),
                        chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0)
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS repository_files (
                        path TEXT PRIMARY KEY,
                        content_hash TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS repository_chunks (
                        id TEXT PRIMARY KEY,
                        path TEXT NOT NULL,
                        language TEXT NOT NULL,
                        symbol TEXT,
                        kind TEXT NOT NULL,
                        start_line INTEGER NOT NULL CHECK (start_line > 0),
                        end_line INTEGER NOT NULL CHECK (end_line > 0),
                        content TEXT NOT NULL,
                        identifiers TEXT NOT NULL,
                        imports TEXT NOT NULL,
                        content_hash TEXT NOT NULL,
                        is_test INTEGER NOT NULL CHECK (is_test IN (0, 1))
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS repository_chunks_path_idx "
                    "ON repository_chunks(path, start_line)"
                )
                connection.execute(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS repository_chunks_fts
                    USING fts5(
                        chunk_id UNINDEXED,
                        path,
                        symbol,
                        identifiers,
                        content,
                        tokenize = 'unicode61 remove_diacritics 2'
                    )
                    """
                )
                connection.execute("PRAGMA user_version = 4")
            if version < 5:
                # The former Compose mount always pointed /repository at this
                # planner's own source, not a user-selected application.
                legacy = connection.execute(
                    "SELECT 1 FROM repository_connection "
                    "WHERE id = 1 AND root_path = '/repository'"
                ).fetchone()
                if legacy:
                    connection.execute("DELETE FROM repository_chunks_fts")
                    connection.execute("DELETE FROM repository_chunks")
                    connection.execute("DELETE FROM repository_files")
                    connection.execute("DELETE FROM repository_connection")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS repository_index_job (
                        id TEXT PRIMARY KEY,
                        path TEXT NOT NULL,
                        include_uncommitted INTEGER NOT NULL,
                        status TEXT NOT NULL CHECK (
                            status IN ('queued', 'running', 'ready', 'failed')
                        ),
                        progress_files INTEGER NOT NULL DEFAULT 0,
                        total_files INTEGER NOT NULL DEFAULT 0,
                        error_code TEXT
                    )
                    """
                )
                connection.execute("PRAGMA user_version = 5")
            if version < 6:
                connection.execute(
                    """
                    CREATE TABLE plan_runs_v6 (
                        id TEXT PRIMARY KEY,
                        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                        action TEXT NOT NULL CHECK (
                            action IN ('analyze', 'resume', 'draft', 'revise')
                        ),
                        round_id TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL CHECK (status IN (
                            'queued', 'running', 'awaiting_input', 'ready_for_draft',
                            'completed', 'failed'
                        )),
                        error_code TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        base_version INTEGER,
                        input_payload TEXT NOT NULL DEFAULT '{}',
                        UNIQUE (plan_id, action, round_id)
                    )
                    """
                )
                connection.execute(
                    """INSERT INTO plan_runs_v6
                       (id, plan_id, action, round_id, status, error_code,
                        created_at, updated_at)
                       SELECT id, plan_id, action, round_id, status, error_code,
                              created_at, updated_at FROM plan_runs"""
                )
                connection.execute("DROP TABLE plan_runs")
                connection.execute("ALTER TABLE plan_runs_v6 RENAME TO plan_runs")
                connection.execute(
                    "CREATE INDEX plan_runs_status_idx ON plan_runs(status, created_at)"
                )
                connection.execute("PRAGMA user_version = 6")
            if version < 7:
                connection.execute(
                    "ALTER TABLE repository_connection ADD COLUMN "
                    "skipped_file_count INTEGER NOT NULL DEFAULT 0"
                )
                connection.execute(
                    "ALTER TABLE repository_connection ADD COLUMN "
                    "index_version INTEGER NOT NULL DEFAULT 1"
                )
                connection.execute("PRAGMA user_version = 7")
