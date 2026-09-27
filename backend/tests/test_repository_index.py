import sqlite3
from pathlib import Path

import pytest
from dulwich import porcelain
from fastapi.testclient import TestClient

from app.codebase import indexer as indexer_module
from app.codebase.indexer import RepositoryIndexer
from app.codebase.models import RepositoryConnectRequest
from app.codebase.retrieval import RepositoryRetriever
from app.codebase.store import RepositoryStore
from app.codebase.worker import RepositoryWorker
from app.config import Settings
from app.dependencies import get_repository_service
from app.errors import RepositoryError
from app.main import app
from app.services.repositories import RepositoryService


def create_repository(path: Path) -> Path:
    path.mkdir()
    porcelain.init(path)
    (path / "src").mkdir()
    (path / "tests").mkdir()
    (path / "src" / "employees.py").write_text(
        """from app.audit import record_event

class EmployeeDirectory:
    def list_employees(self, page_size: int = 25):
        return []

def update_employee_role(employee_id: str, role: str):
    record_event("employee.role.changed", employee_id)
""",
        encoding="utf-8",
    )
    (path / "tests" / "test_employees.py").write_text(
        """from src.employees import EmployeeDirectory

def test_directory_uses_default_page_size():
    assert EmployeeDirectory().list_employees() == []
""",
        encoding="utf-8",
    )
    (path / "package.json").write_text('{"name":"employee-portal"}', encoding="utf-8")
    (path / ".env.production").write_text("API_KEY=private", encoding="utf-8")
    (path / "secrets.json").write_text('{"token":"private"}', encoding="utf-8")
    (path / "package-lock.json").write_text('{"lockfileVersion":3}', encoding="utf-8")
    porcelain.add(path)
    porcelain.commit(
        path,
        message=b"initial",
        author=b"Test User <test@example.com>",
    )
    return path


def test_indexes_symbols_and_retrieves_diverse_story_evidence(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    database = tmp_path / "plans.db"
    store = RepositoryStore(database)
    index = RepositoryIndexer().inspect(repository, include_uncommitted=False)
    store.save_index(index)

    context = RepositoryRetriever(store).retrieve(
        {
            "title": "Paginate the employee directory",
            "description": "Show employees and allow role updates.",
            "acceptanceCriteria": "Audit every employee role change.",
        }
    )

    assert context is not None
    assert context.snapshot.commitSha == index.commit_sha
    assert context.snapshot.dirty is False
    assert any(item.symbol == "update_employee_role" for item in context.evidence)
    assert any(item.path == "tests/test_employees.py" for item in context.evidence)
    assert all(item.path and item.reason for item in context.evidence)
    assert all(item.commitSha == index.commit_sha for item in context.evidence)
    assert all(item.snapshotId == index.snapshot_id for item in context.evidence)
    assert all(item.contentHash for item in context.evidence)
    assert "python" in context.profile
    indexed_paths = {chunk.path for chunk in index.chunks}
    assert ".env.production" not in indexed_paths
    assert "secrets.json" not in indexed_paths
    assert "package-lock.json" not in indexed_paths


def test_indexes_aspnet_controllers_models_and_additional_languages(tmp_path: Path):
    repository = create_repository(tmp_path / "application")
    for directory in ("Controllers", "Models", "cmd"):
        (repository / directory).mkdir()
    (repository / "Controllers" / "EmployeesController.cs").write_text(
        "using Company.Models;\nnamespace Company.Controllers {\n"
        "public class EmployeesController {\n"
        "  public Employee GetEmployee(int id) { return null; }\n} }\n",
        encoding="utf-8",
    )
    (repository / "Models" / "Employee.cs").write_text(
        "namespace Company.Models;\npublic record Employee(int Id, string Name);\n",
        encoding="utf-8",
    )
    (repository / "application.csproj").write_text(
        '<Project Sdk="Microsoft.NET.Sdk.Web" />', encoding="utf-8"
    )
    (repository / "appsettings.Production.json").write_text(
        '{"ConnectionStrings":{"Default":"private"}}', encoding="utf-8"
    )
    (repository / "cmd" / "main.go").write_text(
        "package main\nfunc ListEmployees() {}\n", encoding="utf-8"
    )
    (repository / "src" / "Employee.java").write_text(
        'public class Employee { public String getName() { return "x"; } }',
        encoding="utf-8",
    )
    (repository / "src" / "lib.rs").write_text(
        "pub struct Employee { name: String }\npub fn list_employees() {}\n",
        encoding="utf-8",
    )
    (repository / "src" / "Employees.kt").write_text(
        "class Employees { fun list() = emptyList<String>() }",
        encoding="utf-8",
    )
    (repository / "unknown.datafmt").write_text("Employee secret?", encoding="utf-8")
    porcelain.add(repository)
    porcelain.commit(
        repository, message=b"more languages", author=b"Test <test@example.com>"
    )

    index = RepositoryIndexer().inspect(repository, include_uncommitted=False)
    by_path = {
        path: [chunk for chunk in index.chunks if chunk.path == path]
        for path in (file.path for file in index.files)
    }
    assert {
        "Controllers/EmployeesController.cs",
        "Models/Employee.cs",
        "application.csproj",
        "cmd/main.go",
        "src/Employee.java",
        "src/lib.rs",
        "src/Employees.kt",
    } <= by_path.keys()
    assert [
        (chunk.symbol, chunk.kind)
        for chunk in by_path["Controllers/EmployeesController.cs"]
        if chunk.symbol
    ] == [("EmployeesController", "class"), ("GetEmployee", "method")]
    assert any(chunk.symbol == "Employee" for chunk in by_path["Models/Employee.cs"])
    assert any(chunk.symbol == "getName" for chunk in by_path["src/Employee.java"])
    assert any(chunk.symbol == "ListEmployees" for chunk in by_path["cmd/main.go"])
    assert any(chunk.symbol == "list_employees" for chunk in by_path["src/lib.rs"])
    assert "appsettings.Production.json" not in by_path
    assert index.skipped_file_count >= 4  # unknown, lockfile and secret-like files

    store = RepositoryStore(tmp_path / "plans.db")
    store.save_index(index)
    context = RepositoryRetriever(store).retrieve(
        {
            "title": "Get employee via EmployeesController",
            "description": "Find the employee controller and model",
            "acceptanceCriteria": "Return an employee by id",
        }
    )
    assert context is not None
    assert any(evidence.path.endswith(".cs") for evidence in context.evidence)
    assert "csharp" in context.profile


def test_fallback_chunks_reach_beyond_first_six_thousand_characters(tmp_path: Path):
    repository = create_repository(tmp_path / "application")
    (repository / "service.php").write_text(
        "// placeholder\n" * 500 + "function employee_directory() {}\n",
        encoding="utf-8",
    )
    porcelain.add(repository)
    porcelain.commit(repository, message=b"php", author=b"Test <test@example.com>")
    index = RepositoryIndexer().inspect(repository, include_uncommitted=False)
    chunks = [chunk for chunk in index.chunks if chunk.path == "service.php"]
    assert len(chunks) > 1
    assert chunks[-1].start_line > 1
    assert "employee_directory" in chunks[-1].content
    assert all(len(chunk.content) <= 6000 for chunk in chunks)


def test_dirty_repository_requires_explicit_consent(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    (repository / "src" / "employees.py").write_text(
        "def changed():\n    return True\n", encoding="utf-8"
    )
    indexer = RepositoryIndexer()

    with pytest.raises(RepositoryError) as error:
        indexer.inspect(repository, include_uncommitted=False)
    assert error.value.code == "REPOSITORY_DIRTY"

    index = indexer.inspect(repository, include_uncommitted=True)
    assert index.dirty is True
    assert "-dirty-" in index.snapshot_id


def test_indexer_excludes_symlinks(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    (repository / "src" / "employees-link.py").symlink_to("employees.py")

    index = RepositoryIndexer().inspect(repository, include_uncommitted=True)

    assert "src/employees-link.py" not in {file.path for file in index.files}


def test_retrieval_returns_story_only_fallback_without_useful_evidence(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    store = RepositoryStore(tmp_path / "plans.db")
    store.save_index(RepositoryIndexer().inspect(repository, include_uncommitted=False))

    context = RepositoryRetriever(store).retrieve(
        {
            "title": "Quasar nebula telemetry",
            "description": "Xylophone zephyr vortex",
            "acceptanceCriteria": "Krypton wavelength",
        }
    )

    assert context is None


def test_unchanged_files_reuse_cached_symbol_chunks(tmp_path: Path, monkeypatch):
    repository = create_repository(tmp_path / "repository")
    store = RepositoryStore(tmp_path / "plans.db")
    indexer = RepositoryIndexer()
    first = indexer.inspect(repository, include_uncommitted=False)
    store.save_index(first)

    def unexpected_parse(*_args, **_kwargs):
        raise AssertionError("unchanged files should not be parsed again")

    monkeypatch.setattr(indexer_module, "_parse_file", unexpected_parse)
    second = indexer.inspect(
        repository,
        include_uncommitted=False,
        cached_files=store.cached_files(),
    )

    assert second.chunks == first.chunks


def test_legacy_index_reparses_files_after_language_upgrade(
    tmp_path: Path, monkeypatch
):
    repository = create_repository(tmp_path / "repository")
    store = RepositoryStore(tmp_path / "plans.db")
    indexer = RepositoryIndexer()
    store.save_index(indexer.inspect(repository, include_uncommitted=False))
    with sqlite3.connect(store.database_path) as connection:
        connection.execute("UPDATE repository_connection SET index_version = 1")
    assert store.cached_files() == {}
    parsed: list[str] = []
    original = indexer_module._parse_file

    def track(relative_path, *args):
        parsed.append(relative_path)
        return original(relative_path, *args)

    monkeypatch.setattr(indexer_module, "_parse_file", track)
    indexer.inspect(
        repository, include_uncommitted=False, cached_files=store.cached_files()
    )
    assert "src/employees.py" in parsed


def test_repository_service_rejects_paths_outside_allowed_root(tmp_path: Path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    repository = create_repository(tmp_path / "outside")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(allowed),
    )
    service = RepositoryService(settings)

    with pytest.raises(RepositoryError) as error:
        service.connect(RepositoryConnectRequest(path=str(repository)))
    assert error.value.code == "REPOSITORY_PATH_NOT_ALLOWED"


def test_repository_service_rejects_discovered_parent_git_root(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    allowed = repository / "src"
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(allowed),
    )
    service = RepositoryService(settings)

    with pytest.raises(RepositoryError) as error:
        service.connect(RepositoryConnectRequest(path=str(allowed)))
    assert error.value.code == "REPOSITORY_PATH_NOT_ALLOWED"


def test_repository_connection_api_indexes_and_disconnects(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(tmp_path),
    )
    service = RepositoryService(settings)
    app.dependency_overrides[get_repository_service] = lambda: service
    try:
        with TestClient(app) as client:
            initial = client.get("/api/connections/repository")
            assert initial.json()["status"] == "disconnected"
            assert initial.json()["rootPath"] is None
            connected = client.put(
                "/api/connections/repository",
                json={"path": str(repository), "includeUncommitted": False},
            )
            assert connected.status_code == 200
            assert connected.json()["status"] == "queued"
            assert connected.json()["connected"] is False
            worker = RepositoryWorker(settings)
            assert worker.process_one()
            ready = client.get("/api/connections/repository").json()
            assert ready["connected"] is True
            assert ready["name"] == "repository"
            assert ready["chunkCount"] >= 3
            assert client.delete("/api/connections/repository").status_code == 200
            assert (
                client.get("/api/connections/repository").json()["connected"] is False
            )
    finally:
        app.dependency_overrides.pop(get_repository_service, None)


def test_repository_index_job_fails_safely_and_can_retry(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    (repository / "src" / "employees.py").write_text(
        "def changed():\n    return True\n", encoding="utf-8"
    )
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(tmp_path),
    )
    service = RepositoryService(settings)
    worker = RepositoryWorker(settings)

    assert (
        service.connect(RepositoryConnectRequest(path=str(repository))).status
        == "queued"
    )
    with pytest.raises(RepositoryError) as error:
        service.connect(RepositoryConnectRequest(path=str(repository)))
    assert error.value.code == "REPOSITORY_INDEX_IN_PROGRESS"
    assert worker.process_one()
    assert service.summary().status == "failed"
    assert service.summary().errorCode == "REPOSITORY_DIRTY"
    assert RepositoryRetriever(service.store).retrieve({"title": "employee"}) is None

    service.connect(
        RepositoryConnectRequest(path=str(repository), includeUncommitted=True)
    )
    assert worker.process_one()
    assert service.summary().status == "ready"
    assert service.summary().dirty is True


def test_repository_worker_recovers_queued_job_after_restart(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(tmp_path),
    )
    service = RepositoryService(settings)
    service.connect(RepositoryConnectRequest(path=str(repository)))
    job = service.store.claim()
    assert job is not None
    assert service.summary().status == "indexing"

    worker = RepositoryWorker(settings)
    worker.store.recover()
    assert worker.process_one()
    assert service.summary().status == "ready"
    assert service.summary().progressFiles == 3


def test_disconnect_cancels_running_job_without_publishing_index(tmp_path: Path):
    repository = create_repository(tmp_path / "repository")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(tmp_path),
    )
    service = RepositoryService(settings)
    service.connect(RepositoryConnectRequest(path=str(repository)))
    job = service.store.claim()
    index = service.inspect(RepositoryConnectRequest(path=str(repository)))
    service.disconnect()

    service.store.save_index(index, job["id"])
    assert service.summary().status == "disconnected"
    assert service.store.summary() is None


def test_old_planner_index_outside_allowed_workspace_is_not_connected(tmp_path: Path):
    repository = create_repository(tmp_path / "planner")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(workspace),
    )
    service = RepositoryService(settings)
    service.store.save_index(
        RepositoryIndexer().inspect(repository, include_uncommitted=False)
    )

    assert service.summary().connected is False
    assert service.summary().status == "disconnected"


def test_browse_lists_only_directories_inside_configured_workspace(tmp_path: Path):
    workspace = tmp_path / "projects"
    workspace.mkdir()
    repository = create_repository(workspace / "employee-portal")
    (workspace / "empty-project").mkdir()
    (workspace / "readme.txt").write_text("not listed", encoding="utf-8")
    (workspace / ".hidden").mkdir()
    (workspace / "external-link").symlink_to(tmp_path, target_is_directory=True)
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(workspace),
    )
    service = RepositoryService(settings)

    roots = service.browse()
    assert roots.path is None
    assert [entry.path for entry in roots.directories] == [str(workspace)]
    folders = service.browse(str(workspace))
    assert [(item.name, item.isRepository) for item in folders.directories] == [
        ("employee-portal", True),
        ("empty-project", False),
    ]
    assert folders.parentPath is None
    assert service.browse(str(repository)).parentPath == str(workspace)
    assert service.browse(str(repository)).isRepository is True

    with pytest.raises(RepositoryError) as error:
        service.browse(str(workspace / "external-link"))
    assert error.value.code == "REPOSITORY_PATH_NOT_ALLOWED"
    with pytest.raises(RepositoryError):
        service.browse(str(tmp_path))
    with pytest.raises(RepositoryError):
        service.browse(str(workspace / "employee-portal" / ".."))


def test_browse_api_paginates_and_does_not_connect(tmp_path: Path):
    workspace = tmp_path / "projects"
    workspace.mkdir()
    repository = create_repository(workspace / "employee-portal")
    (workspace / "other-project").mkdir()
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'plans.db'}",
        repository_allowed_roots=str(workspace),
    )
    service = RepositoryService(settings)
    service.BROWSE_PAGE_SIZE = 1
    app.dependency_overrides[get_repository_service] = lambda: service
    try:
        with TestClient(app) as client:
            roots = client.get("/api/connections/repository/browse")
            assert roots.status_code == 200
            assert roots.json()["directories"][0]["path"] == str(workspace)
            first = client.get(
                "/api/connections/repository/browse", params={"path": str(workspace)}
            ).json()
            assert first["hasMore"] is True
            assert first["directories"][0]["path"] == str(repository)
            second = client.get(
                "/api/connections/repository/browse",
                params={"path": str(workspace), "offset": 1},
            ).json()
            assert second["directories"][0]["name"] == "other-project"
            assert second["hasMore"] is False
            assert (
                client.get("/api/connections/repository").json()["connected"] is False
            )
            denied = client.get(
                "/api/connections/repository/browse", params={"path": str(tmp_path)}
            )
            assert denied.status_code == 403
    finally:
        app.dependency_overrides.pop(get_repository_service, None)
