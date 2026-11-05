"""The Results screen's run fixtures are what scripts/fixture_official.py writes,
so none of them is edited by hand."""

from __future__ import annotations

import json
from pathlib import Path

from app.config import METHOD_VERSION
from scripts.fixture_official import WRITTEN, write

FIXTURES = Path(__file__).parents[2] / "frontend" / "e2e" / "fixtures"


def test_the_writer_reproduces_the_committed_fixtures(tmp_path: Path) -> None:
    write(tmp_path)
    for name in WRITTEN:
        written = json.loads((tmp_path / name).read_text(encoding="utf-8"))
        committed = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        assert written == committed, name


def test_every_fixture_run_is_of_the_current_method() -> None:
    """D-104: the API serves runs of the current method only, so the fixtures do too."""
    runs = json.loads((FIXTURES / "results-runs.json").read_text())
    assert {run["method_version"] for run in runs} == {METHOD_VERSION}
    for name in ("results-official-summary.json", "results-pilot-summary.json"):
        summary = json.loads((FIXTURES / name).read_text())
        assert summary["method_version"] == METHOD_VERSION
        assert summary["summary"]["schema_version"] == "3"
