"""Grounding the bank questions and freezing the bank (Phase 3 benchmark v2).

The planted tiny world and its ledger are generated into the test temporary
directory, so these tests run in CI with no machine-local data. The
dev-world tests run only with ``LIVE_WORLD_E2E=1``, and fail when
``data/generated/dev-seed2026`` or its ledger is missing.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from collections import Counter
from collections.abc import Callable, Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any, cast

import duckdb
import pytest
from app.config import REPO_ROOT
from app.evaluation.__main__ import main as cli_main
from app.evaluation.bank import ANCHORS_PER_QUESTION, BANK, BANK_VERSION, question_by_id
from app.evaluation.checks import (
    SCORER_VERSION,
    NumberCheck,
    SetCheck,
    TokenCheck,
    check_score,
    normalise,
)
from app.evaluation.grounders import Draft, Version, ground_l01, version_label_alias
from app.evaluation.grounding import (
    FrozenBank,
    GroundingError,
    Unavailable,
    WorldGrounding,
    freeze_bank,
    instance_from_payload,
    load_frozen_bank,
    name_anchor_order,
    sample_anchors,
    seal_bank,
    write_frozen_bank,
    write_new_bank,
)
from app.evaluation.truth_ledger import TruthLedger, TruthScenario, load_ledger
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION

from tests import live

STRUCTURAL = tuple(q for q in BANK if q.stratum != "H5")
PLANTED = tuple(q for q in BANK if q.stratum == "H5")
DEV_WORLD = REPO_ROOT / "data" / "generated" / "dev-seed2026"
DEV_LEDGER = REPO_ROOT / "data" / "truth" / "ledger.json"


def dev_world[Test: Callable[..., Any]](test: Test) -> Test:
    """Run a test on the presentation world only with LIVE_WORLD_E2E=1, and
    then fail, never skip, when that world or its ledger is missing."""
    needing = pytest.mark.usefixtures("dev_world_present")(test)
    gated = pytest.mark.skipif(not live.enabled(live.WORLD), reason="set LIVE_WORLD_E2E=1")(needing)
    return cast(Test, gated)


@pytest.fixture
def dev_world_present() -> None:
    live.require_paths(DEV_WORLD, DEV_LEDGER)


@pytest.fixture(scope="module")
def tiny_dataset(tiny_planted: tuple[Path, Path]) -> Path:
    return tiny_planted[0]


@pytest.fixture(scope="module")
def tiny_ledger(tiny_planted: tuple[Path, Path]) -> Path:
    return tiny_planted[1]


@pytest.fixture(scope="module")
def grounding(tiny_dataset: Path, tiny_ledger: Path) -> Iterator[WorldGrounding]:
    instance = WorldGrounding(tiny_dataset, tiny_ledger)
    yield instance
    instance.close()


@pytest.fixture(scope="module")
def dev_ledger() -> TruthLedger:
    return load_ledger(DEV_LEDGER)


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


def _platform_versions(tiny_dataset: Path) -> dict[str, tuple[str, str, str]]:
    rows = duckdb.execute(
        "SELECT v.platform_version_id, v.version_label, p.platform_name, p.platform_id"
        " FROM read_parquet(?) v JOIN read_parquet(?) p USING (platform_id)",
        [
            (tiny_dataset / "platform_versions.parquet").as_posix(),
            (tiny_dataset / "platforms.parquet").as_posix(),
        ],
    ).fetchall()
    return {str(r[0]): (str(r[1]), str(r[2]), str(r[3])) for r in rows}


# Scorer 2.2.0 (D-095): every question whose answer is a platform version.
@pytest.mark.parametrize("question_id", ["L02", "L07"])
def test_a_platform_version_answer_accepts_its_label_beside_its_platform(
    grounding: WorldGrounding, tiny_dataset: Path, question_id: str
) -> None:
    versions = _platform_versions(tiny_dataset)
    instances = grounding.ground(question_by_id(question_id)).instances
    assert instances
    for instance in instances:
        (check,) = instance.checks
        assert isinstance(check, TokenCheck)
        label, name, platform_id = versions[check.expected]
        assert check.qualified == ((label, (name, platform_id)),)


def test_an_app_release_answer_accepts_its_label_beside_its_market(
    grounding: WorldGrounding, tiny_dataset: Path
) -> None:
    rows = duckdb.execute(
        "SELECT a.app_version_id, a.version_label, a.market_id, m.market_name"
        " FROM read_parquet(?) a JOIN read_parquet(?) m USING (market_id)",
        [
            (tiny_dataset / "app_versions.parquet").as_posix(),
            (tiny_dataset / "markets.parquet").as_posix(),
        ],
    ).fetchall()
    releases = {str(r[0]): (str(r[1]), str(r[2]), str(r[3])) for r in rows}
    (instance,) = grounding.ground(question_by_id("L15")).instances
    (check,) = instance.checks
    assert isinstance(check, TokenCheck)
    label, market, name = releases[check.expected]
    ((alias, qualifiers),) = check.qualified
    # The market by its English name, its local name and its id.
    assert alias == label and qualifiers[0] == name and qualifiers[-1] == market


def test_every_version_id_check_accepts_a_label_beside_its_owner(
    tiny_dataset: Path, tiny_ledger: Path
) -> None:
    # A version id is a platform version (PLV_) or an app release (APPV_);
    # no check may expect one without the label rule.
    found = [
        check
        for instance in freeze_bank(tiny_dataset, tiny_ledger).instances
        for check in instance.checks
        if isinstance(check, TokenCheck) and check.expected.startswith(("PLV_", "APPV_"))
    ]
    assert found and all(check.qualified for check in found)


# Two platforms share every label in a generated world; that is the normal case.
SHARED_LABELS = {
    "PLV_WEB_1": Version("2024.1.0", ("Web Portal", "PLT_WEB")),
    "PLV_WEB_2": Version("2024.2.0", ("Web Portal", "PLT_WEB")),
    "PLV_DRAW_1": Version("2024.1.0", ("Draw Engine", "PLT_DRAW")),
}


def test_a_label_two_platforms_share_counts_beside_its_own_platform() -> None:
    assert version_label_alias(SHARED_LABELS, "PLV_WEB_1") == (
        ("2024.1.0", ("Web Portal", "PLT_WEB")),
    )
    assert version_label_alias(SHARED_LABELS, "PLV_DRAW_1") == (
        ("2024.1.0", ("Draw Engine", "PLT_DRAW")),
    )


def test_a_label_two_versions_of_one_platform_share_never_counts() -> None:
    # Label and platform would not say which of the two versions is meant.
    versions = {**SHARED_LABELS, "PLV_WEB_9": Version("2024.1.0", ("Web Portal", "PLT_WEB"))}
    assert version_label_alias(versions, "PLV_WEB_1") == ()
    assert version_label_alias(versions, "PLV_WEB_2") == (("2024.2.0", ("Web Portal", "PLT_WEB")),)


def test_a_platform_name_two_platforms_share_is_not_a_qualifier() -> None:
    versions = {
        "PLV_A_1": Version("2024.1.0", ("Portal", "PLT_A")),
        "PLV_B_1": Version("2024.1.0", ("portal", "PLT_B")),
    }
    assert version_label_alias(versions, "PLV_A_1") == (("2024.1.0", ("PLT_A",)),)


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


def _draft(code: str, concept: str, language: str) -> Draft:
    return Draft(code, code, "", (), (), concept, language)


def test_name_anchors_spread_over_languages() -> None:
    # Three concepts, each with an English code and codes in two other
    # languages; the English code is built to come first in hash order, so
    # one pick per concept by hash alone would be three English names.
    drafts = []
    for concept in ("C1", "C2", "C3"):
        others = [_draft(f"{concept}_DE", concept, "de"), _draft(f"{concept}_CS", concept, "cs")]
        english = next(
            code
            for n in range(1000)
            if sample_anchors("L13", [code := f"{concept}_EN_{n}", *(d.anchor_id for d in others)])[
                0
            ]
            == code
        )
        drafts += [_draft(english, concept, "en"), *others]
    by_hash = {d.concept: d for d in reversed(_hash_ordered(drafts))}
    assert {d.language for d in by_hash.values()} == {"en"}
    picks = name_anchor_order("L13", drafts)
    assert [d.concept for d in picks] == list(
        dict.fromkeys(d.concept for d in _hash_ordered(drafts))
    )
    assert len({d.language for d in picks}) == 3


def test_name_anchors_fall_back_to_the_first_code_when_languages_run_out() -> None:
    drafts = [_draft("A_EN", "A", "en"), _draft("B_EN", "B", "en")]
    assert [d.anchor_id for d in name_anchor_order("L13", drafts)] == [
        d.anchor_id for d in _hash_ordered(drafts)
    ]


def _hash_ordered(drafts: list[Draft]) -> list[Draft]:
    by_anchor = {d.anchor_id: d for d in drafts}
    return [by_anchor[a] for a in sample_anchors("L13", list(by_anchor), len(by_anchor))]


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


def scenario(ledger: TruthLedger, scenario_id: str) -> TruthScenario:
    return next(s for s in ledger.scenarios if s.scenario_id == scenario_id)


def test_planted_anchors_and_answers_come_from_the_ledger(
    grounding: WorldGrounding, tiny_ledger: Path
) -> None:
    ledger = load_ledger(tiny_ledger)
    cluster = sorted(scenario(ledger, "SCN-002").truth["cluster_players"])
    (instance,) = grounding.ground(question_by_id("L16")).instances
    (check,) = instance.checks
    assert instance.anchor_id == cluster[0] and instance.anchor_id in instance.text
    assert isinstance(check, SetCheck)
    assert set(cluster[1:]) <= {key for key, _ in check.universe}
    truth = scenario(ledger, "SCN-001").truth
    (instance,) = grounding.ground(question_by_id("L15")).instances
    assert instance.anchor_id == truth["incident_id"]
    (release,) = instance.checks
    assert isinstance(release, TokenCheck) and release.expected == truth["app_version_id"]


def test_planted_claims_follow_the_required_evidence(
    grounding: WorldGrounding, tiny_ledger: Path
) -> None:
    ledger = load_ledger(tiny_ledger)
    for question in PLANTED:
        assert question.scenario_id is not None
        evidence = scenario(ledger, question.scenario_id).required_evidence
        (instance,) = grounding.ground(question).instances
        expected = {e for e in evidence if e != instance.anchor_id and not e.startswith("kpi:")}
        assert {claim.claim_id for claim in instance.claims} == expected, question.question_id
        for claim in instance.claims:
            assert instance.anchor_id not in claim.carriers
            if claim.claim_id.startswith("DOC_"):
                assert all(c.startswith("CHNK_") for c in claim.carriers)
            else:
                assert claim.claim_id in claim.carriers


def test_l18_names_the_unaffected_market_and_l22_the_record_price(
    grounding: WorldGrounding, tiny_ledger: Path, tiny_dataset: Path
) -> None:
    truth = scenario(load_ledger(tiny_ledger), "SCN-007").truth
    (instance,) = grounding.ground(question_by_id("L18")).instances
    markets, unaffected = instance.checks
    assert instance.anchor_id in truth["planted_ids"]["incidents"]
    assert isinstance(markets, SetCheck) and markets.expected == set(truth["related_markets"])
    assert isinstance(unaffected, TokenCheck)
    assert unaffected.expected == truth["unaffected_markets"][0]
    (instance,) = grounding.ground(question_by_id("L22")).instances
    (price,) = instance.checks
    currency = duckdb.execute(
        "SELECT currency_code FROM read_parquet(?) WHERE game_id = ?",
        [(tiny_dataset / "games.parquet").as_posix(), instance.anchor_id],
    ).fetchall()[0][0]
    assert isinstance(price, NumberCheck) and price.unit == currency


def test_planted_grounding_is_deterministic(
    grounding: WorldGrounding, tiny_dataset: Path, tiny_ledger: Path
) -> None:
    again = WorldGrounding(tiny_dataset, tiny_ledger)
    try:
        for question in PLANTED:
            assert grounding.ground(question) == again.ground(question), question.question_id
    finally:
        again.close()


def _self_scores(bank: FrozenBank) -> dict[str, list[float]]:
    """Each instance's check scores for its own expected answer."""
    return {
        i.instance_id: [check_score(c, i.expected_answer, "") for c in i.checks]
        for i in bank.instances
    }


def test_expected_answers_score_full_marks(tiny_dataset: Path, tiny_ledger: Path) -> None:
    scores = _self_scores(freeze_bank(tiny_dataset, tiny_ledger))
    assert {k: v for k, v in scores.items() if any(s != 1.0 for s in v)} == {}


CLUSTER_QUESTIONS = (
    ("L16", "SCN-002", "player_device", "device_id", "shared_devices"),
    ("L17", "SCN-003", "player_payment_method", "payment_method_id", "shared_instruments"),
)


def test_l16_and_l17_expect_every_player_linked_to_the_anchors_shared_items(
    grounding: WorldGrounding, tiny_dataset: Path, tiny_ledger: Path
) -> None:
    ledger = load_ledger(tiny_ledger)
    for qid, sid, table, column, key in CLUSTER_QUESTIONS:
        shared = scenario(ledger, sid).truth[key]
        links = duckdb.execute(
            f"SELECT DISTINCT player_id, {column} FROM read_parquet(?)",
            [(tiny_dataset / f"{table}.parquet").as_posix()],
        ).fetchall()
        (instance,) = grounding.ground(question_by_id(qid)).instances
        mine = {item for player, item in links if player == instance.anchor_id} & set(shared)
        users = Counter(item for _, item in links)
        distractors = {p for p, item in links if users[item] >= 2} - {instance.anchor_id}
        (check,) = instance.checks
        assert isinstance(check, SetCheck)
        assert check.expected == {p for p, item in links if item in mine} - {instance.anchor_id}
        assert {key for key, _ in check.universe} == distractors


def test_naming_a_distractor_player_costs_precision(grounding: WorldGrounding) -> None:
    # The tiny world need not have distractors for both questions; at least one has.
    scores = {}
    for qid in ("L16", "L17"):
        (instance,) = grounding.ground(question_by_id(qid)).instances
        (check,) = instance.checks
        assert isinstance(check, SetCheck)
        extra = next((key for key, _ in check.universe if key not in check.expected), None)
        if extra is not None:
            answer = f"{instance.expected_answer} Also {extra}."
            scores[qid] = check_score(check, answer, "")
    assert scores and all(score < 1.0 for score in scores.values()), scores


def test_planted_game_claims_are_carried_by_the_game_record_only(
    grounding: WorldGrounding,
) -> None:
    for qid in ("L20", "L21"):
        (instance,) = grounding.ground(question_by_id(qid)).instances
        for claim in instance.claims:
            if claim.claim_id.startswith("GAME_"):
                assert claim.carriers == {claim.claim_id}, qid


def test_frozen_bank_is_byte_identical_across_groundings(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), tmp_path / "a.json")
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), tmp_path / "b.json")
    assert (tmp_path / "a.json").read_bytes() == (tmp_path / "b.json").read_bytes()


def test_frozen_bank_records_its_inputs_and_round_trips(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    bank = freeze_bank(tiny_dataset, tiny_ledger)
    manifest = (tiny_dataset / "_manifest.json").read_bytes()
    assert bank.world_manifest_hash == hashlib.sha256(manifest).hexdigest()
    assert bank.ledger_hash == hashlib.sha256(tiny_ledger.read_bytes()).hexdigest()
    assert bank.record_serialiser_version == RECORD_SERIALISER_VERSION
    assert bank.scorer_version == SCORER_VERSION
    assert (bank.bank_version, bank.world_seed) == (BANK_VERSION, 42)
    path = tmp_path / "bank.json"
    write_frozen_bank(bank, path)
    text = path.read_text(encoding="utf-8")
    assert text.endswith("}\n") and text.startswith('{\n  "bank_hash"')
    assert load_frozen_bank(path) == bank


def test_grounding_never_replaces_a_bank_file_whose_content_differs(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    # A bank file belongs to every run made with it (D-095).
    path = tmp_path / "bank.json"
    bank = freeze_bank(tiny_dataset, tiny_ledger)
    write_new_bank(bank, path)
    written = path.read_bytes()
    write_new_bank(bank, path)  # the same bank again is no change
    assert path.read_bytes() == written
    other = seal_bank(dataclasses.replace(bank, scorer_version="2.1.0"))
    with pytest.raises(GroundingError, match="holds another bank"):
        write_new_bank(other, path)
    assert path.read_bytes() == written


def test_a_bank_file_written_before_the_scorer_was_recorded_still_loads(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    # The v0.2 bank files hold no scorer_version; their hash covers what they hold.
    content = json.loads(_written(freeze_bank(tiny_dataset, tiny_ledger), tmp_path))
    del content["bank_hash"], content["scorer_version"]
    text = json.dumps(content, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    content["bank_hash"] = hashlib.sha256(text.encode()).hexdigest()
    path = tmp_path / "old.json"
    path.write_text(json.dumps(content), encoding="utf-8")
    old = load_frozen_bank(path)
    assert old.scorer_version is None and old.bank_hash == content["bank_hash"]


def _written(bank: FrozenBank, directory: Path) -> str:
    path = directory / "written.json"
    write_frozen_bank(bank, path)
    return path.read_text(encoding="utf-8")


def test_loading_a_tampered_bank_fails(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    path = tmp_path / "bank.json"
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), path)
    path.write_text(path.read_text().replace("L01", "L99", 1))
    with pytest.raises(GroundingError):
        load_frozen_bank(path)


def test_unplanted_scenarios_are_reported_not_invented(
    tiny_dataset: Path, tiny_ledger: Path
) -> None:
    bank = freeze_bank(tiny_dataset, tiny_ledger)
    planted = {i.question_id for i in bank.instances}
    assert all(u.question_id not in planted for u in bank.unavailable)


def test_a_scenario_missing_from_the_ledger_is_unavailable(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    payload = json.loads(tiny_ledger.read_text(encoding="utf-8"))
    payload["scenarios"] = [s for s in payload["scenarios"] if s["scenario_id"] != "SCN-015"]
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps(payload), encoding="utf-8")
    bank = freeze_bank(tiny_dataset, ledger)
    assert Unavailable("L22", "scenario not planted") in bank.unavailable
    assert "L22" not in {i.question_id for i in bank.instances}
    assert {i.question_id for i in bank.instances if i.stratum == "H5"} == {
        q.question_id for q in PLANTED if q.question_id != "L22"
    }


def test_ground_cli_writes_the_bank_and_prints_counts(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "bank" / "bank.json"
    args = ["ground", "--world", str(tiny_dataset), "--ledger", str(tiny_ledger)]
    assert cli_main([*args, "--out", str(out)]) == 0
    bank = load_frozen_bank(out)
    printed = capsys.readouterr().out
    planted = sum(1 for i in bank.instances if i.stratum == "H5")
    assert f"H5 planted patterns: {planted} instances" in printed
    assert bank.bank_hash in printed


def test_bank_doc_lists_every_question_and_instance(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    bank_path = tmp_path / "bank.json"
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), bank_path)
    doc_path = tmp_path / "question-bank.md"
    assert cli_main(["bank-doc", "--bank", str(bank_path), "--out", str(doc_path)]) == 0
    doc = doc_path.read_text(encoding="utf-8")
    assert "Generated by `python -m app.evaluation bank-doc`; do not edit." in doc.splitlines()[:3]
    assert "\u2014" not in doc
    for question in BANK:
        assert f"### {question.question_id}" in doc
    for instance in load_frozen_bank(bank_path).instances:
        assert instance.text in doc and instance.expected_answer in doc
    assert f"Scorer version: `{SCORER_VERSION}`." in doc
    # Scorer 2.2.0 (D-095): the page names what else an L02 check accepts.
    for instance in load_frozen_bank(bank_path).instances:
        for check in instance.checks:
            if isinstance(check, TokenCheck):
                for alias, qualifiers in check.qualified:
                    names = " or ".join(qualifiers)
                    assert f"  - Also accepted: {alias} with {names}." in doc


@dev_world
def test_planted_questions_ground_one_instance_per_scenario(
    dev_grounding: WorldGrounding,
) -> None:
    for question in PLANTED:
        outcome = dev_grounding.ground(question)
        assert len(outcome.instances) == 1 and outcome.instances[0].claims, question.question_id


@dev_world
def test_scn015_expects_the_authoritative_price(
    dev_grounding: WorldGrounding, dev_ledger: TruthLedger
) -> None:
    truth = scenario(dev_ledger, "SCN-015").truth
    check = dev_grounding.ground(question_by_id("L22")).instances[0].checks[0]
    assert isinstance(check, NumberCheck) and check.value == normalise(truth["authoritative_price"])


@dev_world
def test_dev_world_expected_answers_score_full_marks() -> None:
    scores = _self_scores(freeze_bank(DEV_WORLD, DEV_LEDGER))
    assert {k: v for k, v in scores.items() if any(s != 1.0 for s in v)} == {}


@dev_world
def test_dev_world_distractor_players_cost_precision(dev_grounding: WorldGrounding) -> None:
    for qid in ("L16", "L17"):
        (instance,) = dev_grounding.ground(question_by_id(qid)).instances
        (check,) = instance.checks
        assert isinstance(check, SetCheck)
        extra = next(key for key, _ in check.universe if key not in check.expected)
        assert check_score(check, f"{instance.expected_answer} Also {extra}.", "") < 1.0, qid


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


def test_a_ledger_of_another_world_seed_is_refused(
    tiny_dataset: Path, tiny_ledger: Path, tmp_path: Path
) -> None:
    payload = json.loads(tiny_ledger.read_text(encoding="utf-8"))
    payload["world"]["world_seed"] = 43
    ledger = tmp_path / "ledger.json"
    ledger.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(GroundingError, match=r"world seed 43.*world seed 42"):
        freeze_bank(tiny_dataset, ledger)


def _rehashed(content: dict[str, object]) -> str:
    """A bank file whose bank_hash matches its (possibly malformed) content."""
    canonical = json.dumps(content, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    bank_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return json.dumps({**content, "bank_hash": bank_hash}, sort_keys=True, indent=2) + "\n"


@pytest.mark.parametrize(
    "break_content",
    [
        lambda c: c["instances"][0].pop("text"),  # KeyError
        lambda c: c.__setitem__("unavailable", 7),  # TypeError
        lambda c: c.__setitem__("world_seed", "forty-two"),  # ValueError
    ],
)
def test_a_malformed_but_correctly_hashed_bank_is_a_grounding_error(
    tiny_dataset: Path,
    tiny_ledger: Path,
    tmp_path: Path,
    break_content: Callable[[dict[str, Any]], object],
) -> None:
    path = tmp_path / "bank.json"
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), path)
    content = json.loads(path.read_text(encoding="utf-8"))
    content.pop("bank_hash")
    break_content(content)
    path.write_text(_rehashed(content), encoding="utf-8")
    with pytest.raises(GroundingError, match="malformed"):
        load_frozen_bank(path)
