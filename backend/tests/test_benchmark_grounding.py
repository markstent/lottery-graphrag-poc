"""Grounding the structural bank questions (Phase 3 benchmark v2, Task 5).

The tiny world and its ledger are generated into the test temporary
directory, so these tests run in CI with no machine-local data. The
dev-world test runs only where ``data/generated/dev-seed2026`` exists.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest
from app.datasets.config import REPO_ROOT, GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.evaluation.bank import ANCHORS_PER_QUESTION, BANK, question_by_id
from app.evaluation.checks import NumberCheck, SetCheck
from app.evaluation.grounders import ground_l01
from app.evaluation.grounding import (
    GroundingError,
    WorldGrounding,
    instance_from_payload,
    sample_anchors,
)
from app.scenarios.engine import apply_scenarios
from app.scenarios.ledger import build_ledger, write_ledger

STRUCTURAL = tuple(q for q in BANK if q.stratum != "H5")
DEV_WORLD = REPO_ROOT / "data" / "generated" / "dev-seed2026"
DEV_LEDGER = REPO_ROOT / "data" / "truth" / "ledger.json"
dev_world = pytest.mark.skipif(
    not (DEV_WORLD.is_dir() and DEV_LEDGER.is_file()), reason="dev world not generated"
)


@pytest.fixture(scope="module")
def tiny_dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    dataset_dir = tmp_path_factory.mktemp("tiny-world-grounding")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def tiny_ledger(tmp_path_factory: pytest.TempPathFactory) -> Path:
    planted = build_world(GenerationConfig(profile="tiny", world_seed=42))
    ledger_path = tmp_path_factory.mktemp("tiny-ledger") / "ledger.json"
    write_ledger(ledger_path, build_ledger(apply_scenarios(planted), planted))
    return ledger_path


@pytest.fixture(scope="module")
def grounding(tiny_dataset: Path, tiny_ledger: Path) -> Iterator[WorldGrounding]:
    instance = WorldGrounding(tiny_dataset, tiny_ledger)
    yield instance
    instance.close()


@pytest.fixture(scope="module")
def dev_grounding() -> Iterator[WorldGrounding]:
    instance = WorldGrounding(DEV_WORLD, DEV_LEDGER)
    yield instance
    instance.close()


def test_structural_questions_ground_with_sampled_anchors(grounding: WorldGrounding) -> None:
    outcome = grounding.ground(question_by_id("L01"))
    assert 1 <= len(outcome.instances) <= ANCHORS_PER_QUESTION
    assert all("{" not in instance.text for instance in outcome.instances)


def test_anchor_sampling_is_a_stable_hash_order() -> None:
    assert sample_anchors("L01", ["GAME_B", "GAME_A", "GAME_C"]) == sample_anchors(
        "L01", ["GAME_C", "GAME_A", "GAME_B"]
    )


def test_anchor_sampling_depends_on_the_question() -> None:
    anchors = [f"GAME_{n:02d}" for n in range(20)]
    assert sample_anchors("L01", anchors) != sample_anchors("L04", anchors)
    assert len(sample_anchors("L01", anchors)) == ANCHORS_PER_QUESTION


def test_h1_and_h2_instances_score_discoveries_only(grounding: WorldGrounding) -> None:
    for qid in ("L05", "L06", "L07", "L08", "L09", "L10", "L11", "L12", "L13", "L14"):
        for instance in grounding.ground(question_by_id(qid)).instances:
            assert instance.claims, instance.instance_id
            assert all(instance.anchor_id not in claim.carriers for claim in instance.claims)


def test_name_anchored_text_carries_a_local_name(grounding: WorldGrounding) -> None:
    instance = grounding.ground(question_by_id("L13")).instances[0]
    assert instance.anchor_id.startswith("FAM_") and instance.anchor_id not in instance.text


def test_name_anchored_universe_covers_games_in_every_market(grounding: WorldGrounding) -> None:
    for qid in ("L13", "L14"):
        for instance in grounding.ground(question_by_id(qid)).instances:
            assert instance.anchor_id not in instance.text
            (check,) = instance.checks
            assert isinstance(check, SetCheck)
            markets = {key.split("_")[1] for key, _ in check.universe}
            assert markets == {"UK", "GR", "AT", "CZ"}


def test_sets_hold_between_one_and_six_members(grounding: WorldGrounding) -> None:
    for question in STRUCTURAL:
        for instance in grounding.ground(question).instances:
            for check in instance.checks:
                if isinstance(check, SetCheck):
                    assert 1 <= len(check.expected) <= 6, instance.instance_id
                    assert instance.anchor_id not in check.expected
                    assert check.expected <= {key for key, _ in check.universe}


def test_market_universe_names_markets_in_english_and_locally(grounding: WorldGrounding) -> None:
    (check,) = grounding.ground(question_by_id("L05")).instances[0].checks
    assert isinstance(check, SetCheck)
    universe = dict(check.universe)
    assert universe["MKT_GR"] == ("Greece", "Ελλάδα")
    assert universe["MKT_UK"] == ("United Kingdom",)


def test_l01_expects_the_record_price(grounding: WorldGrounding, tiny_dataset: Path) -> None:
    path = (tiny_dataset / "games.parquet").as_posix()
    for instance in grounding.ground(question_by_id("L01")).instances:
        price, currency = duckdb.execute(
            "SELECT ticket_price, currency_code FROM read_parquet(?) WHERE game_id = ?",
            [path, instance.anchor_id],
        ).fetchall()[0]
        (check,) = instance.checks
        assert check == NumberCheck(format(Decimal(price).normalize(), "f"), currency)
        assert f"{price:.2f} {currency}" in instance.expected_answer


def test_grounding_is_deterministic(
    grounding: WorldGrounding, tiny_dataset: Path, tiny_ledger: Path
) -> None:
    again = WorldGrounding(tiny_dataset, tiny_ledger)
    try:
        for question in STRUCTURAL:
            assert grounding.ground(question) == again.ground(question), question.question_id
    finally:
        again.close()


def test_instances_round_trip_through_payloads(grounding: WorldGrounding) -> None:
    for question in STRUCTURAL:
        for instance in grounding.ground(question).instances:
            assert instance_from_payload(instance.to_payload()) == instance
            assert instance.instance_id == f"{question.question_id}-42-{instance.anchor_id}"


def test_outcome_note_records_the_eligible_count(grounding: WorldGrounding) -> None:
    outcome = grounding.ground(question_by_id("L01"))
    assert outcome.eligible == 20
    assert outcome.note == "20 eligible anchors"


def test_l04_scores_the_answer_alone(grounding: WorldGrounding) -> None:
    outcome = grounding.ground(question_by_id("L04"))
    assert outcome.instances and all(not i.claims for i in outcome.instances)


def test_segment_claims_are_carried_by_segment_records_only(grounding: WorldGrounding) -> None:
    for instance in grounding.ground(question_by_id("L11")).instances:
        for claim in instance.claims:
            assert claim.carriers == {claim.claim_id}


def test_name_anchored_instances_never_share_an_answer(grounding: WorldGrounding) -> None:
    for qid in ("L13", "L14"):
        outcome = grounding.ground(question_by_id(qid))
        answers = [instance.checks for instance in outcome.instances]
        assert len(set(answers)) == len(answers), qid
        assert "one per concept" in outcome.note


def test_cross_market_anchors_have_a_market_of_their_own(
    grounding: WorldGrounding, tiny_dataset: Path
) -> None:
    path = (tiny_dataset / "incidents.parquet").as_posix()
    corporate = {
        str(row[0])
        for row in duckdb.execute(
            "SELECT incident_id FROM read_parquet(?) WHERE market_id IS NULL", [path]
        ).fetchall()
    }
    for qid in ("L05", "L10"):
        assert (
            not {i.anchor_id for i in grounding.ground(question_by_id(qid)).instances} & corporate
        )


def test_planted_questions_have_no_structural_grounder(grounding: WorldGrounding) -> None:
    with pytest.raises(GroundingError, match="L15"):
        grounding.ground(question_by_id("L15"))


@dev_world
def test_dev_world_meets_the_structural_counts(dev_grounding: WorldGrounding) -> None:
    counts = Counter(i.question_id for q in STRUCTURAL for i in dev_grounding.ground(q).instances)
    assert all(counts[q.question_id] == ANCHORS_PER_QUESTION for q in STRUCTURAL)


@dev_world
def test_dev_world_price_carriers_state_the_price(dev_grounding: WorldGrounding) -> None:
    # Every game, not only the sampled ones: a support case or incident
    # carries a price claim only when its text states that price.
    index = dev_grounding._index
    for draft in ground_l01(dev_grounding._world):
        (spec,) = draft.specs
        two_decimal = spec.markers[1][0]
        for carrier in index.carriers(spec):
            if carrier.startswith(("SUP_", "INC_")):
                assert two_decimal in index.texts[carrier], (draft.anchor_id, carrier)


@dev_world
def test_dev_world_corporate_incidents_count_in_their_games_markets(
    dev_grounding: WorldGrounding,
) -> None:
    instance = next(
        i for i in dev_grounding.ground(question_by_id("L05")).instances if i.anchor_id == "INC_033"
    )
    (check,) = instance.checks
    assert isinstance(check, SetCheck) and "MKT_CZ" in check.expected


@dev_world
def test_dev_world_segment_claims_have_no_player_carrier(dev_grounding: WorldGrounding) -> None:
    for instance in dev_grounding.ground(question_by_id("L11")).instances:
        assert all(
            not carrier.startswith("PLAYER_")
            for claim in instance.claims
            for carrier in claim.carriers
        )
