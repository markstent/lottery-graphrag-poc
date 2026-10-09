"""Markdown report for a benchmark run (docs/05-benchmark-spec.md section 13).

Deterministic rendering of :class:`app.evaluation.runner.BenchmarkRun`:
configuration summaries, per-category and per-pipeline means, per-question
results, failure classes, and the questions reported but not scored.
Latency and token usage are shown separately, never folded into quality.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.evaluation.bank import CATEGORY_DIFFICULTY
from app.evaluation.runner import BenchmarkRun, QuestionResult

PIPELINES = ("A", "B", "C")


def render_report(run: BenchmarkRun) -> str:
    lines: list[str] = []
    record = run.record.to_payload()
    lines.append("# Benchmark Run")
    lines.append("")
    lines.append(f"Started: {record['started_at']}")
    lines.append("")
    lines.append("## Configuration")
    lines.append("")
    for key in (
        "git_sha",
        "question_bank_version",
        "world_dir",
        "profile",
        "world_seed",
        "scenario_seed",
        "generator_version",
        "embedding_model",
        "generation_model",
        "generation_temperature",
        "reranker",
        "top_k",
        "context_budget_tokens",
        "ontology_version",
    ):
        lines.append(f"- {key}: `{record[key]}`")
    lines.append(f"- graph_limits: `{record['graph_limits']}`")
    lines.append("")

    scored = [result for result in run.results if result.grounded.status == "ok"]
    unscored = [result for result in run.results if result.grounded.status != "ok"]
    lines.append(f"Scored questions: {len(scored)} of {len(run.results)}")
    lines.append("")

    lines.extend(_summary_table(scored))
    lines.extend(_category_table(scored))
    lines.extend(_question_table(scored))
    lines.extend(_failures(scored))
    lines.extend(_unscored(unscored))
    return "\n".join(lines)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _collect(results: list[QuestionResult], tag: str) -> dict[str, Any]:
    runs = [result.runs[tag] for result in results if tag in result.runs]
    scores = [result.scores[tag] for result in results if tag in result.scores]
    answers = [s.answer_score for s in scores if s.answer_score is not None]
    recalls = [s.evidence_recall for s in scores if s.evidence_recall is not None]
    precisions = [s.evidence_precision for s in scores if s.evidence_precision is not None]
    return {
        "answer": _mean(answers),
        "recall": _mean(recalls),
        "precision": _mean(precisions),
        "latency": _mean([run.latency_ms for run in runs]),
        "tokens": _mean([float(run.context_tokens) for run in runs]),
        "n": len(scores),
    }


def _summary_table(results: list[QuestionResult]) -> list[str]:
    lines = ["## Per-pipeline summary (means over scored questions)", ""]
    lines.append(
        "| pipeline | n | answer | evidence recall | evidence precision "
        "| latency ms | context tokens |"
    )
    lines.append("|---|---|---|---|---|---|---|")
    for tag in PIPELINES:
        stats = _collect(results, tag)
        lines.append(
            f"| {tag} | {stats['n']} | {_pct(stats['answer'])} | {_pct(stats['recall'])} "
            f"| {_pct(stats['precision'])} | {stats['latency']:.0f} | {stats['tokens']:.0f} |"
        )
    lines.append("")
    lines.append(
        "Answer score and evidence metrics are deterministic "
        "(docs/evaluation/scoring.md). Latency and context tokens are reported "
        "separately and never folded into quality."
    )
    lines.append("")
    return lines


def _category_table(results: list[QuestionResult]) -> list[str]:
    by_category: dict[str, list[QuestionResult]] = defaultdict(list)
    for result in results:
        by_category[result.grounded.question.category].append(result)
    lines = ["## Per-category means (answer score / evidence recall)", ""]
    lines.append("| category | difficulty | n | A | B | C |")
    lines.append("|---|---|---|---|---|---|")
    for category in sorted(by_category):
        group = by_category[category]
        difficulty = CATEGORY_DIFFICULTY[category]
        cells = []
        for tag in PIPELINES:
            answers = [
                s.answer_score
                for s in (r.scores[tag] for r in group if tag in r.scores)
                if s.answer_score is not None
            ]
            recalls = [
                s.evidence_recall
                for s in (r.scores[tag] for r in group if tag in r.scores)
                if s.evidence_recall is not None
            ]
            cells.append(f"{_pct(_mean(answers))} / {_pct(_mean(recalls))}")
        lines.append(f"| {category} | {difficulty} | {len(group)} | " + " | ".join(cells) + " |")
    lines.append("")
    return lines


def _question_table(results: list[QuestionResult]) -> list[str]:
    lines = ["## Per-question results", ""]
    lines.append("| id | category | binding key | A ans/rec | B ans/rec | C ans/rec |")
    lines.append("|---|---|---|---|---|---|")
    for result in results:
        cells = []
        for tag in PIPELINES:
            score = result.scores.get(tag)
            cells.append(_cell(score))
        question = result.grounded.question
        lines.append(
            f"| {question.question_id} | {question.category} | {question.binding_key} | "
            + " | ".join(cells)
            + " |"
        )
    lines.append("")
    return lines


def _failures(results: list[QuestionResult]) -> list[str]:
    lines = ["## Failure classes (docs/05 section 14)", ""]
    counts: dict[str, int] = defaultdict(int)
    for result in results:
        for score in result.scores.values():
            if score.failure_class:
                counts[score.failure_class] += 1
    if not counts:
        lines.append("None recorded.")
        lines.append("")
        return lines
    for name, count in sorted(counts.items()):
        lines.append(f"- {name}: {count}")
    lines.append("")
    return lines


def _unscored(unscored: list[QuestionResult]) -> list[str]:
    lines = ["## Reported but not scored", ""]
    if not unscored:
        lines.append("All bank questions were grounded and scored.")
        lines.append("")
        return lines
    for result in unscored:
        question = result.grounded.question
        lines.append(f"- {question.question_id} ({result.grounded.status}): {result.grounded.note}")
    lines.append("")
    lines.append(
        "Questions whose home scenario is not planted in this world are never "
        "scored: the benchmark does not invent truth."
    )
    lines.append("")
    return lines


def _cell(score: Any) -> str:
    if score is None:
        return "-"
    answer = "-" if score.answer_score is None else f"{score.answer_score:.2f}"
    recall = "-" if score.evidence_recall is None else f"{score.evidence_recall:.2f}"
    return f"{answer} / {recall}"


def _pct(value: float) -> str:
    return f"{value:.2f}"
