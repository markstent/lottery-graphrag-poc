"""The documentation tree stays navigable (Phase 7, Task 9).

Every relative Markdown link outside the archive must resolve, and nothing
outside the archive may still name a document that moved into
``docs/reference/``. Both checks read the repository through git, so they need
no services and no generated data.
"""

import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ARCHIVE = REPO / "docs" / "reference"
ARCHIVE_README = ARCHIVE / "README.md"

# Archival links may break, plans and the spec keep their historical paths,
# and the changelog is generated.
EXCLUDED_PREFIXES = ("docs/reference/", "docs/superpowers/", ".superpowers/")
EXCLUDED_PARTS = ("node_modules",)
EXCLUDED_FILES = ("CHANGELOG.md",)

LINKS = (
    re.compile(r"\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\)"),  # inline, optional <...>
    re.compile(r"^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?", re.MULTILINE),  # reference-style
)
PRIMARY_FILES = {
    "README.md",
    "docs/architecture.md",
    "docs/data.md",
    "docs/graph-and-ontology.md",
    "docs/scenarios.md",
    "docs/retrieval.md",
    "docs/evaluation.md",
    "docs/api.md",
    "docs/ux.md",
    "docs/operations.md",
}
# Governance files outside the ten: a few planning documents are replaced by these.
GOVERNANCE_FILES = {"AGENTS.md", "HITL_STATUS.md"}
MOVED_FOLDERS = (
    "ux",
    "product",
    "architecture",
    "data",
    "retrieval",
    "testing",
    "development",
    "demo",
)
# A moved folder as whole path segments, with or without a trailing slash, but not a
# primary file such as docs/ux.md; and a numbered specification by its short form.
OLD_FORMS = re.compile(rf"(?<![/\w])docs/(?:(?:{'|'.join(MOVED_FOLDERS)})(?![\w-]|\.md)|0[1-8]-)")
ARCHIVE_LINE = re.compile(r"^- `(docs/reference/[^`]+)`.* Replaced by (.+)\.$", re.MULTILINE)

SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
ARCHIVE_ENTRY = re.compile(r"^- `(docs/reference/[^`]+)`", re.MULTILINE)


def _git(*args: str, allow_no_match: bool = False) -> list[str]:
    result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    if result.returncode != 0 and not (allow_no_match and result.returncode == 1):
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr}")
    out = result.stdout
    return [line for line in out.splitlines() if line]


def _is_excluded(path: str) -> bool:
    return (
        path.startswith(EXCLUDED_PREFIXES)
        or any(part in path.split("/") for part in EXCLUDED_PARTS)
        or path in EXCLUDED_FILES
    )


def _markdown_files() -> list[str]:
    paths = _git("ls-files", "--cached", "--others", "--exclude-standard", "*.md")
    return sorted(p for p in paths if (REPO / p).is_file() and not _is_excluded(p))


def _original_path(archived: str) -> str:
    """The path a document had before it moved into the archive."""
    relative = archived.removeprefix("docs/reference/")
    return relative if "/" not in relative and not relative[:2].isdigit() else f"docs/{relative}"


def _fenced_free(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


def test_every_relative_markdown_link_resolves() -> None:
    broken: list[str] = []
    for path in _markdown_files():
        text = _fenced_free((REPO / path).read_text(encoding="utf-8"))
        targets = [t for pattern in LINKS for t in pattern.findall(text)]
        for target in targets:
            if SCHEME.match(target) or target.startswith("#"):
                continue
            file_part = target.split("#", 1)[0]
            if not file_part:
                continue
            if not (REPO / path).parent.joinpath(file_part).resolve().exists():
                broken.append(f"{path} -> {target}")
    assert not broken, "broken relative links:\n" + "\n".join(broken)


def test_archive_readme_lists_every_archived_file() -> None:
    archived = {p for p in _git("ls-files", "docs/reference") if p != "docs/reference/README.md"}
    listed = set(ARCHIVE_ENTRY.findall(ARCHIVE_README.read_text(encoding="utf-8")))
    assert archived == listed


def test_no_code_names_a_moved_document() -> None:
    still_named: list[str] = []
    for archived in ARCHIVE_ENTRY.findall(ARCHIVE_README.read_text(encoding="utf-8")):
        original = _original_path(archived)
        pattern = re.compile(rf"(?<![/\w]){re.escape(original)}")
        for line in _git("grep", "-nIF", original, "--", ".", allow_no_match=True):
            file, _, rest = line.split(":", 2)
            if not _is_excluded(file) and pattern.search(rest):
                still_named.append(f"{original} (now {archived}): {file}:{rest.strip()[:80]}")
    assert not still_named, "documents named at their old path:\n" + "\n".join(still_named)

    forms = [
        f"{file}:{rest.strip()[:80]}"
        for line in _git(
            "grep",
            "-nIE",
            r"docs/(0[1-8]-|[a-z]+)",
            "--",
            ".",
            allow_no_match=True,
        )
        for file, _, rest in [line.split(":", 2)]
        if not _is_excluded(file) and OLD_FORMS.search(rest)
    ]
    assert not forms, "moved folders or short numbered forms still named:\n" + "\n".join(forms)


def test_archive_entries_name_a_primary_replacement() -> None:
    text = ARCHIVE_README.read_text(encoding="utf-8")
    entries = ARCHIVE_LINE.findall(text)
    assert len(entries) == len(ARCHIVE_ENTRY.findall(text)), "an entry has no 'Replaced by' clause"
    for archived, replacement in entries:
        named = set(re.findall(r"`([^`]+)`", replacement))
        assert named, f"{archived}: no replacement named"
        assert named & (PRIMARY_FILES | GOVERNANCE_FILES), (
            f"{archived}: replacement is not a primary or governance file: {named}"
        )
