"""Benchmark bank integrity tests (docs/05-benchmark-spec.md section 2 and 15)."""

from __future__ import annotations

import string

from app.evaluation.bank import BANK, CATEGORY_DIFFICULTY, BankQuestion

# docs/05 section 2 allocation: 4 questions in each of the first six
# categories, 6 in the cross-market/ontology/pattern bucket.
EXPECTED_ALLOCATION: dict[str, int] = {
    "FACT": 4,
    "SEMANTIC": 4,
    "RELATIONSHIP": 4,
    "TWO_HOP": 4,
    "MULTI_HOP": 4,
    "CROSS_DOMAIN": 4,
    "CROSS_MARKET": 2,
    "ONTOLOGY": 2,
    "PATTERN": 1,
    "TEMPORAL_ONTOLOGY": 1,
}

KNOWN_SCENARIOS = {f"SCN-{number:03d}" for number in range(1, 16)}
SUPPORTED_PLACEHOLDERS = {"anchor", "target_date", "week_start"}


def test_thirty_questions_with_unique_ids() -> None:
    assert len(BANK) == 30
    ids = [question.question_id for question in BANK]
    assert ids == [f"Q{number:02d}" for number in range(1, 31)]
    assert len(set(ids)) == 30


def test_category_allocation_matches_spec() -> None:
    counts: dict[str, int] = {}
    for question in BANK:
        counts[question.category] = counts.get(question.category, 0) + 1
    assert counts == EXPECTED_ALLOCATION


def test_difficulty_defined_for_every_category() -> None:
    for question in BANK:
        assert question.category in CATEGORY_DIFFICULTY
        assert 1 <= CATEGORY_DIFFICULTY[question.category] <= 6


def test_templates_use_supported_placeholders_only() -> None:
    for question in BANK:
        placeholders = {
            word for _, word, _, _ in string.Formatter().parse(question.template) if word
        }
        assert placeholders <= SUPPORTED_PLACEHOLDERS, question.question_id


def test_scenario_references_are_known_catalogue_ids() -> None:
    for question in BANK:
        if question.scenario_id is not None:
            assert question.scenario_id in KNOWN_SCENARIOS, question.question_id


def test_fraud_profile_only_on_the_pattern_question() -> None:
    for question in BANK:
        if question.profile is not None:
            assert question.question_id == "Q28"
            assert question.profile == "fraud"


def test_binding_keys_are_unique() -> None:
    keys = [question.binding_key for question in BANK]
    assert len(set(keys)) == len(keys)


def test_markets_use_iso_style_codes() -> None:
    for question in BANK:
        assert question.markets
        assert all(len(market) == 2 and market.isupper() for market in question.markets)


def test_question_by_id_round_trip() -> None:
    question: BankQuestion = BANK[0]
    from app.evaluation.bank import question_by_id

    assert question_by_id(question.question_id) is question
