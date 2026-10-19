"""Deterministic answer checks and citation metrics (benchmark v2, Task 2)."""

from __future__ import annotations

import pytest
from app.evaluation.checks import (
    NumberCheck,
    SetCheck,
    TokenCheck,
    VerdictCheck,
    answer_score,
    check_from_payload,
    check_score,
    citation_metrics,
    scored_numbers,
)
from app.evaluation.claims import Claim


def test_number_check_reads_the_unit_adjacent_value() -> None:
    assert check_score(NumberCheck("2.5", "GBP"), "", "It costs £2.50 per line [1].") == 1.0


def test_number_check_penalises_a_contradictory_number() -> None:
    answer = "The price is 2.50 GBP [1]; the rules document still says 3.00 GBP [2]."
    assert check_score(NumberCheck("2.5", "GBP"), "", answer) == 0.5


def test_identifiers_dates_and_citations_are_not_numbers() -> None:
    assert scored_numbers("GAME_UK_01 on 2025-06-30 [3] costs 2.50") == ["2.5"]


def test_set_check_is_f1_against_the_universe() -> None:
    universe = {"MKT_GR": ("Greece",), "MKT_AT": ("Austria",), "MKT_CZ": ("Czech Republic",)}
    check = SetCheck(frozenset({"MKT_GR", "MKT_AT"}), universe)
    assert check_score(check, "", "Greece and the Czech Republic.") == pytest.approx(0.5)


def test_fact_in_the_verdict_counts() -> None:
    assert (
        check_score(TokenCheck("PLV_PAYMENTS_3"), "PLV_PAYMENTS_3", "See the incident report.")
        == 1.0
    )


def test_verdict_check_reads_the_verdict_only() -> None:
    assert check_score(VerdictCheck("yes"), "Yes, it is digital.", "no") == 1.0
    assert check_score(VerdictCheck("yes"), "unknown", "yes") == 0.0


def test_citation_metrics() -> None:
    claims = [Claim("c1", "price", frozenset({"REC_A"}))]
    metrics = citation_metrics(
        "Price 2.50 [1]. Other 7 items.", [1, 2], [frozenset({"REC_A"}), frozenset({"X"})], claims
    )
    assert metrics.accuracy == 0.5 and metrics.numeric_citation_rate == 0.5


def test_check_payload_round_trip() -> None:
    check = SetCheck(frozenset({"MKT_GR"}), {"MKT_GR": ("Greece",)})
    assert check_from_payload(check.to_payload()) == check


# Readings the brief leaves open, pinned here.


@pytest.mark.parametrize(
    ("unit", "answer"),
    [
        ("GBP", "It costs 2.50GBP and 4 lines."),
        ("GBP", "It costs GBP 2.50 and 4 lines."),
        ("EUR", "It costs € 2.50 and 4 lines."),
        ("CZK", "It costs 2,50 Kč and 4 lines."),
        ("%", "Uptake rose 2.5% over 4 weeks."),
    ],
)
def test_unit_adjacency_ignores_at_most_one_space_on_either_side(unit: str, answer: str) -> None:
    assert check_score(NumberCheck("2.5", unit), "", answer) == 1.0


def test_unit_two_spaces_away_is_not_adjacent() -> None:
    # No unit-adjacent number, so every scored number is a candidate.
    assert check_score(NumberCheck("2.5", "GBP"), "", "It costs 2.50  GBP and 4 lines.") == 0.5


def test_unit_code_inside_a_word_is_not_a_unit() -> None:
    assert check_score(NumberCheck("2.5", "GBP"), "", "2.50 GBPX and 3 GBP.") == 0.0


def test_number_check_without_a_unit_uses_every_scored_number() -> None:
    assert check_score(NumberCheck("7", None), "", "There are 7 games [2].") == 1.0
    assert check_score(NumberCheck("7", None), "", "There are 7 games and 8 draws.") == 0.5


def test_number_check_scores_zero_when_the_value_is_missing() -> None:
    assert check_score(NumberCheck("2.5", "GBP"), "", "It costs £3.00.") == 0.0


def test_a_repeated_value_is_not_a_contradiction() -> None:
    assert check_score(NumberCheck("2.5", "GBP"), "", "£2.50 [1], confirmed as 2.5 GBP [2].") == 1.0


def test_verdict_word_must_be_whole() -> None:
    assert check_score(VerdictCheck("no"), "Not stated in the evidence.", "") == 0.0
    assert check_score(VerdictCheck("no"), "  No.", "") == 1.0


def test_set_check_matches_ids_and_whole_words_only() -> None:
    universe = {"MKT_GR": ("Greece",), "MKT_AT": ("Austria",)}
    check = SetCheck(frozenset({"MKT_GR"}), universe)
    assert check_score(check, "", "mkt_gr only.") == 1.0
    assert check_score(check, "", "Greeces and Austrian markets.") == 0.0


def test_token_check_accepts_an_alias() -> None:
    check = TokenCheck("MKT_CZ", ("Czech Republic",))
    assert check_score(check, "", "Only the czech republic.") == 1.0
    assert check_score(check, "", "Only MKT_CZX.") == 0.0


def test_answer_score_is_the_mean_and_none_without_checks() -> None:
    checks = [TokenCheck("MKT_GR"), VerdictCheck("yes")]
    assert answer_score(checks, "No", "MKT_GR") == 0.5
    assert answer_score([], "Yes", "MKT_GR") is None


def test_citation_metrics_are_none_without_citations_claims_or_numbers() -> None:
    claims = [Claim("c1", "price", frozenset({"REC_A"}))]
    no_citation = citation_metrics("No numbers here.", [], [frozenset({"REC_A"})], claims)
    assert no_citation.accuracy is None and no_citation.numeric_citation_rate is None
    no_claims = citation_metrics("Price 2.50 [1].", [1], [frozenset({"REC_A"})], [])
    assert no_claims.accuracy is None and no_claims.numeric_citation_rate == 1.0


def test_a_citation_to_a_missing_block_is_inaccurate() -> None:
    claims = [Claim("c1", "price", frozenset({"REC_A"}))]
    metrics = citation_metrics("Price [1] [3].", [1, 3], [frozenset({"REC_A"})], claims)
    assert metrics.accuracy == 0.5


@pytest.mark.parametrize(
    "check",
    [
        NumberCheck("2.5", "GBP"),
        NumberCheck("7", None),
        TokenCheck("MKT_CZ", ("Czech Republic",)),
        VerdictCheck("no"),
    ],
)
def test_every_check_kind_round_trips(
    check: NumberCheck | TokenCheck | VerdictCheck,
) -> None:
    assert check_from_payload(check.to_payload()) == check


def test_unknown_check_kind_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown check kind"):
        check_from_payload({"kind": "judge"})
