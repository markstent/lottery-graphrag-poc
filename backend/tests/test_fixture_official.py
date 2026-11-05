"""The Results screen's run fixtures are what scripts/fixture_official.py writes,
so none of them is edited by hand."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
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


def test_the_official_fixture_draws_every_band_hatching_and_extra_records() -> None:
    """The official fixture run's outcomes cover what the Outcomes views draw: right,
    partly right and wrong answers, some in each band that said the sources could not
    answer, and extra records, the same for every pipeline so nothing suggests a
    direction; its mean answer score stays 0.4."""
    outcomes = json.loads((FIXTURES / "results-outcomes.json").read_text())["fixture-official"]
    answers = outcomes["answers"]
    evidence = outcomes["evidence"]
    assert answers["A"] == answers["B"] == answers["C"]
    assert evidence["A"] == evidence["B"] == evidence["C"]
    cell = answers["A"]
    for band in ("right", "partly", "wrong"):
        assert cell[band] > 0, band
        assert 0 < cell[f"{band}_declined"] < cell[band], band
    assert (cell["right"] + cell["partly_score_sum"]) / cell["scored"] == pytest.approx(0.4)
    assert evidence["A"]["extra_per_question"] >= 10
    summary = json.loads((FIXTURES / "results-official-summary.json").read_text())
    overall = summary["summary"]["metrics"]["overall"]["answer"]
    for tag in "ABC":
        assert overall[tag]["mean"] == pytest.approx(0.4), tag
