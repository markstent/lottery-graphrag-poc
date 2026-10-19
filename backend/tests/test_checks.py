"""Deterministic answer checks and citation metrics (benchmark v2, Task 2)."""

from __future__ import annotations

import pytest
from app.evaluation.checks import (
    Check,
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
    check = SetCheck.of({"MKT_GR", "MKT_AT"}, universe)
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
    check = SetCheck.of({"MKT_GR"}, {"MKT_GR": ("Greece",)})
    assert check_from_payload(check.to_payload()) == check


# Readings the brief leaves open, pinned here.


@pytest.mark.parametrize(
    ("unit", "answer"),
    [
        ("GBP", "It costs GBP 2.50 and 4 lines."),
        ("EUR", "It costs € 2.50 and 4 lines."),
        ("CZK", "It costs 2,50 Kč and 4 lines."),
        ("%", "Uptake rose 2.5% over 4 weeks."),
    ],
)
def test_unit_adjacency_ignores_at_most_one_space_on_either_side(unit: str, answer: str) -> None:
    assert check_score(NumberCheck("2.5", unit), "", answer) == 1.0


def test_a_number_run_into_a_unit_code_is_not_a_number() -> None:
    assert scored_numbers("It costs 2.50GBP and 4 lines.") == ["4"]


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
    check = SetCheck.of({"MKT_GR"}, universe)
    assert check_score(check, "", "mkt_gr only.") == 1.0
    assert check_score(check, "", "Greeces and Austrian markets.") == 0.0


def test_token_check_accepts_an_alias() -> None:
    check = TokenCheck("MKT_CZ", ("Czech Republic",))
    assert check_score(check, "", "Only the czech republic.") == 1.0
    assert check_score(check, "", "Only MKT_CZX.") == 0.0


def test_answer_score_is_the_mean_and_none_without_checks() -> None:
    checks: list[Check] = [TokenCheck("MKT_GR"), VerdictCheck("yes")]
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


# Fix round 1 rulings.


@pytest.mark.parametrize(
    ("text", "numbers"),
    [
        ("12,500 players", ["12500"]),
        ("1,234.56 GBP", ["1234.56"]),
        ("2,50 EUR", ["2.5"]),
        ("1,250,000 tickets", ["1250000"]),
        ("1,2345 units", ["1.2345"]),
    ],
)
def test_a_comma_before_exactly_three_digits_groups_thousands(
    text: str, numbers: list[str]
) -> None:
    assert scored_numbers(text) == numbers


def test_an_iso_date_does_not_swallow_the_next_number() -> None:
    answer = "On 2025-06-30 3 incidents were logged"
    assert check_score(NumberCheck("3", None), "", answer) == 1.0
    assert check_score(NumberCheck("2.5", "GBP"), "", "as of 2025-06-30 2.50 GBP") == 1.0


@pytest.mark.parametrize(
    "text",
    [
        "2025-06-30T12:00:00Z",
        "2025-06-30 12:00",
        "2025-06-30T12:00:00.5+01:00",
        "30 June 2025",
        "30th Jun 2025",
        "June 30, 2025",
        "Sept. 3 2025",
    ],
)
def test_dates_and_times_are_not_numbers(text: str) -> None:
    assert scored_numbers(text) == []


def test_an_english_date_is_removed_before_the_count() -> None:
    assert scored_numbers("As of 30 June 2025 there were 12 incidents") == ["12"]


@pytest.mark.parametrize("text", ["Q2", "FY2025", "v2", "H1", "game_uk_01", "REC-1234", "a.5"])
def test_numbers_inside_words_are_not_numbers(text: str) -> None:
    assert scored_numbers(text) == []


@pytest.mark.parametrize(
    ("text", "numbers"),
    [("-5 GBP", ["-5"]), ("fell by -2.50", ["-2.5"]), ("(-3)", ["-3"]), ("- 4 items", ["4"])],
)
def test_a_leading_minus_is_a_sign(text: str, numbers: list[str]) -> None:
    assert scored_numbers(text) == numbers


def test_an_expected_value_that_is_not_a_number_is_an_error() -> None:
    with pytest.raises(ValueError, match="not a number"):
        check_score(NumberCheck("two", None), "", "2")


def test_names_match_on_unicode_word_boundaries() -> None:
    check = SetCheck.of({"SEG_ACTIVE"}, {"SEG_ACTIVE": ("Ενεργοί",), "SEG_OTHER": ()})
    assert check_score(check, "", "Ανενεργοί παίκτες") == 0.0
    assert check_score(check, "", "Ενεργοί παίκτες") == 1.0
    assert check_score(NumberCheck("250", "CZK"), "", "250 Kčs and 3 Kč") == 0.0


def test_an_alias_shared_by_two_ids_identifies_neither() -> None:
    universe = {"SEG_CZ_VIP": ("VIP",), "SEG_GR_VIP": ("vip",)}
    check = SetCheck.of({"SEG_CZ_VIP"}, universe)
    assert check_score(check, "", "The Czech VIP segment") == 0.0
    assert check_score(check, "", "The SEG_CZ_VIP segment") == 1.0


def test_every_check_is_hashable() -> None:
    checks = [
        NumberCheck("2.5", "GBP"),
        SetCheck.of({"MKT_GR"}, {"MKT_GR": ["Greece"]}),
        TokenCheck("MKT_CZ", ("Czech Republic",)),
        VerdictCheck("yes"),
    ]
    assert len({hash(check) for check in checks}) == len(checks)


def test_set_check_universe_is_sorted_by_id() -> None:
    check = SetCheck.of({"B"}, {"B": ["Bee"], "A": ["Ay"]})
    assert check.universe == (("A", ("Ay",)), ("B", ("Bee",)))


def test_list_lines_are_sentences() -> None:
    metrics = citation_metrics("- 2.50 GBP\n- 7 items\n- 9 more [1]", [1], [frozenset()], [])
    assert metrics.numeric_citation_rate == pytest.approx(1 / 3)


def test_a_trailing_citation_joins_the_sentence_before() -> None:
    metrics = citation_metrics("Price 2.50 GBP. [1]", [1], [frozenset()], [])
    assert metrics.numeric_citation_rate == 1.0


def test_verdict_ignores_leading_markdown_and_quotes() -> None:
    assert check_score(VerdictCheck("yes"), "**Yes** - it is digital.", "") == 1.0
    assert check_score(VerdictCheck("no"), '"No."', "") == 1.0


def test_a_verdict_payload_must_be_yes_or_no() -> None:
    with pytest.raises(ValueError, match="'yes' or 'no'"):
        check_from_payload({"kind": "verdict", "expected": "maybe"})
