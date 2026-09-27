import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.codebase.models import IndexedChunk, RepositoryIndex
from app.db import initialize_plan_schema
from app.errors import RepositoryError


class RepositoryStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        initialize_plan_schema(database_path)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def summary(self) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT * FROM repository_connection WHERE id = 1"
            ).fetchone()
        return dict(row) if row else None

    def job(self) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute("SELECT * FROM repository_index_job").fetchone()
        return dict(row) if row else None

    def enqueue(self, path: str, include_uncommitted: bool) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                active = connection.execute(
                    "SELECT 1 FROM repository_index_job "
                    "WHERE status IN ('queued', 'running')"
                ).fetchone()
                if active:
                    raise RepositoryError(
                        "Repository indexing is already in progress.",
                        409,
                        "REPOSITORY_INDEX_IN_PROGRESS",
                    )
                connection.execute("DELETE FROM repository_index_job")
                connection.execute(
                    "INSERT INTO repository_index_job "
                    "(id, path, include_uncommitted, status) "
                    "VALUES (?, ?, ?, 'queued')",
                    (str(uuid4()), path, int(include_uncommitted)),
                )

    def recover(self) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute(
                    "UPDATE repository_index_job SET status = 'queued', "
                    "progress_files = 0, total_files = 0 WHERE status = 'running'"
                )

    def claim(self) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT * FROM repository_index_job WHERE status = 'queued'"
                ).fetchone()
                if row:
                    connection.execute(
                        "UPDATE repository_index_job SET status = 'running' "
                        "WHERE id = ?",
                        (row["id"],),
                    )
        return dict(row) if row else None

    def progress(self, job_id: str, completed: int, total: int) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute(
                    "UPDATE repository_index_job SET progress_files = ?, "
                    "total_files = ? WHERE id = ? AND status = 'running'",
                    (completed, total, job_id),
                )

    def fail(self, job_id: str, code: str) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute(
                    "UPDATE repository_index_job SET status = 'failed', error_code = ? "
                    "WHERE id = ? AND status = 'running'",
                    (code, job_id),
                )

    def ready(self) -> bool:
        job = self.job()
        return job is None or job["status"] == "ready"

    def save_index(self, index: RepositoryIndex, job_id: str | None = None) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                if (
                    job_id
                    and not connection.execute(
                        "SELECT 1 FROM repository_index_job "
                        "WHERE id = ? AND status = 'running'",
                        (job_id,),
                    ).fetchone()
                ):
                    return
                connection.execute("DELETE FROM repository_chunks_fts")
                connection.execute("DELETE FROM repository_chunks")
                connection.execute("DELETE FROM repository_files")
                connection.execute(
                    """
                    INSERT INTO repository_connection (
                        id, root_path, name, branch, commit_sha, snapshot_id,
                        dirty, indexed_at, file_count, chunk_count,
                        skipped_file_count, index_version
                    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                    ON CONFLICT(id) DO UPDATE SET
                        root_path = excluded.root_path,
                        name = excluded.name,
                        branch = excluded.branch,
                        commit_sha = excluded.commit_sha,
                        snapshot_id = excluded.snapshot_id,
                        dirty = excluded.dirty,
                        indexed_at = excluded.indexed_at,
                        file_count = excluded.file_count,
                        chunk_count = excluded.chunk_count,
                        skipped_file_count = excluded.skipped_file_count,
                        index_version = excluded.index_version
                    """,
                    (
                        index.root_path,
                        index.name,
                        index.branch,
                        index.commit_sha,
                        index.snapshot_id,
                        int(index.dirty),
                        index.indexed_at.isoformat(),
                        index.file_count,
                        len(index.chunks),
                        index.skipped_file_count,
                    ),
                )
                connection.executemany(
                    "INSERT INTO repository_files (path, content_hash) VALUES (?, ?)",
                    [(file.path, file.content_hash) for file in index.files],
                )
                connection.executemany(
                    """
                    INSERT INTO repository_chunks (
                        id, path, language, symbol, kind, start_line, end_line,
                        content, identifiers, imports, content_hash, is_test
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            chunk.id,
                            chunk.path,
                            chunk.language,
                            chunk.symbol,
                            chunk.kind,
                            chunk.start_line,
                            chunk.end_line,
                            chunk.content,
                            chunk.identifiers,
                            chunk.imports,
                            chunk.content_hash,
                            int(chunk.is_test),
                        )
                        for chunk in index.chunks
                    ],
                )
                if job_id:
                    connection.execute(
                        "UPDATE repository_index_job SET status = 'ready', "
                        "progress_files = ?, total_files = ?, error_code = NULL "
                        "WHERE id = ?",
                        (index.file_count, index.file_count, job_id),
                    )
                connection.executemany(
                    """
                    INSERT INTO repository_chunks_fts (
                        chunk_id, path, symbol, identifiers, content
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            chunk.id,
                            chunk.path,
                            chunk.symbol or "",
                            chunk.identifiers,
                            chunk.content,
                        )
                        for chunk in index.chunks
                    ],
                )

    def cached_files(self) -> dict[str, tuple[str, list[IndexedChunk]]]:
        with closing(self.connect()) as connection:
            version = connection.execute(
                "SELECT index_version FROM repository_connection WHERE id = 1"
            ).fetchone()
            if version is None or version[0] != 2:
                return {}
            files = connection.execute(
                "SELECT path, content_hash FROM repository_files"
            ).fetchall()
            chunks = connection.execute(
                "SELECT * FROM repository_chunks ORDER BY path, start_line"
            ).fetchall()
        chunks_by_path: dict[str, list[IndexedChunk]] = {}
        for row in chunks:
            data = dict(row)
            data["is_test"] = bool(data["is_test"])
            chunks_by_path.setdefault(row["path"], []).append(
                IndexedChunk.model_validate(data)
            )
        return {
            row["path"]: (row["content_hash"], chunks_by_path.get(row["path"], []))
            for row in files
        }

    def chunks(self, ids: list[str]) -> list[dict[str, Any]]:
        if not ids:
            return []
        placeholders = ",".join("?" for _ in ids)
        with closing(self.connect()) as connection:
            rows = connection.execute(
                f"SELECT * FROM repository_chunks WHERE id IN ({placeholders})",
                ids,
            ).fetchall()
        by_id = {row["id"]: dict(row) for row in rows}
        return [by_id[id_] for id_ in ids if id_ in by_id]

    def search(self, query: str, limit: int = 40) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT c.*, bm25(repository_chunks_fts, 0, 4, 8, 6, 1) AS rank
                FROM repository_chunks_fts
                JOIN repository_chunks c ON c.id = repository_chunks_fts.chunk_id
                WHERE repository_chunks_fts MATCH ?
                ORDER BY rank, c.path, c.start_line
                LIMIT ?
                """,
                (query, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def profile_rows(self) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT path, language, is_test
                FROM repository_chunks
                GROUP BY path, language, is_test
                ORDER BY path
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def related(
        self, chunks: list[dict[str, Any]], limit: int = 20
    ) -> list[dict[str, Any]]:
        terms = {
            value
            for chunk in chunks
            for value in (chunk.get("symbol"), Path(chunk["path"]).stem)
            if value and len(value) >= 3
        }
        if not terms:
            return []
        clauses = " OR ".join("imports LIKE ?" for _ in terms)
        parameters = [f"%{term}%" for term in sorted(terms)]
        parameters.extend(chunk["id"] for chunk in chunks)
        excluded = ",".join("?" for _ in chunks)
        with closing(self.connect()) as connection:
            rows = connection.execute(
                f"SELECT * FROM repository_chunks WHERE ({clauses}) "
                f"AND id NOT IN ({excluded}) "
                "ORDER BY is_test, path, start_line LIMIT ?",
                (*parameters, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def disconnect(self) -> None:
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("DELETE FROM repository_index_job")
                connection.execute("DELETE FROM repository_chunks_fts")
                connection.execute("DELETE FROM repository_chunks")
                connection.execute("DELETE FROM repository_files")
                connection.execute("DELETE FROM repository_connection WHERE id = 1")
