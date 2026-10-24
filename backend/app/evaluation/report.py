"""``summary.json`` v2 and ``report.md`` for a benchmark run (Phase 3 benchmark v2).

``summarize`` is the only place a benchmark number is computed: per-stratum
means, clustered paired comparisons with Holm over the declared family,
generated headlines, judge agreement and failure counts. ``render_report``
renders that summary as Markdown and computes nothing of its own.

An observation is one bank instance in one world. Its value for a metric and
pipeline is the mean over that pipeline's repeats where the metric is
defined; a failed generation (a None score) is excluded from every metric.
A pair exists when both compared pipelines have a value, and pairs cluster
by logical question and world.

Evaluator-only (ADR-008): retrieval code never imports this module. The API
publishes the written ``summary.json`` from disk; only its benchmark routes
import this module, for ``SUMMARY_SCHEMA_VERSION``.
"""

from __future__ import annotations

import dataclasses
import statistics
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from app.evaluation.bank import STRATA
from app.evaluation.grounding import BankInstance
from app.evaluation.judge import JUDGE_DIMENSIONS, agreement, judge_pairs
from app.evaluation.runner import (
    PIPELINES,
    SMOKE_LABEL,
    BenchmarkRun,
    InstanceResult,
    PipelineRun,
    RunScore,
)
from app.evaluation.statistics import (
    MIN_CLUSTERS_FOR_CLAIM,
    MIN_PAIRS_FOR_CLAIM,
    Interval,
    cluster_bootstrap,
    headline,
    holm,
    points,
    subgroup_line,
    wilcoxon_p,
)

SUMMARY_SCHEMA_VERSION = "2"
SMOKE_HEADLINE = (
    "Scorer smoke test: the fake generator answers from titles only; "
    "these numbers are not a result."
)
# H2 splits into its id-anchored cell ("H2") and its name-anchored sub-group.
STRATUM_KEYS = ("H1", "H2", "H2_name", "H3", "H5")
OVERALL = "overall"
STRATUM_LABELS = {
    "H1": STRATA["H1"],
    "H2": f"{STRATA['H2']} anchored by id",
    "H2_name": "name-anchored questions",
    "H3": STRATA["H3"],
    "H5": STRATA["H5"],
    OVERALL: "every question",
}
COMPARISONS = {"B_vs_A": ("B", "A"), "C_vs_B": ("C", "B")}
COMPARED_METRICS = ("evidence_f1", "answer")
METRIC_UNITS = {"evidence_f1": "evidence points", "answer": "answer points"}
# The headline metric of each tested stratum.
PRIMARY_METRIC = {"H1": "evidence_f1", "H2": "evidence_f1", "H3": "answer", "H5": "evidence_f1"}
HOLM_FAMILY = frozenset(
    {
        ("H1", "evidence_f1"),
        ("H2", "evidence_f1"),
        ("H5", "evidence_f1"),
        ("H1", "answer"),
        ("H2", "answer"),
        ("H3", "answer"),
        ("H5", "answer"),
    }
)
# The two groups of the ontology-dependent split, by the instance flag.
ONTOLOGY_GROUPS = {"ontology_dependent": True, "other": False}
REASON_WORDS = {
    "tested": "tested",
    "too_few": "not tested: too few pairs or groups",
    "not_in_family": "not tested: outside the family",
}
# Pipeline A resolves no entities, so its anchor resolution reads the selection only.
ANCHOR_RESOLUTION_BASIS = {"A": "selection", "B": "resolution", "C": "resolution"}

Extractor = Callable[[RunScore, PipelineRun], float | None]


def _judge_dimension(dimension: str) -> Extractor:
    def value(score: RunScore, _run: PipelineRun) -> float | None:
        if score.judge is None or score.judge.scores is None:
            return None
        return float(getattr(score.judge.scores, dimension))

    return value


METRICS: dict[str, Extractor] = {
    "evidence_f1": lambda s, _r: s.evidence.f1,
    "evidence_recall": lambda s, _r: s.evidence.recall,
    "evidence_precision": lambda s, _r: s.evidence.precision,
    "efficiency_per_1k": lambda s, _r: s.evidence.efficiency_per_1k,
    "anchor_resolution": lambda s, _r: float(s.evidence.anchor_resolved),
    "answer": lambda s, _r: s.answer,
    "citation_accuracy": lambda s, _r: s.citations.accuracy,
    "numeric_citation_rate": lambda s, _r: s.citations.numeric_citation_rate,
    "latency_ms": lambda _s, r: r.latency_ms,
    "context_tokens": lambda _s, r: float(r.context_tokens),
    **{f"judge_{d}": _judge_dimension(d) for d in JUDGE_DIMENSIONS},
}


@dataclass(frozen=True, slots=True)
class _Observation:
    """One instance: its stratum key, its cluster and, per metric and
    pipeline, the mean over the repeats that define it and their count."""

    stratum: str
    cluster: str
    ontology_dependent: bool
    values: dict[str, dict[str, tuple[float, int]]]


@dataclass(slots=True)
class _Comparison:
    stratum: str
    metric: str
    comparison: str
    interval: Interval | None
    n: int
    clusters: int
    p: float | None
    p_holm: float | None
    in_family: bool
    reason: str

    def to_payload(self) -> dict[str, Any]:
        interval = self.interval
        return {
            "stratum": self.stratum,
            "metric": self.metric,
            "comparison": self.comparison,
            "n": self.n,
            "clusters": self.clusters,
            "mean": None if interval is None else interval.mean,
            "low": None if interval is None else interval.low,
            "high": None if interval is None else interval.high,
            "p": self.p,
            "p_holm": self.p_holm,
            "in_family": self.in_family,
            "reason": self.reason,
        }


def stratum_key(instance: BankInstance) -> str:
    if instance.stratum == "H2" and instance.sub_stratum == "name_anchored":
        return "H2_name"
    return instance.stratum


def summarize(run: BenchmarkRun) -> dict[str, Any]:
    """The machine-readable result of a run, written as ``summary.json``."""
    results = [result for world in run.worlds for result in world.results]
    pipelines = _pipelines(results)
    observations = [_observe(result) for result in results]
    comparisons = _comparisons(observations)
    smoke = run.kind == "smoke"
    return {
        "schema_version": SUMMARY_SCHEMA_VERSION,
        "run_kind": run.kind,
        "label": SMOKE_LABEL if smoke else run.label,
        "bank_version": run.record.bank_version,
        "worlds": [world.world_seed for world in run.worlds],
        "instances": {
            "total": _stratum_counts(r.instance for r in results),
            "per_world": {
                str(world.world_seed): _stratum_counts(r.instance for r in world.results)
                for world in run.worlds
            },
        },
        "unavailable": {
            str(world.world_seed): [dataclasses.asdict(u) for u in world.unavailable]
            for world in run.worlds
        },
        "anchor_resolution_basis": {tag: ANCHOR_RESOLUTION_BASIS[tag] for tag in pipelines},
        "metrics": metric_tables(results),
        "comparisons": [c.to_payload() for c in comparisons],
        "ontology_split": _ontology_split(observations),
        "headlines": [SMOKE_HEADLINE] if smoke else _headlines(comparisons),
        "judge_agreement": _judge_agreement(results, pipelines),
        "failures": _failures(results, pipelines),
        "selection": run.selection.to_payload(),
        "reproducibility": run.reproducibility(),
    }


def metric_tables(
    results: Sequence[InstanceResult],
) -> dict[str, dict[str, dict[str, dict[str, Any]]]]:
    """Per stratum key and overall, per metric and pipeline: the mean over
    instances, the instance count ``n`` and the scored ``repeats``."""
    observations = [_observe(result) for result in results]
    pipelines = _pipelines(results)
    return {
        key: _metric_table([o for o in observations if key in (o.stratum, OVERALL)], pipelines)
        for key in (*STRATUM_KEYS, OVERALL)
    }


def _pipelines(results: Sequence[InstanceResult]) -> list[str]:
    return [tag for tag in PIPELINES if any(tag in r.scores for r in results)]


def _defined_values(result: InstanceResult) -> dict[str, dict[str, list[float]]]:
    """Per pipeline and metric, the values of the repeats where it is defined."""
    return {
        tag: {
            metric: [
                value
                for score, run in zip(scores, result.runs[tag], strict=True)
                if score is not None and (value := extract(score, run)) is not None
            ]
            for metric, extract in METRICS.items()
        }
        for tag, scores in result.scores.items()
    }


def _means(
    defined: dict[str, dict[str, list[float]]],
) -> dict[str, dict[str, float | None]]:
    return {
        tag: {
            metric: statistics.mean(values) if values else None
            for metric, values in metrics.items()
        }
        for tag, metrics in defined.items()
    }


def instance_means(result: InstanceResult) -> dict[str, dict[str, float | None]]:
    """Per pipeline, the mean over its successful repeats of every metric
    (None where no repeat defines it). This is the value a pair is made of."""
    return _means(_defined_values(result))


def _observe(result: InstanceResult) -> _Observation:
    defined = _defined_values(result)
    values: dict[str, dict[str, tuple[float, int]]] = {metric: {} for metric in METRICS}
    for tag, per_metric in _means(defined).items():
        for metric, mean in per_metric.items():
            if mean is not None:
                values[metric][tag] = (mean, len(defined[tag][metric]))
    instance = result.instance
    return _Observation(
        stratum_key(instance),
        f"{instance.question_id}:{instance.world_seed}",
        instance.ontology_dependent,
        values,
    )


def _stratum_counts(instances: Iterable[BankInstance]) -> dict[str, int]:
    counts = Counter(stratum_key(instance) for instance in instances)
    return {**{key: counts[key] for key in STRATUM_KEYS}, OVERALL: counts.total()}


def _metric_table(
    observations: Sequence[_Observation], pipelines: Sequence[str]
) -> dict[str, dict[str, dict[str, Any]]]:
    table: dict[str, dict[str, dict[str, Any]]] = {}
    for metric in METRICS:
        table[metric] = {}
        for tag in pipelines:
            cells = [o.values[metric][tag] for o in observations if tag in o.values[metric]]
            table[metric][tag] = {
                "mean": statistics.mean(mean for mean, _ in cells) if cells else None,
                "n": len(cells),
                "repeats": sum(repeats for _, repeats in cells),
            }
    return table


@dataclass(frozen=True, slots=True)
class _Paired:
    """The paired differences of one cell, with the numbers every output reads."""

    diffs: list[float]
    clusters: list[str]
    n: int
    groups: int
    interval: Interval | None
    too_few: bool


def _pairs(observations: Sequence[_Observation], metric: str, x: str, y: str) -> _Paired:
    """The paired differences x minus y, their clusters, the bootstrap interval
    (whenever there is a pair) and the pairs and groups gate."""
    diffs: list[float] = []
    clusters: list[str] = []
    for o in observations:
        value = o.values[metric]
        if x in value and y in value:
            diffs.append(value[x][0] - value[y][0])
            clusters.append(o.cluster)
    n, groups = len(diffs), len(set(clusters))
    return _Paired(
        diffs,
        clusters,
        n,
        groups,
        cluster_bootstrap(diffs, clusters) if diffs else None,
        n < MIN_PAIRS_FOR_CLAIM or groups < MIN_CLUSTERS_FOR_CLAIM,
    )


def _comparisons(observations: Sequence[_Observation]) -> list[_Comparison]:
    """Every compared cell; p and the Holm p only for cells in the family
    that pass both the pairs gate and the groups gate."""
    cells: list[_Comparison] = []
    for stratum in STRATUM_KEYS:
        members = [o for o in observations if o.stratum == stratum]
        for metric in COMPARED_METRICS:
            for comparison, (x, y) in COMPARISONS.items():
                paired = _pairs(members, metric, x, y)
                if (stratum, metric) not in HOLM_FAMILY:
                    reason = "not_in_family"
                elif paired.too_few:
                    reason = "too_few"
                else:
                    reason = "tested"
                in_family = reason == "tested"
                cells.append(
                    _Comparison(
                        stratum=stratum,
                        metric=metric,
                        comparison=comparison,
                        interval=paired.interval,
                        n=paired.n,
                        clusters=paired.groups,
                        p=wilcoxon_p(paired.diffs, paired.clusters) if in_family else None,
                        p_holm=None,
                        in_family=in_family,
                        reason=reason,
                    )
                )
    family = {str(i): c.p for i, c in enumerate(cells) if c.p is not None}
    for i, adjusted in holm(family).items():
        cells[int(i)].p_holm = adjusted
    return cells


def _ontology_split(observations: Sequence[_Observation]) -> list[dict[str, Any]]:
    """B versus A and C versus B on the ontology-dependent questions and on the
    rest, grouped by the instance flag across every stratum. Descriptive: the
    cells are never in the Holm family, so p and the Holm p are always None."""
    cells: list[dict[str, Any]] = []
    for group, flag in ONTOLOGY_GROUPS.items():
        members = [o for o in observations if o.ontology_dependent is flag]
        for metric in COMPARED_METRICS:
            for comparison, (x, y) in COMPARISONS.items():
                paired = _pairs(members, metric, x, y)
                interval = paired.interval
                cells.append(
                    {
                        "group": group,
                        "metric": metric,
                        "comparison": comparison,
                        "n": paired.n,
                        "clusters": paired.groups,
                        "mean": None if interval is None else interval.mean,
                        "low": None if interval is None else interval.low,
                        "high": None if interval is None else interval.high,
                        "p": None,
                        "p_holm": None,
                        "in_family": False,
                        "reason": "too_few" if paired.too_few else "not_in_family",
                    }
                )
    return cells


def _headlines(comparisons: Sequence[_Comparison]) -> list[str]:
    cells = {(c.stratum, c.metric, c.comparison): c for c in comparisons}
    lines = []
    for stratum, metric in PRIMARY_METRIC.items():
        for comparison in COMPARISONS:
            cell = cells[(stratum, metric, comparison)]
            # A cell without pairs takes the "too few" form, which reads only n and clusters.
            interval = cell.interval or Interval(0.0, 0.0, 0.0, 0, 0)
            lines.append(
                headline(
                    comparison, STRATUM_LABELS[stratum], METRIC_UNITS[metric], interval, cell.p_holm
                )
            )
    for comparison in COMPARISONS:
        cell = cells[("H2_name", "evidence_f1", comparison)]
        lines.append(
            subgroup_line(
                comparison, STRATUM_LABELS["H2_name"], METRIC_UNITS["evidence_f1"], cell.interval
            )
        )
    return lines


def _judge_agreement(results: Sequence[InstanceResult], pipelines: Sequence[str]) -> dict[str, Any]:
    def scores(tags: Sequence[str]) -> list[RunScore | None]:
        return [s for r in results for tag in tags for s in r.scores.get(tag, [])]

    return {
        "overall": dataclasses.asdict(agreement(judge_pairs(scores(pipelines)))),
        "pipelines": {
            tag: dataclasses.asdict(agreement(judge_pairs(scores([tag])))) for tag in pipelines
        },
    }


def _failures(results: Sequence[InstanceResult], pipelines: Sequence[str]) -> dict[str, Any]:
    per = {tag: [s for r in results for s in r.scores.get(tag, [])] for tag in pipelines}
    scored = {tag: [s for s in scores if s is not None] for tag, scores in per.items()}
    return {
        "repeats": {tag: len(scores) for tag, scores in per.items()},
        "generation": {tag: sum(s is None for s in scores) for tag, scores in per.items()},
        "judge": {
            tag: sum(s.judge is not None and s.judge.failure is not None for s in scores)
            for tag, scores in scored.items()
        },
        "classes": {
            tag: dict(sorted(Counter(s.failure_class for s in scores if s.failure_class).items()))
            for tag, scores in scored.items()
        },
    }


def render_report(run: BenchmarkRun) -> str:
    """``report.md``: the numbers of ``summarize``, rendered."""
    summary = summarize(run)
    record = summary["reproducibility"]["run"]
    lines = [
        "# Benchmark run",
        "",
        f"Run kind: {summary['run_kind']}.",
        *([f"Label: {summary['label']}."] if summary["label"] else []),
        f"Selection: {run.selection.describe()}.",
        f"Bank version {summary['bank_version']}, worlds "
        f"{', '.join(str(seed) for seed in summary['worlds'])}.",
        f"Run started: {record['started_at']} (when the first world started).",
        "",
        "## Headlines",
        "",
        *[f"- {line}" for line in summary["headlines"]],
        "",
    ]
    for key in (*STRATUM_KEYS, OVERALL):
        lines += _stratum_section(summary, key)
    lines += _comparison_section(summary["comparisons"], smoke=run.kind == "smoke")
    lines += _ontology_split_section(summary["ontology_split"])
    lines += _agreement_section(summary["judge_agreement"])
    lines += _failure_section(summary["failures"], summary["unavailable"])
    lines += reproducibility_section(summary["reproducibility"])
    return "\n".join(lines) + "\n"


def reproducibility_section(reproducibility: dict[str, Any]) -> list[str]:
    """The run's shared record, then what differs in each world.

    ``started_at`` differs between worlds, so it is listed per world; the
    run's start (its first world's) is printed above the report.
    """
    shared = {k: v for k, v in reproducibility["run"].items() if k != "started_at"}
    lines = ["## Reproducibility", "", "Shared by every world:", ""]
    lines += [f"- {name}: `{value}`" for name, value in shared.items()]
    for world in reproducibility["worlds"]:
        own = {k: v for k, v in world.items() if k not in shared or shared[k] != v}
        lines += ["", f"### World {world['world_seed']}", ""]
        lines += [f"- {name}: `{value}`" for name, value in own.items()] or ["- as above"]
    return [*lines, ""]


def _stratum_section(summary: dict[str, Any], key: str) -> list[str]:
    table = summary["metrics"][key]
    pipelines = list(summary["anchor_resolution_basis"])
    lines = [
        f"## {key}: {STRATUM_LABELS[key]}",
        "",
        f"Instances: {summary['instances']['total'][key]}.",
        "",
        "| Metric | " + " | ".join(pipelines) + " |",
        "|---" * (len(pipelines) + 1) + "|",
    ]
    for metric, cells in table.items():
        row = []
        for tag in pipelines:
            cell = cells[tag]
            basis = (
                ", selection only"
                if metric == "anchor_resolution"
                and summary["anchor_resolution_basis"][tag] == "selection"
                else ""
            )
            row.append(
                "-"
                if cell["mean"] is None
                else f"{_number(metric, cell['mean'])} (n {cell['n']}{basis})"
            )
        lines.append(f"| {metric} | " + " | ".join(row) + " |")
    return [*lines, ""]


def _comparison_section(comparisons: Sequence[dict[str, Any]], smoke: bool) -> list[str]:
    """The comparisons table; a smoke run's tested cells say they are not a result."""
    words = (
        {**REASON_WORDS, "tested": "tested (smoke run, not a result)"} if smoke else REASON_WORDS
    )
    lines = [
        "## Comparisons",
        "",
        "Differences in points (one point is 0.01 on the 0 to 1 scale); "
        "p is Wilcoxon on group means, Holm-adjusted over the family.",
        "",
        "| Stratum | Metric | Comparison | Pairs | Groups | Mean | 95 percent interval "
        "| p | Holm p | Test |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for c in comparisons:
        if c["mean"] is None:
            mean, interval = "-", "-"
        else:
            mean, interval = points(c["mean"]), f"{points(c['low'])} to {points(c['high'])}"
        lines.append(
            f"| {c['stratum']} | {c['metric']} | {c['comparison']} | {c['n']} | {c['clusters']} "
            f"| {mean} | {interval} | {_p(c['p'])} | {_p(c['p_holm'])} "
            f"| {words[c['reason']]} |"
        )
    return [*lines, ""]


def _ontology_split_section(cells: Sequence[dict[str, Any]]) -> list[str]:
    lines = [
        "## Ontology-dependent split",
        "",
        "Descriptive only: outside the Holm family, so no p values and no claim. "
        "Questions are grouped by the ontology-dependent flag across every stratum. "
        "Differences in points, with the 95 percent cluster bootstrap interval.",
        "",
        "| Group | Metric | Comparison | Pairs | Groups | Mean | 95 percent interval | Note |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for c in cells:
        if c["mean"] is None:
            mean, interval = "-", "-"
        else:
            mean, interval = points(c["mean"]), f"{points(c['low'])} to {points(c['high'])}"
        note = "too few pairs or groups" if c["reason"] == "too_few" else "descriptive"
        lines.append(
            f"| {c['group']} | {c['metric']} | {c['comparison']} | {c['n']} | {c['clusters']} "
            f"| {mean} | {interval} | {note} |"
        )
    return [*lines, ""]


def _agreement_section(agreements: dict[str, Any]) -> list[str]:
    lines = [
        "## Judge agreement",
        "",
        "Agreement of judge correctness 2 with a deterministic answer score of at least 0.5.",
        "",
        "| Pipeline | Judged repeats | Agreement | Kappa |",
        "|---|---|---|---|",
    ]
    rows = [("all", agreements["overall"]), *agreements["pipelines"].items()]
    for name, row in rows:
        lines.append(
            f"| {name} | {row['n']} | {_ratio(row['agreement'])} | {_ratio(row['kappa'])} |"
        )
    return [*lines, ""]


def _failure_section(failures: dict[str, Any], unavailable: dict[str, Any]) -> list[str]:
    lines = [
        "## Failures",
        "",
        "| Pipeline | Repeats | Generation failures | Judge failures | Failure classes |",
        "|---|---|---|---|---|",
    ]
    for tag, repeats in failures["repeats"].items():
        classes = ", ".join(f"{name} {n}" for name, n in failures["classes"][tag].items())
        lines.append(
            f"| {tag} | {repeats} | {failures['generation'][tag]} | {failures['judge'][tag]} "
            f"| {classes or 'none'} |"
        )
    lines += ["", "Questions not grounded:", ""]
    missing = [
        f"- world {seed}: {item['question_id']} ({item['reason']})"
        for seed, items in unavailable.items()
        for item in items
    ]
    return [*lines, *(missing or ["- none"]), ""]


def _number(metric: str, value: float) -> str:
    return f"{value:.0f}" if metric in ("latency_ms", "context_tokens") else f"{value:.3f}"


def _p(value: float | None) -> str:
    return "-" if value is None else f"{value:.4f}"


def _ratio(value: float | None) -> str:
    return "-" if value is None else f"{value:.3f}"
