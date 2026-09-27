from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RepositoryConnectRequest(BaseModel):
    path: str = Field(min_length=1, max_length=2000)
    includeUncommitted: bool = False


class RepositoryReindexRequest(BaseModel):
    includeUncommitted: bool = False


class RepositoryDirectory(BaseModel):
    name: str
    path: str
    isRepository: bool


class RepositoryBrowseResponse(BaseModel):
    path: str | None
    parentPath: str | None
    isRepository: bool = False
    directories: list[RepositoryDirectory]
    offset: int
    hasMore: bool


class IndexedLanguage(BaseModel):
    language: str
    fileCount: int = Field(ge=0)


class RepositoryConnectionSummary(BaseModel):
    connected: bool
    status: Literal["disconnected", "queued", "indexing", "ready", "failed"] = (
        "disconnected"
    )
    requestedPath: str | None = None
    progressFiles: int = 0
    totalFiles: int = 0
    errorCode: str | None = None
    name: str | None = None
    rootPath: str | None = None
    branch: str | None = None
    commitSha: str | None = None
    snapshotId: str | None = None
    dirty: bool = False
    indexedAt: datetime | None = None
    fileCount: int = 0
    chunkCount: int = 0
    skippedFileCount: int = 0
    indexedLanguages: list[IndexedLanguage] = Field(default_factory=list)


class RepositorySnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    branch: str | None
    commitSha: str
    snapshotId: str
    dirty: bool
    indexedAt: datetime


class RepositoryEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunkId: str
    commitSha: str
    snapshotId: str
    contentHash: str
    path: str
    language: str
    symbol: str | None
    kind: str
    startLine: int = Field(ge=1)
    endLine: int = Field(ge=1)
    excerpt: str
    reason: str


class RepositoryContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot: RepositorySnapshot
    profile: str
    evidence: list[RepositoryEvidence]


class IndexedChunk(BaseModel):
    id: str
    path: str
    language: str
    symbol: str | None
    kind: str
    start_line: int
    end_line: int
    content: str
    identifiers: str
    imports: str
    content_hash: str
    is_test: bool


class IndexedFile(BaseModel):
    path: str
    content_hash: str


class RepositoryIndex(BaseModel):
    root_path: str
    name: str
    branch: str | None
    commit_sha: str
    snapshot_id: str
    dirty: bool
    indexed_at: datetime
    file_count: int
    skipped_file_count: int = 0
    files: list[IndexedFile]
    chunks: list[IndexedChunk]
