"""Paired-difference statistics: clustered bootstrap, Wilcoxon, Holm, headlines."""

import math
import random
import statistics
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from scipy.stats import wilcoxon

BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_SEED = 2026
CONFIDENCE = 0.95
MIN_PAIRS_FOR_CLAIM = 10
MIN_CLUSTERS_FOR_CLAIM = (
    6  # fewest clusters at which a two-sided signed-rank test can reach p < 0.05
)
ALPHA = 0.05

COMPARISON_NAMES = {
    "B_vs_A": ("Graph", "text search"),
    "C_vs_B": ("Graph + Ontology", "Graph"),
}


# Each tail of the interval holds this many thousandths of the resamples (25 for 95 percent).
_TAIL_PER_MILLE = round((1 - CONFIDENCE) / 2 * 1000)


@dataclass(frozen=True)
class Interval:
    mean: float
    low: float
    high: float
    n: int
    clusters: int


def _check_paired(diffs: Sequence[float], clusters: Sequence[str]) -> None:
    if not diffs or len(diffs) != len(clusters):
        raise ValueError("diffs and clusters must be non-empty and the same length")
    if not all(math.isfinite(d) for d in diffs):
        raise ValueError("diffs must be finite")


def _group(diffs: Sequence[float], clusters: Sequence[str]) -> list[list[float]]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for diff, cluster in zip(diffs, clusters, strict=True):
        grouped[cluster].append(diff)
    return list(grouped.values())


def cluster_bootstrap(
    diffs: Sequence[float],
    clusters: Sequence[str],
    resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = BOOTSTRAP_SEED,
) -> Interval:
    """Percentile interval for the mean difference, resampling whole clusters with replacement."""
    _check_paired(diffs, clusters)
    groups = _group(diffs, clusters)
    rng = random.Random(seed)
    means: list[float] = []
    for _ in range(resamples):
        pooled = [d for group in rng.choices(groups, k=len(groups)) for d in group]
        means.append(statistics.mean(pooled))
    means.sort()
    return Interval(
        mean=statistics.mean(diffs),
        low=means[resamples * _TAIL_PER_MILLE // 1000],
        high=means[-(-resamples * (1000 - _TAIL_PER_MILLE) // 1000) - 1],
        n=len(diffs),
        clusters=len(groups),
    )


def wilcoxon_p(diffs: Sequence[float], clusters: Sequence[str]) -> float:
    """Two-sided Wilcoxon signed-rank p-value (Pratt) on per-cluster mean differences.

    The independent unit is the cluster, so pairs are averaged within each cluster first.
    """
    _check_paired(diffs, clusters)
    means = [statistics.mean(group) for group in _group(diffs, clusters)]
    if all(m == 0 for m in means):
        return 1.0
    return float(wilcoxon(means, zero_method="pratt", alternative="two-sided").pvalue)


def holm(pvalues: Mapping[str, float]) -> dict[str, float]:
    """Holm step-down adjusted p-values: monotone and capped at 1."""
    if not all(math.isfinite(p) for p in pvalues.values()):
        raise ValueError("p-values must be finite")
    ordered = sorted(pvalues.items(), key=lambda item: item[1])
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (name, p) in enumerate(ordered):
        running = max(running, min(1.0, (len(ordered) - rank) * p))
        adjusted[name] = running
    return adjusted


def points(value: float) -> str:
    """Difference as points with one decimal; negative zero prints as 0.0."""
    return f"{value * 100:.1f}".replace("-0.0", "0.0")


def _counts(n: int, clusters: int) -> str:
    pairs = "pair" if n == 1 else "pairs"
    groups = "group" if clusters == 1 else "groups"
    return f"{n} {pairs} in {clusters} {groups}"


def _names(comparison: str) -> tuple[str, str]:
    if comparison not in COMPARISON_NAMES:
        raise ValueError(f"unknown comparison: {comparison}")
    return COMPARISON_NAMES[comparison]


def headline(
    comparison: str,
    stratum_label: str,
    metric_unit: str,
    interval: Interval,
    p_holm: float | None,
) -> str:
    """Plain-language sentence for one comparison in one stratum."""
    stronger, weaker = _names(comparison)
    pairs = _counts(interval.n, interval.clusters)
    if interval.n < MIN_PAIRS_FOR_CLAIM or interval.clusters < MIN_CLUSTERS_FOR_CLAIM:
        return f"Too few pairs to say for {stronger} and {weaker} on {stratum_label} ({pairs})."
    if p_holm is None:
        raise ValueError("p_holm is required when there are enough pairs for a claim")
    significant = p_holm < ALPHA
    if significant and interval.low > 0:
        verb = "exceeds"
    elif significant and interval.high < 0:
        verb = "trails"
    else:
        return (
            f"No detectable difference between {stronger} and {weaker} "
            f"on {stratum_label} ({pairs})."
        )
    return (
        f"{stronger} {verb} {weaker} by {points(abs(interval.mean))} {metric_unit} "
        f"(95 percent interval {points(interval.low)} to {points(interval.high)}, {pairs}) "
        f"on {stratum_label}."
    )


def subgroup_line(
    comparison: str, stratum_label: str, metric_unit: str, interval: Interval | None
) -> str:
    """Descriptive sentence for a sub-group that is not tested: the interval and nothing more.

    ``interval`` is None when the sub-group has no pairs.
    """
    stronger, weaker = _names(comparison)
    label = stratum_label[:1].upper() + stratum_label[1:]
    if interval is None:
        return f"{label}: no pairs for {stronger} minus {weaker}; no test is run on this sub-group."
    return (
        f"{label}: {stronger} minus {weaker} {points(interval.mean)} {metric_unit} "
        f"(95 percent interval {points(interval.low)} to {points(interval.high)}, "
        f"{_counts(interval.n, interval.clusters)}); no test is run on this sub-group."
    )
