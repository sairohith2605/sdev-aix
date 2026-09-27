import re
from collections import Counter, defaultdict
from pathlib import Path

from app.codebase.models import (
    RepositoryContext,
    RepositoryEvidence,
    RepositorySnapshot,
)
from app.codebase.store import RepositoryStore
from app.planning.analysis import normalize_story_text

_WORD = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}")
_STOP_WORDS = {
    "acceptance",
    "and",
    "application",
    "are",
    "can",
    "code",
    "components",
    "criteria",
    "feature",
    "for",
    "from",
    "generate",
    "plan",
    "planning",
    "relevant",
    "services",
    "should",
    "story",
    "technical",
    "tests",
    "that",
    "the",
    "their",
    "then",
    "this",
    "use",
    "using",
    "was",
    "when",
    "where",
    "with",
    "work",
}


def _terms(value: str) -> list[str]:
    return [
        token.casefold().replace("-", "_")
        for token in _WORD.findall(value)
        if token.casefold() not in _STOP_WORDS
    ]


def _fts_query(terms: list[str]) -> str:
    unique = list(dict.fromkeys(terms))[:16]
    return " OR ".join(f'"{term.replace(chr(34), "")}"' for term in unique)


def _profile(rows: list[dict]) -> str:
    languages = Counter(row["language"] for row in rows)
    directories = Counter(
        Path(row["path"]).parts[0] if len(Path(row["path"]).parts) > 1 else "."
        for row in rows
    )
    manifests = sorted(
        {
            row["path"]
            for row in rows
            if Path(row["path"]).name.casefold()
            in {
                "compose.yaml",
                "dockerfile",
                "package.json",
                "pyproject.toml",
                "vite.config.ts",
            }
        }
    )
    language_text = ", ".join(
        f"{language} ({count} files)" for language, count in languages.most_common(6)
    )
    directory_text = ", ".join(name for name, _ in directories.most_common(8))
    manifest_text = ", ".join(manifests[:8]) or "none detected"
    return (
        f"Languages: {language_text or 'unknown'}. "
        f"Top-level areas: {directory_text or 'root'}. "
        f"Architecture manifests: {manifest_text}."
    )


class RepositoryRetriever:
    def __init__(
        self,
        store: RepositoryStore,
        *,
        max_evidence: int = 8,
        max_context_chars: int = 40_000,
    ) -> None:
        self.store = store
        self.max_evidence = max_evidence
        self.max_context_chars = max_context_chars

    def retrieve(self, story: dict) -> RepositoryContext | None:
        if not self.store.ready():
            return None
        connection = self.store.summary()
        if connection is None:
            return None
        title_terms = _terms(str(story.get("title", "")))
        detail_terms = _terms(
            normalize_story_text(story.get("description"))
            + "\n"
            + normalize_story_text(story.get("acceptanceCriteria"))
        )
        queries = [
            _fts_query(title_terms),
            _fts_query([*title_terms, *detail_terms]),
            *[_fts_query([term]) for term in [*title_terms[:6], *detail_terms[:8]]],
        ]
        rankings: dict[str, float] = defaultdict(float)
        candidates: dict[str, dict] = {}
        for query in dict.fromkeys(query for query in queries if query):
            for position, chunk in enumerate(self.store.search(query), 1):
                candidates[chunk["id"]] = chunk
                rankings[chunk["id"]] += 1 / (60 + position)
        ordered = sorted(
            candidates.values(),
            key=lambda chunk: (
                -rankings[chunk["id"]],
                chunk["is_test"],
                chunk["path"],
                chunk["start_line"],
            ),
        )
        ordered = self._prefer_symbols(ordered)
        seeds = self._diversify(ordered, min(6, self.max_evidence))
        related = self.store.related(seeds)
        selected = self._diversify([*seeds, *related], self.max_evidence)
        evidence: list[RepositoryEvidence] = []
        used_chars = 0
        all_terms = set(title_terms + detail_terms)
        seed_ids = {chunk["id"] for chunk in seeds}
        for chunk in selected:
            remaining = self.max_context_chars - used_chars
            if remaining < 500:
                break
            excerpt = chunk["content"][: min(6_000, remaining)]
            matched = sorted(all_terms & set(_terms(chunk["identifiers"])))[:5]
            if chunk["id"] in seed_ids:
                reason = (
                    "Matched story terms: " + ", ".join(matched)
                    if matched
                    else "Ranked as relevant to the story and repository structure"
                )
            else:
                reason = (
                    "Directly imports or references a selected implementation symbol"
                )
            evidence.append(
                RepositoryEvidence(
                    chunkId=chunk["id"],
                    commitSha=connection["commit_sha"],
                    snapshotId=connection["snapshot_id"],
                    contentHash=chunk["content_hash"],
                    path=chunk["path"],
                    language=chunk["language"],
                    symbol=chunk["symbol"],
                    kind=chunk["kind"],
                    startLine=chunk["start_line"],
                    endLine=chunk["end_line"],
                    excerpt=excerpt,
                    reason=reason,
                )
            )
            used_chars += len(excerpt)
        if not evidence:
            return None
        return RepositoryContext(
            snapshot=RepositorySnapshot(
                name=connection["name"],
                branch=connection["branch"],
                commitSha=connection["commit_sha"],
                snapshotId=connection["snapshot_id"],
                dirty=bool(connection["dirty"]),
                indexedAt=connection["indexed_at"],
            ),
            profile=_profile(self.store.profile_rows()),
            evidence=evidence,
        )

    @staticmethod
    def _diversify(chunks: list[dict], limit: int) -> list[dict]:
        selected: list[dict] = []
        per_path: Counter[str] = Counter()
        seen: set[str] = set()
        for chunk in chunks:
            if chunk["id"] in seen or per_path[chunk["path"]] >= 1:
                continue
            selected.append(chunk)
            seen.add(chunk["id"])
            per_path[chunk["path"]] += 1
            if len(selected) == limit:
                break
        relevant_test = next(
            (chunk for chunk in chunks if chunk["is_test"] and chunk["id"] not in seen),
            None,
        )
        if (
            relevant_test
            and selected
            and not any(chunk["is_test"] for chunk in selected)
        ):
            selected[-1] = relevant_test
        return selected

    @staticmethod
    def _prefer_symbols(chunks: list[dict]) -> list[dict]:
        symbols_by_path: dict[str, dict] = {}
        for chunk in chunks:
            if chunk["symbol"] and chunk["path"] not in symbols_by_path:
                symbols_by_path[chunk["path"]] = chunk
        preferred: list[dict] = []
        emitted_paths: set[str] = set()
        for chunk in chunks:
            path = chunk["path"]
            if path in emitted_paths:
                preferred.append(chunk)
                continue
            preferred.append(symbols_by_path.get(path, chunk))
            emitted_paths.add(path)
        return preferred
