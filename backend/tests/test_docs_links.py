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

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
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
        for target in LINK.findall(text):
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
