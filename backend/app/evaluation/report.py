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

Evaluator-only (ADR-008): the API reads the written ``summary.json`` from
disk and never imports this module.
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
        }


def stratum_key(instance: BankInstance) -> str:
    if instance.stratum == "H2" and instance.sub_stratum == "name_anchored":
        return "H2_name"
    return instance.stratum


def summarize(run: BenchmarkRun) -> dict[str, Any]:
    """The machine-readable result of a run, written as ``summary.json``."""
    results = [result for world in run.worlds for result in world.results]
    observations = [_observe(result) for result in results]
    pipelines = [tag for tag in PIPELINES if any(tag in r.scores for r in results)]
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
        "metrics": {
            key: _metric_table([o for o in observations if key in (o.stratum, OVERALL)], pipelines)
            for key in (*STRATUM_KEYS, OVERALL)
        },
        "comparisons": [c.to_payload() for c in comparisons],
        "headlines": [SMOKE_HEADLINE] if smoke else _headlines(comparisons),
        "judge_agreement": _judge_agreement(results, pipelines),
        "failures": _failures(results, pipelines),
        "reproducibility": run.record.to_payload(),
    }


def _observe(result: InstanceResult) -> _Observation:
    values: dict[str, dict[str, tuple[float, int]]] = {}
    for metric, extract in METRICS.items():
        per_pipeline: dict[str, tuple[float, int]] = {}
        for tag, scores in result.scores.items():
            defined = [
                value
                for score, run in zip(scores, result.runs[tag], strict=True)
                if score is not None and (value := extract(score, run)) is not None
            ]
            if defined:
                per_pipeline[tag] = (statistics.mean(defined), len(defined))
        values[metric] = per_pipeline
    instance = result.instance
    return _Observation(
        stratum_key(instance), f"{instance.question_id}:{instance.world_seed}", values
    )


def _stratum_counts(instances: Iterable[BankInstance]) -> dict[str, int]:
    counts = Counter(stratum_key(instance) for instance in instances)
    return {key: counts[key] for key in STRATUM_KEYS}


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


def _comparisons(observations: Sequence[_Observation]) -> list[_Comparison]:
    """Every compared cell; p and the Holm p only for cells in the family
    that pass both the pairs gate and the groups gate."""
    cells: list[_Comparison] = []
    for stratum in STRATUM_KEYS:
        for metric in COMPARED_METRICS:
            for comparison, (x, y) in COMPARISONS.items():
                diffs: list[float] = []
                clusters: list[str] = []
                for o in observations:
                    value = o.values[metric]
                    if o.stratum == stratum and x in value and y in value:
                        diffs.append(value[x][0] - value[y][0])
                        clusters.append(o.cluster)
                n, groups = len(diffs), len(set(clusters))
                in_family = (
                    (stratum, metric) in HOLM_FAMILY
                    and n >= MIN_PAIRS_FOR_CLAIM
                    and groups >= MIN_CLUSTERS_FOR_CLAIM
                )
                cells.append(
                    _Comparison(
                        stratum=stratum,
                        metric=metric,
                        comparison=comparison,
                        interval=cluster_bootstrap(diffs, clusters) if diffs else None,
                        n=n,
                        clusters=groups,
                        p=wilcoxon_p(diffs, clusters) if in_family else None,
                        p_holm=None,
                        in_family=in_family,
                    )
                )
    family = {str(i): c.p for i, c in enumerate(cells) if c.p is not None}
    for i, adjusted in holm(family).items():
        cells[int(i)].p_holm = adjusted
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
    record = summary["reproducibility"]
    lines = [
        "# Benchmark run",
        "",
        f"Run kind: {summary['run_kind']}.",
        *([f"Label: {summary['label']}."] if summary["label"] else []),
        f"Bank version {summary['bank_version']}, worlds "
        f"{', '.join(str(seed) for seed in summary['worlds'])}, started {record['started_at']}.",
        "",
        "## Headlines",
        "",
        *[f"- {line}" for line in summary["headlines"]],
        "",
    ]
    for key in (*STRATUM_KEYS, OVERALL):
        lines += _stratum_section(summary, key)
    lines += _comparison_section(summary["comparisons"])
    lines += _agreement_section(summary["judge_agreement"])
    lines += _failure_section(summary["failures"], summary["unavailable"])
    lines += ["## Reproducibility", ""]
    lines += [f"- {name}: `{value}`" for name, value in record.items()]
    return "\n".join(lines) + "\n"


def _stratum_section(summary: dict[str, Any], key: str) -> list[str]:
    table = summary["metrics"][key]
    pipelines = list(summary["anchor_resolution_basis"])
    total = summary["instances"]["total"]
    count = sum(total.values()) if key == OVERALL else total[key]
    lines = [
        f"## {key}: {STRATUM_LABELS[key]}",
        "",
        f"Instances: {count}.",
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


def _comparison_section(comparisons: Sequence[dict[str, Any]]) -> list[str]:
    lines = [
        "## Comparisons",
        "",
        "Differences in points (one point is 0.01 on the 0 to 1 scale); "
        "p is Wilcoxon on group means, Holm-adjusted over the family.",
        "",
        "| Stratum | Metric | Comparison | Pairs | Groups | Mean | 95 percent interval "
        "| p | Holm p | In family |",
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
            f"| {'yes' if c['in_family'] else 'no'} |"
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
