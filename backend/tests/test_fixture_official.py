"""The Results screen's v0.2 fixtures are what scripts/fixture_official.py writes,
so none of them is edited by hand."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.fixture_official import WRITTEN, write

FIXTURES = Path(__file__).parents[2] / "frontend" / "e2e" / "fixtures"


def test_the_writer_reproduces_the_committed_fixtures(tmp_path: Path) -> None:
    for name in WRITTEN:
        shutil.copy(FIXTURES / name, tmp_path / name)
    write(tmp_path)
    for name in WRITTEN:
        written = json.loads((tmp_path / name).read_text(encoding="utf-8"))
        committed = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        assert written == committed, name


def test_every_v0_2_fixture_names_its_method() -> None:
    summary = json.loads((FIXTURES / "results-official-summary.json").read_text())
    assert summary["method_version"] == "0.2.0"
    assert summary["summary"]["schema_version"] == "2"
    runs = json.loads((FIXTURES / "results-runs.json").read_text())
    assert {run["method_version"] for run in runs} == {"0.2.0"}
