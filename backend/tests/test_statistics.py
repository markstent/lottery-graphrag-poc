import pytest
from app.evaluation.statistics import (
    Interval,
    cluster_bootstrap,
    headline,
    holm,
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
    assert wilcoxon_p([0.0] * 12) == 1.0


def test_holm_matches_the_textbook_example() -> None:
    assert holm({"a": 0.01, "b": 0.04, "c": 0.03}) == pytest.approx(
        {"a": 0.03, "b": 0.06, "c": 0.06}
    )


def test_headline_forms() -> None:
    interval = Interval(0.123, 0.041, 0.202, 36, 12)
    assert headline("B_vs_A", "multi-hop questions", "evidence points", interval, 0.01) == (
        "Graph exceeds text search by 12.3 evidence points "
        "(95 percent interval 4.1 to 20.2, 36 pairs) on multi-hop questions."
    )
    assert headline(
        "C_vs_B", "single facts", "answer points", Interval(0.0, -0.1, 0.1, 36, 12), 0.9
    ) == ("No detectable difference between Graph + Ontology and Graph on single facts (36 pairs).")
    assert headline(
        "B_vs_A", "planted patterns", "evidence points", Interval(0.5, 0.4, 0.6, 8, 8), None
    ).startswith("Too few pairs")


def test_headline_trails_and_significance_gate() -> None:
    trailing = Interval(-0.03, -0.051, -0.009, 36, 12)
    assert headline("B_vs_A", "single facts", "evidence points", trailing, 0.01) == (
        "Graph trails text search by 3.0 evidence points "
        "(95 percent interval -5.1 to -0.9, 36 pairs) on single facts."
    )
    assert headline("B_vs_A", "single facts", "evidence points", trailing, 0.2).startswith(
        "No detectable difference"
    )


def test_headline_rejects_missing_p_value_with_enough_pairs() -> None:
    with pytest.raises(ValueError):
        headline("B_vs_A", "single facts", "evidence points", Interval(0.1, 0.0, 0.2, 36, 12), None)
