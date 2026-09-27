import heapq
import os
from collections.abc import Callable
from pathlib import Path

from dulwich.repo import Repo

from app.codebase.indexer import RepositoryIndexer
from app.codebase.models import (
    RepositoryBrowseResponse,
    RepositoryConnectionSummary,
    RepositoryConnectRequest,
    RepositoryDirectory,
)
from app.codebase.store import RepositoryStore
from app.config import Settings
from app.errors import RepositoryError


class RepositoryService:
    BROWSE_PAGE_SIZE = 100

    def __init__(
        self,
        settings: Settings,
        store: RepositoryStore | None = None,
        indexer: RepositoryIndexer | None = None,
    ) -> None:
        self.settings = settings
        self.store = store or RepositoryStore(settings.sqlite_path)
        self.indexer = indexer or RepositoryIndexer(settings.repository_max_file_bytes)

    def summary(self) -> RepositoryConnectionSummary:
        record = self.store.summary()
        job = self.store.job()
        if job:
            status = {"running": "indexing"}.get(job["status"], job["status"])
            if status != "ready":
                return RepositoryConnectionSummary(
                    connected=False,
                    status=status,
                    requestedPath=job["path"],
                    progressFiles=job["progress_files"],
                    totalFiles=job["total_files"],
                    errorCode=job["error_code"],
                )
        if record and not self._allowed_root(Path(record["root_path"])):
            record = None
        if record is None:
            return RepositoryConnectionSummary(connected=False)
        return RepositoryConnectionSummary(
            connected=True,
            status="ready",
            requestedPath=job["path"] if job else record["root_path"],
            progressFiles=job["progress_files"] if job else record["file_count"],
            totalFiles=job["total_files"] if job else record["file_count"],
            name=record["name"],
            rootPath=record["root_path"],
            branch=record["branch"],
            commitSha=record["commit_sha"],
            snapshotId=record["snapshot_id"],
            dirty=bool(record["dirty"]),
            indexedAt=record["indexed_at"],
            fileCount=record["file_count"],
            chunkCount=record["chunk_count"],
        )

    def inspect(
        self,
        request: RepositoryConnectRequest,
        progress: Callable[[int, int], None] | None = None,
    ):
        path = self._validated_path(request.path)
        record = self.store.summary()
        cached_files = None
        if record and Path(record["root_path"]) == path:
            cached_files = self.store.cached_files()
        index = self.indexer.inspect(
            path,
            include_uncommitted=request.includeUncommitted,
            cached_files=cached_files,
            progress=progress,
        )
        repository_root = Path(index.root_path)
        if not any(
            self._is_within(repository_root, root)
            for root in self.settings.repository_roots
        ):
            raise RepositoryError(
                "Discovered Git root is outside the backend's allowed roots.",
                403,
                "REPOSITORY_PATH_NOT_ALLOWED",
            )
        return index

    def connect(self, request: RepositoryConnectRequest) -> RepositoryConnectionSummary:
        path = self._validated_path(request.path)
        try:
            repository = Repo.discover(path)
            root = Path(repository.path).resolve()
            repository.close()
        except Exception:
            raise RepositoryError(
                "Select a local Git working tree.", 422, "REPOSITORY_NOT_GIT"
            ) from None
        if not self._allowed_root(root):
            raise RepositoryError(
                "Discovered Git root is outside the backend's allowed roots.",
                403,
                "REPOSITORY_PATH_NOT_ALLOWED",
            )
        self.store.enqueue(str(root), request.includeUncommitted)
        return self.summary()

    def reindex(self, *, include_uncommitted: bool) -> RepositoryConnectionSummary:
        status = self.summary()
        if not status.connected or status.rootPath is None:
            raise RepositoryError(
                "Connect a repository first.", 409, "REPOSITORY_NOT_CONFIGURED"
            )
        return self.connect(
            RepositoryConnectRequest(
                path=status.rootPath, includeUncommitted=include_uncommitted
            )
        )

    def disconnect(self) -> None:
        self.store.disconnect()

    def browse(
        self, value: str | None = None, offset: int = 0
    ) -> RepositoryBrowseResponse:
        if value is None:
            roots = [root for root in self.settings.repository_roots if root.is_dir()]
            directories = sorted(
                (
                    RepositoryDirectory(
                        name=root.name or str(root),
                        path=str(root),
                        isRepository=self._is_git_root(root),
                    )
                    for root in roots
                ),
                key=lambda item: (item.name.casefold(), item.path),
            )
            page = directories[offset : offset + self.BROWSE_PAGE_SIZE]
            return RepositoryBrowseResponse(
                path=None,
                parentPath=None,
                directories=page,
                offset=offset,
                hasMore=len(directories) > offset + self.BROWSE_PAGE_SIZE,
            )

        requested = Path(value)
        if not requested.is_absolute() or ".." in requested.parts:
            raise RepositoryError(
                "Select a directory from the configured workspace.",
                422,
                "REPOSITORY_PATH_INVALID",
            )
        root = next(
            (
                root
                for root in self.settings.repository_roots
                if self._is_within(requested, root)
            ),
            None,
        )
        if root is None:
            raise RepositoryError(
                "Directory is outside the backend's allowed roots.",
                403,
                "REPOSITORY_PATH_NOT_ALLOWED",
            )
        relative = requested.relative_to(root)
        if any(
            (root / Path(*relative.parts[:i])).is_symlink()
            for i in range(1, len(relative.parts) + 1)
        ):
            raise RepositoryError(
                "Symlink directories cannot be browsed.",
                403,
                "REPOSITORY_PATH_NOT_ALLOWED",
            )
        try:
            directory = requested.resolve()
        except (OSError, ValueError):
            raise RepositoryError(
                "Repository directory is unavailable.", 422, "REPOSITORY_PATH_INVALID"
            ) from None
        if not self._is_within(directory, root):
            raise RepositoryError(
                "Directory is outside the backend's allowed roots.",
                403,
                "REPOSITORY_PATH_NOT_ALLOWED",
            )
        if not directory.is_dir():
            raise RepositoryError(
                "Repository directory is unavailable.", 422, "REPOSITORY_PATH_INVALID"
            )
        try:
            with os.scandir(directory) as entries:
                # Bound memory even in directories with many children.
                page_entries = heapq.nsmallest(
                    offset + self.BROWSE_PAGE_SIZE + 1,
                    (
                        entry
                        for entry in entries
                        if not entry.name.startswith(".")
                        and entry.is_dir(follow_symlinks=False)
                    ),
                    key=lambda entry: (entry.name.casefold(), entry.name),
                )
        except OSError:
            raise RepositoryError(
                "Repository directory cannot be listed.",
                422,
                "REPOSITORY_DIRECTORY_UNREADABLE",
            ) from None
        page = page_entries[offset : offset + self.BROWSE_PAGE_SIZE]
        return RepositoryBrowseResponse(
            path=str(directory),
            parentPath=None if directory == root else str(directory.parent),
            isRepository=self._is_git_root(directory),
            directories=[
                RepositoryDirectory(
                    name=entry.name,
                    path=str(directory / entry.name),
                    isRepository=self._is_git_root(directory / entry.name),
                )
                for entry in page
            ],
            offset=offset,
            hasMore=len(page_entries) > offset + self.BROWSE_PAGE_SIZE,
        )

    @staticmethod
    def _is_git_root(directory: Path) -> bool:
        marker = directory / ".git"
        return not marker.is_symlink() and (marker.is_dir() or marker.is_file())

    def _validated_path(self, value: str) -> Path:
        path = Path(value).expanduser().resolve()
        if not path.is_dir():
            raise RepositoryError(
                "Repository path is not a readable directory.",
                422,
                "REPOSITORY_PATH_INVALID",
            )
        if not any(
            self._is_within(path, root) for root in self.settings.repository_roots
        ):
            raise RepositoryError(
                "Repository path is outside the backend's allowed roots.",
                403,
                "REPOSITORY_PATH_NOT_ALLOWED",
            )
        return path

    def _allowed_root(self, path: Path) -> bool:
        return any(
            self._is_within(path, root) for root in self.settings.repository_roots
        )

    @staticmethod
    def _is_within(path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False
