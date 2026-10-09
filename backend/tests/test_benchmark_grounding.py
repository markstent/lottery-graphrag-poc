"""Grounding tests against a generated tiny world (offline, no services).

Grounding reads only the parquet world and the truth ledger, so these tests
run in CI. The tiny world is generated without planted scenarios while the
ledger on disk belongs to the development world, which exercises the
NOT_PLANTED and NOT_GROUNDED paths deterministically.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.world import TABLE_SCHEMAS, build_world
from app.evaluation.bank import BANK, question_by_id
from app.evaluation.grounding import GroundedQuestion, WorldGrounding


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world-grounding")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def grounding(tiny_dataset: Path) -> Iterator[WorldGrounding]:
    instance = WorldGrounding(tiny_dataset)
    yield instance
    instance.close()


def test_base_question_grounds_with_concrete_ids(grounding: WorldGrounding) -> None:
    grounded = grounding.ground(question_by_id("Q01"))
    assert grounded.status == "ok"
    assert grounded.text != grounded.question.template  # anchor filled in
    assert "GAME_UK_" in grounded.text
    assert grounded.checks and grounded.checks[0][0] == "number"
    assert grounded.required_evidence


def test_unplanted_scenario_is_reported_not_scored(grounding: WorldGrounding) -> None:
    grounded = grounding.ground(question_by_id("Q17"))
    assert grounded.status == "not_planted"
    assert grounded.checks == ()
    assert grounded.note


def test_scenario_ids_missing_from_the_world_do_not_ground(grounding: WorldGrounding) -> None:
    # SCN-007 exists in the dev-world ledger but the tiny world has no
    # planted incidents, so validation must refuse to ground.
    grounded = grounding.ground(question_by_id("Q25"))
    assert grounded.status == "not_grounded"
    assert grounded.note


def test_grounding_is_deterministic(grounding: WorldGrounding, tiny_dataset: Path) -> None:
    first = grounding.ground(question_by_id("Q26"))
    second = WorldGrounding(tiny_dataset).ground(question_by_id("Q26"))
    assert (first.text, first.checks, first.required_evidence) == (
        second.text,
        second.checks,
        second.required_evidence,
    )
    assert first.status == "ok"


def test_whole_bank_resolves_without_raising(grounding: WorldGrounding) -> None:
    statuses = {question.question_id: grounding.ground(question).status for question in BANK}
    assert set(statuses.values()) <= {"ok", "not_planted", "not_grounded"}
    assert statuses["Q17"] == "not_planted"


def test_grounded_texts_never_contain_ledger_only_clusters() -> None:
    # Question text is pipeline-visible: it must not leak truth-ledger
    # detail such as cluster membership lists (ADR-008 companion rule).
    for question in BANK:
        assert "PLAYER_GR_001" not in question.template
        assert "cluster_players" not in question.template


def test_evidence_only_questions_have_no_checks(grounding: WorldGrounding) -> None:
    grounded: GroundedQuestion = grounding.ground(question_by_id("Q05"))
    if grounded.status == "ok":
        assert grounded.checks == ()
        assert grounded.note  # the report explains evidence-only grading
