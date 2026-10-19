import math
import random
from typing import Any

import pytest
from app.evaluation.statistics import (
    MIN_CLUSTERS_FOR_CLAIM,
    Interval,
    cluster_bootstrap,
    headline,
    holm,
    subgroup_line,
    wilcoxon_p,
)


def test_constant_differences_give_a_degenerate_interval() -> None:
    interval = cluster_bootstrap([0.2] * 12, [f"c{i % 4}" for i in range(12)])
    assert (interval.mean, interval.low, interval.high, interval.n, interval.clusters) == (
        0.2,
        0.2,
        0.2,
        12,
        4,
    )


def test_bootstrap_is_seeded() -> None:
    diffs, clusters = [0.1, -0.2, 0.3, 0.0, 0.5, 0.1], ["a", "a", "b", "b", "c", "c"]
    assert cluster_bootstrap(diffs, clusters) == cluster_bootstrap(diffs, clusters)


def test_clustering_widens_the_interval_for_correlated_instances() -> None:
    diffs = [1.0, 1.0, 1.0, -1.0, -1.0, -1.0] * 2
    clustered = cluster_bootstrap(diffs, ["a"] * 3 + ["b"] * 3 + ["c"] * 3 + ["d"] * 3)
    independent = cluster_bootstrap(diffs, [str(i) for i in range(12)])
    assert clustered.high - clustered.low > independent.high - independent.low


def test_bootstrap_rejects_empty_and_mismatched_input() -> None:
    with pytest.raises(ValueError):
        cluster_bootstrap([], [])
    with pytest.raises(ValueError):
        cluster_bootstrap([0.1, 0.2], ["a"])


def test_wilcoxon_all_zero_is_one() -> None:
    assert wilcoxon_p([0.0] * 12, [str(i) for i in range(12)]) == 1.0


def test_holm_matches_the_textbook_example() -> None:
    assert holm({"a": 0.01, "b": 0.04, "c": 0.03}) == pytest.approx(
        {"a": 0.03, "b": 0.06, "c": 0.06}
    )


def test_headline_forms() -> None:
    interval = Interval(0.123, 0.041, 0.202, 36, 12)
    assert headline("B_vs_A", "multi-hop questions", "evidence points", interval, 0.01) == (
        "Graph exceeds text search by 12.3 evidence points "
        "(95 percent interval 4.1 to 20.2, 36 pairs in 12 groups) on multi-hop questions."
    )
    assert headline(
        "C_vs_B", "single facts", "answer points", Interval(0.0, -0.1, 0.1, 36, 12), 0.9
    ) == (
        "No detectable difference between Graph + Ontology and Graph "
        "on single facts (36 pairs in 12 groups)."
    )
    assert headline(
        "B_vs_A", "planted patterns", "evidence points", Interval(0.5, 0.4, 0.6, 8, 8), None
    ).startswith("Too few pairs")


def test_headline_trails_and_significance_gate() -> None:
    trailing = Interval(-0.03, -0.051, -0.009, 36, 12)
    assert headline("B_vs_A", "single facts", "evidence points", trailing, 0.01) == (
        "Graph trails text search by 3.0 evidence points "
        "(95 percent interval -5.1 to -0.9, 36 pairs in 12 groups) on single facts."
    )
    assert headline("B_vs_A", "single facts", "evidence points", trailing, 0.2).startswith(
        "No detectable difference"
    )


def test_headline_rejects_missing_p_value_with_enough_pairs() -> None:
    with pytest.raises(ValueError):
        headline("B_vs_A", "single facts", "evidence points", Interval(0.1, 0.0, 0.2, 36, 12), None)


def test_single_cluster_gives_the_too_few_form() -> None:
    diffs = [0.1, 0.3, 0.5] * 4
    interval = cluster_bootstrap(diffs, ["a"] * 12)
    assert interval.low == interval.high
    assert headline("B_vs_A", "single facts", "evidence points", interval, 0.001) == (
        "Too few pairs to say for Graph and text search on single facts (12 pairs in 1 group)."
    )


def test_counts_are_singular_for_one() -> None:
    assert (
        headline("B_vs_A", "single facts", "evidence points", Interval(0.1, 0.1, 0.1, 1, 1), None)
        == "Too few pairs to say for Graph and text search on single facts (1 pair in 1 group)."
    )


def test_subgroup_line_reports_the_interval_and_runs_no_test() -> None:
    interval = Interval(0.04, -0.03, 0.11, 18, 6)
    assert subgroup_line("B_vs_A", "name-anchored questions", "evidence points", interval) == (
        "Name-anchored questions: Graph minus text search 4.0 evidence points "
        "(95 percent interval -3.0 to 11.0, 18 pairs in 6 groups); "
        "no test is run on this sub-group."
    )
    assert subgroup_line("C_vs_B", "name-anchored questions", "evidence points", None) == (
        "Name-anchored questions: no pairs for Graph + Ontology minus Graph; "
        "no test is run on this sub-group."
    )


def test_wilcoxon_runs_on_cluster_means() -> None:
    clusters = ["a", "a", "b", "c", "d", "e", "f"]
    # cluster means 2, 1, 3, 4, 5, 6 are all positive: exact two-sided p = 2 / 2**6
    assert wilcoxon_p([1.0, 3.0, 1.0, 3.0, 4.0, 5.0, 6.0], clusters) == pytest.approx(0.03125)
    # twelve correlated pairs in one cluster are one observation, not twelve
    assert wilcoxon_p([0.1, 0.3, 0.5] * 4, ["a"] * 12) == pytest.approx(1.0)
    # clusters whose means cancel to zero give 1.0
    assert wilcoxon_p([1.0, -1.0, 2.0, -2.0], ["a", "a", "b", "b"]) == 1.0


def test_non_finite_inputs_are_rejected() -> None:
    for bad in (math.nan, math.inf):
        with pytest.raises(ValueError):
            cluster_bootstrap([0.1, bad], ["a", "b"])
        with pytest.raises(ValueError):
            wilcoxon_p([0.1, bad], ["a", "b"])
        with pytest.raises(ValueError):
            holm({"a": bad})


def test_negative_zero_prints_as_zero() -> None:
    text = headline(
        "C_vs_B", "single facts", "evidence points", Interval(0.02, -0.0001, 0.05, 36, 12), 0.001
    )
    assert text == (
        "No detectable difference between Graph + Ontology and Graph "
        "on single facts (36 pairs in 12 groups)."
    )
    interval = Interval(-0.0001, -0.1, -0.0001, 36, 12)
    assert "interval -10.0 to 0.0," in headline("B_vs_A", "x", "u", interval, 0.001)


def test_percentile_indices_for_ten_thousand_resamples() -> None:
    # R = 10_000 must pick sorted indices 250 and 9749 (floor(0.025 R), ceil(0.975 R) - 1).
    interval = cluster_bootstrap([0.0, 1.0], ["a", "b"], resamples=10_000)
    assert (interval.low, interval.high) == (0.0, 1.0)
    from app.evaluation import statistics as module

    assert 10_000 * module._TAIL_PER_MILLE // 1000 == 250
    assert -(-10_000 * (1000 - module._TAIL_PER_MILLE) // 1000) - 1 == 9749


def test_unknown_comparison_raises_value_error() -> None:
    with pytest.raises(ValueError):
        headline("D_vs_A", "x", "u", Interval(0.1, 0.0, 0.2, 36, 12), 0.01)


def test_subgroup_line_gives_no_interval_below_the_cluster_floor() -> None:
    """Two groups cannot carry a 95 percent interval: the mean alone is printed."""
    interval = Interval(0.04, -0.03, 0.11, 4, 2)
    assert subgroup_line("B_vs_A", "name-anchored questions", "evidence points", interval) == (
        "Name-anchored questions: Graph minus text search 4.0 evidence points, "
        "too few groups for an interval (4 pairs in 2 groups); "
        "no test is run on this sub-group."
    )
    at_floor = Interval(0.04, -0.03, 0.11, 6, MIN_CLUSTERS_FOR_CLAIM)
    assert "95 percent interval" in subgroup_line("B_vs_A", "x", "u", at_floor)


def test_holm_caps_adjusted_p_values_at_one() -> None:
    assert holm({"a": 0.6, "b": 0.7, "c": 0.02}) == pytest.approx({"a": 1.0, "b": 1.0, "c": 0.06})


def test_holm_gives_tied_p_values_the_same_adjustment_in_any_order() -> None:
    expected = {"a": 0.03, "b": 0.03, "c": 0.04}
    assert holm({"a": 0.01, "b": 0.01, "c": 0.04}) == pytest.approx(expected)
    assert holm({"c": 0.04, "b": 0.01, "a": 0.01}) == pytest.approx(expected)


def test_each_resample_draws_as_many_clusters_as_were_observed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    drawn: list[int] = []

    class CountingRandom(random.Random):
        def choices(self, population: Any, *args: Any, k: int = 1, **kwargs: Any) -> list[Any]:
            drawn.append(k)
            return super().choices(population, *args, k=k, **kwargs)

    monkeypatch.setattr(random, "Random", CountingRandom)
    interval = cluster_bootstrap([0.1, 0.2, 0.3, 0.4, 0.5], ["a", "a", "b", "c", "c"], resamples=50)
    assert interval.clusters == 3
    assert drawn == [3] * 50
