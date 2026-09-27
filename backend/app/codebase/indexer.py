import hashlib
import re
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path

import tree_sitter_c_sharp
import tree_sitter_go
import tree_sitter_java
import tree_sitter_javascript
import tree_sitter_python
import tree_sitter_rust
import tree_sitter_typescript
from dulwich import porcelain
from dulwich.repo import Repo
from tree_sitter import Language, Node, Parser

from app.codebase.models import IndexedChunk, IndexedFile, RepositoryIndex
from app.errors import RepositoryError

_LANGUAGES = {
    ".cs": ("csharp", Language(tree_sitter_c_sharp.language())),
    ".go": ("go", Language(tree_sitter_go.language())),
    ".java": ("java", Language(tree_sitter_java.language())),
    ".py": ("python", Language(tree_sitter_python.language())),
    ".rs": ("rust", Language(tree_sitter_rust.language())),
    ".js": ("javascript", Language(tree_sitter_javascript.language())),
    ".jsx": ("javascript", Language(tree_sitter_javascript.language())),
    ".ts": ("typescript", Language(tree_sitter_typescript.language_typescript())),
    ".tsx": ("tsx", Language(tree_sitter_typescript.language_tsx())),
}
_TEXT_EXTENSIONS = {
    ".c",
    ".cc",
    ".cpp",
    ".cshtml",
    ".csproj",
    ".css",
    ".graphql",
    ".h",
    ".hpp",
    ".html",
    ".json",
    ".kt",
    ".kts",
    ".md",
    ".php",
    ".props",
    ".razor",
    ".rb",
    ".scss",
    ".sh",
    ".sql",
    ".swift",
    ".targets",
    ".toml",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
}
_MANIFEST_NAMES = {
    "dockerfile",
    "global.json",
    "compose.yaml",
    "compose.yml",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "vite.config.ts",
}
_DENIED_NAMES = {
    ".env",
    ".env.local",
    "credentials.json",
    "config.php",
    "id_rsa",
    "id_ed25519",
    "mockserviceworker.js",
    "package-lock.json",
    "pnpm-lock.yaml",
    "secrets.json",
    "yarn.lock",
}
_DENIED_SUFFIXES = {".key", ".p12", ".pfx", ".pem", ".pyc"}
_DENIED_PARTS = {
    ".agents",
    ".claude",
    ".git",
    ".next",
    ".opencode",
    ".venv",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "vendor",
}
_SYMBOL_TYPES = {
    "class_declaration": "class",
    "class_definition": "class",
    "constructor_declaration": "constructor",
    "enum_declaration": "enum",
    "enum_item": "enum",
    "function_declaration": "function",
    "function_definition": "function",
    "function_item": "function",
    "generator_function_declaration": "function",
    "interface_declaration": "interface",
    "method_declaration": "method",
    "mod_item": "module",
    "record_declaration": "record",
    "struct_declaration": "struct",
    "struct_item": "struct",
    "trait_item": "trait",
    "type_declaration": "type",
    "type_alias_declaration": "type",
    "type_spec": "type",
}
_IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_]{1,}")
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_IMPORT_LINE = re.compile(
    r"^\s*(?:from\s+[^\s]+\s+import\s+|import\s+|using\s+|use\s+|.*?require\s*\()(.+)$",
    re.MULTILINE,
)
_MAX_CHUNK_CHARS = 6_000
_MAX_FILE_CHUNKS = 20
_NESTED_CONTAINERS = {
    "class_body",
    "declaration_list",
    "namespace_declaration",
    "file_scoped_namespace_declaration",
    "class_declaration",
    "record_declaration",
    "struct_declaration",
    "interface_declaration",
    "enum_declaration",
    "method_declaration",
    "type_declaration",
    "type_spec",
    "impl_item",
    "trait_item",
    "mod_item",
    "block",
    "source_file",
    "program",
}


def _decode_path(value: bytes | str) -> str:
    return (
        value.decode("utf-8", "surrogateescape") if isinstance(value, bytes) else value
    )


def _is_allowed(path: Path) -> bool:
    lowered_parts = {part.casefold() for part in path.parts}
    name = path.name.casefold()
    if lowered_parts & _DENIED_PARTS:
        return False
    if (
        name.startswith(".env")
        or (name.startswith("appsettings.") and name.endswith(".json"))
        or name in _DENIED_NAMES
        or path.suffix.casefold() in _DENIED_SUFFIXES
    ):
        return False
    return (
        path.suffix.casefold() in {*_LANGUAGES, *_TEXT_EXTENSIONS}
        or name in _MANIFEST_NAMES
    )


def _tokens(*values: str) -> str:
    result: set[str] = set()
    for value in values:
        for token in _IDENTIFIER.findall(value):
            parts = _CAMEL_BOUNDARY.sub(" ", token).replace("_", " ").split()
            result.update(part.casefold() for part in parts if len(part) > 1)
            result.add(token.casefold())
    return " ".join(sorted(result))


def _node_text(node: Node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", "replace")


def _named_node(node: Node, source: bytes) -> tuple[str, str] | None:
    kind = _SYMBOL_TYPES.get(node.type)
    if kind:
        name = node.child_by_field_name("name")
        if name:
            return _node_text(name, source), kind
    if node.type == "lexical_declaration":
        for child in node.named_children:
            if child.type != "variable_declarator":
                continue
            name = child.child_by_field_name("name")
            value = child.child_by_field_name("value")
            if (
                name
                and value
                and value.type
                in {
                    "arrow_function",
                    "function_expression",
                    "class",
                }
            ):
                return _node_text(name, source), "declaration"
    return None


def _top_level_nodes(root: Node) -> Iterable[Node]:
    for node in root.named_children:
        if node.type in {"decorated_definition", "export_statement"}:
            yield from node.named_children
        else:
            yield node


def _declaration_nodes(root: Node) -> Iterable[Node]:
    stack = list(reversed(root.named_children))
    count = 0
    while stack and count < 100:
        node = stack.pop()
        if node.type in _SYMBOL_TYPES:
            count += 1
            yield node
        if node.type in _NESTED_CONTAINERS:
            stack.extend(reversed(node.named_children))


def _text_chunks(relative_path: str, content: str, imports: str) -> list[IndexedChunk]:
    chunks: list[IndexedChunk] = []
    lines = content.splitlines(keepends=True)
    start = 1
    position = 0
    while position < len(lines) and len(chunks) < _MAX_FILE_CHUNKS:
        size = 0
        end = position
        while end < len(lines) and size + len(lines[end]) <= _MAX_CHUNK_CHARS:
            size += len(lines[end])
            end += 1
        if end == position:
            end += 1
        chunks.append(
            _chunk(
                relative_path,
                Path(relative_path).suffix.casefold().removeprefix(".") or "text",
                None,
                "file",
                start,
                end,
                "".join(lines[position:end]),
                imports,
            )
        )
        position = end
        start = end + 1
    if not chunks:
        chunks.append(
            _chunk(relative_path, "text", None, "file", 1, 1, content, imports)
        )
    return chunks


def _chunk(
    relative_path: str,
    language: str,
    symbol: str | None,
    kind: str,
    start_line: int,
    end_line: int,
    content: str,
    imports: str,
) -> IndexedChunk:
    excerpt = content[:_MAX_CHUNK_CHARS]
    digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
    chunk_id = hashlib.sha256(
        f"{relative_path}:{symbol or kind}:{start_line}:{digest}".encode()
    ).hexdigest()[:24]
    path = Path(relative_path)
    is_test = (
        any(part.casefold().startswith("test") for part in path.parts)
        or path.name.casefold().startswith(("test_", "spec."))
        or ".test." in path.name.casefold()
    )
    return IndexedChunk(
        id=chunk_id,
        path=relative_path,
        language=language,
        symbol=symbol,
        kind=kind,
        start_line=start_line,
        end_line=end_line,
        content=excerpt,
        identifiers=_tokens(relative_path, symbol or "", excerpt),
        imports=imports[:2_000],
        content_hash=digest,
        is_test=is_test,
    )


def _parse_file(
    relative_path: str,
    content: str,
    parsers: dict[str, Parser] | None = None,
) -> list[IndexedChunk]:
    suffix = Path(relative_path).suffix.casefold()
    imports = "\n".join(
        match.group(0).strip() for match in _IMPORT_LINE.finditer(content)
    )
    language_entry = _LANGUAGES.get(suffix)
    if not language_entry:
        return _text_chunks(relative_path, content, imports)

    language, grammar = language_entry
    source = content.encode("utf-8")
    parser = parsers[suffix] if parsers else Parser(grammar)
    tree = parser.parse(source)
    chunks = [
        _chunk(
            relative_path,
            language,
            None,
            "module",
            1,
            max(1, len(content.splitlines())),
            content,
            imports,
        )
    ]
    nodes = (
        _declaration_nodes(tree.root_node)
        if suffix in {".cs", ".java", ".go", ".rs"}
        else _top_level_nodes(tree.root_node)
    )
    for node in nodes:
        named = _named_node(node, source)
        if not named:
            continue
        symbol, kind = named
        chunks.append(
            _chunk(
                relative_path,
                language,
                symbol,
                kind,
                node.start_point.row + 1,
                node.end_point.row + 1,
                source[node.start_byte : node.end_byte].decode("utf-8", "replace"),
                imports,
            )
        )
    return chunks


class RepositoryIndexer:
    def __init__(self, max_file_bytes: int = 512_000) -> None:
        self.max_file_bytes = max_file_bytes
        self.parsers = {
            suffix: Parser(grammar) for suffix, (_, grammar) in _LANGUAGES.items()
        }

    def inspect(
        self,
        path: Path,
        *,
        include_uncommitted: bool,
        cached_files: dict[str, tuple[str, list[IndexedChunk]]] | None = None,
        progress: Callable[[int, int], None] | None = None,
    ) -> RepositoryIndex:
        try:
            repository = Repo.discover(path)
        except Exception:
            raise RepositoryError(
                "Select a local Git working tree.", 422, "REPOSITORY_NOT_GIT"
            ) from None
        try:
            root = Path(repository.path).resolve()
            status = porcelain.status(repository, untracked_files="all")
            staged = [item for values in status.staged.values() for item in values]
            dirty = bool(staged or status.unstaged or status.untracked)
            if dirty and not include_uncommitted:
                raise RepositoryError(
                    "The repository has uncommitted changes. Explicitly include "
                    "them or index a clean working tree.",
                    409,
                    "REPOSITORY_DIRTY",
                )
            commit_sha = repository.head().decode("ascii")
            head_ref = repository.refs.read_ref(b"HEAD")
            branch = None
            if head_ref and head_ref.startswith(b"ref: refs/heads/"):
                branch = head_ref.removeprefix(b"ref: refs/heads/").decode(
                    "utf-8", "replace"
                )
            deleted = {
                _decode_path(item)
                for item in [*status.staged.get("delete", []), *status.unstaged]
                if not (root / _decode_path(item)).exists()
            }
            candidates = {_decode_path(item) for item in porcelain.ls_files(repository)}
            if include_uncommitted:
                candidates.update(_decode_path(item) for item in status.untracked)
            candidates.difference_update(deleted)

            chunks: list[IndexedChunk] = []
            files: list[IndexedFile] = []
            content_hashes: list[str] = []
            file_count = 0
            eligible = sorted(
                relative for relative in candidates if _is_allowed(Path(relative))
            )
            for position, relative in enumerate(eligible, 1):
                relative_path = Path(relative)
                if progress and (
                    position == 1 or position % 20 == 0 or position == len(eligible)
                ):
                    progress(position - 1, len(eligible))
                candidate_path = root / relative_path
                if candidate_path.is_symlink():
                    continue
                file_path = candidate_path.resolve()
                try:
                    file_path.relative_to(root)
                except ValueError:
                    continue
                try:
                    if (
                        not file_path.is_file()
                        or file_path.stat().st_size > self.max_file_bytes
                    ):
                        continue
                    raw = file_path.read_bytes()
                except OSError:
                    continue
                if b"\x00" in raw:
                    continue
                try:
                    content = raw.decode("utf-8")
                except UnicodeDecodeError:
                    continue
                file_count += 1
                digest = hashlib.sha256(raw).hexdigest()
                content_hashes.append(f"{relative}:{digest}")
                normalized_path = relative_path.as_posix()
                files.append(IndexedFile(path=normalized_path, content_hash=digest))
                cached = (cached_files or {}).get(normalized_path)
                if cached and cached[0] == digest:
                    chunks.extend(cached[1])
                else:
                    chunks.extend(_parse_file(normalized_path, content, self.parsers))

            if progress:
                progress(len(eligible), len(eligible))

            if not chunks:
                raise RepositoryError(
                    "No supported source, test, configuration, or documentation "
                    "files were found.",
                    422,
                    "REPOSITORY_EMPTY",
                )
            worktree_digest = hashlib.sha256(
                "\n".join(content_hashes).encode("utf-8")
            ).hexdigest()[:12]
            snapshot_id = (
                f"{commit_sha}-dirty-{worktree_digest}" if dirty else commit_sha
            )
            return RepositoryIndex(
                root_path=str(root),
                name=root.name,
                branch=branch,
                commit_sha=commit_sha,
                snapshot_id=snapshot_id,
                dirty=dirty,
                indexed_at=datetime.now(UTC),
                file_count=file_count,
                skipped_file_count=len(candidates) - file_count,
                files=files,
                chunks=chunks,
            )
        finally:
            repository.close()
