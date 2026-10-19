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
ALPHA = 0.05

_COMPARISON_NAMES = {
    "B_vs_A": ("Graph", "text search"),
    "C_vs_B": ("Graph + Ontology", "Graph"),
}


@dataclass(frozen=True)
class Interval:
    mean: float
    low: float
    high: float
    n: int
    clusters: int


def cluster_bootstrap(
    diffs: Sequence[float],
    clusters: Sequence[str],
    resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = BOOTSTRAP_SEED,
) -> Interval:
    """Percentile interval for the mean difference, resampling whole clusters with replacement."""
    if not diffs or len(diffs) != len(clusters):
        raise ValueError("diffs and clusters must be non-empty and the same length")
    grouped: dict[str, list[float]] = defaultdict(list)
    for diff, cluster in zip(diffs, clusters, strict=True):
        grouped[cluster].append(diff)
    groups = list(grouped.values())
    rng = random.Random(seed)
    means: list[float] = []
    for _ in range(resamples):
        pooled = [d for group in rng.choices(groups, k=len(groups)) for d in group]
        means.append(statistics.mean(pooled))
    means.sort()
    tail = (1 - CONFIDENCE) / 2
    return Interval(
        mean=statistics.mean(diffs),
        low=means[math.floor(tail * resamples)],
        high=means[math.ceil((1 - tail) * resamples) - 1],
        n=len(diffs),
        clusters=len(groups),
    )


def wilcoxon_p(diffs: Sequence[float]) -> float:
    """Two-sided Wilcoxon signed-rank p-value with Pratt zero handling."""
    if all(d == 0 for d in diffs):
        return 1.0
    return float(wilcoxon(diffs, zero_method="pratt", alternative="two-sided").pvalue)


def holm(pvalues: Mapping[str, float]) -> dict[str, float]:
    """Holm step-down adjusted p-values: monotone and capped at 1."""
    ordered = sorted(pvalues.items(), key=lambda item: item[1])
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (name, p) in enumerate(ordered):
        running = max(running, min(1.0, (len(ordered) - rank) * p))
        adjusted[name] = running
    return adjusted


def headline(
    comparison: str,
    stratum_label: str,
    metric_unit: str,
    interval: Interval,
    p_holm: float | None,
) -> str:
    """Plain-language sentence for one comparison in one stratum."""
    stronger, weaker = _COMPARISON_NAMES[comparison]
    pairs = f"{interval.n} pairs"
    if interval.n < MIN_PAIRS_FOR_CLAIM:
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
    points = f"{abs(interval.mean) * 100:.1f}"
    bounds = f"{interval.low * 100:.1f} to {interval.high * 100:.1f}"
    return (
        f"{stronger} {verb} {weaker} by {points} {metric_unit} "
        f"(95 percent interval {bounds}, {pairs}) on {stratum_label}."
    )
