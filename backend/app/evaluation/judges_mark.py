"""The judges' mark: the two judges' correctness combined, a second tested measure (D-105).

Per answer (one repeat of one approach on one instance) the mark is
``(c1 + c2) / 4``, where c1 and c2 are the first and the second judge's
correctness on the 0, 1, 2 rubric: 0, 0.25, 0.5, 0.75 or 1. It is defined
only when both judges gave scores; an answer without both is counted by
reason and left out, never read as 0. The judges disagree on an answer when
their correctness differs by more than one level (one says 2, the other 0);
such answers are listed for a person to check.

The mark is tested as the answer score is (``report.HOLM_FAMILY``): the
same kinds of question, the same two comparisons, the same pairing,
grouping, interval, test and gates, through the same functions. Holm runs
over the judges' cells alone, so no published number of the run, adjusted
p-values included, changes.

It reads the run and the second judge's verdicts and summary, calls no
model, and writes ``combined.json`` beside the second judge's summary, never
under the runs directory. Evaluator-only (ADR-008).
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.evaluation import second_judge as sj
from app.evaluation.official import load_results
from app.evaluation.report import (
    HOLM_FAMILY,
    OVERALL,
    PRIMARY_METRIC,
    STRATUM_KEYS,
    Extractor,
    family_headlines,
    metric_table,
    observe,
    paired_comparisons,
    stratum_key,
)
from app.evaluation.runner import (
    PIPELINES,
    InstanceResult,
    PipelineRun,
    RunScore,
    git_dirty,
    git_sha,
    instance_result_from_payload,
)

COMBINED_FILE = "combined.json"
COMBINED_SCHEMA_VERSION = 1
FAMILY = "judges"
JUDGE_MARK = "judge_mark"
UNIT = "judges' mark points"
DEFINITION = (
    "Per answer, (first judge's correctness + second judge's correctness) / 4 on the "
    "0, 1, 2 rubric; defined only when both judges gave scores."
)
# The highest correctness level; the mark divides the sum of two by twice this.
TOP_LEVEL = 2
# Correctness levels further apart than this are a disagreement: one judge 2, the other 0.
DISAGREE_ABOVE = 1
# The judges' family: the answer score's tested cells, on the judges' mark.
JUDGE_FAMILY = frozenset(
    (comparison, stratum, JUDGE_MARK)
    for comparison, stratum, metric in HOLM_FAMILY
    if metric == "answer"
)
# Every tested kind of question gets its headline on the mark.
PRIMARY = {stratum: JUDGE_MARK for stratum in PRIMARY_METRIC}
# Why an answer has no mark, checked in this order.
GENERATION_FAILED = "generation_failed"
FIRST_JUDGE_FAILED = "first_judge_failed"
SECOND_JUDGE_PENDING = "second_judge_pending"
SECOND_JUDGE_FAILED = "second_judge_failed"
MISSING_REASONS = (GENERATION_FAILED, FIRST_JUDGE_FAILED, SECOND_JUDGE_PENDING, SECOND_JUDGE_FAILED)


def judge_mark(first: int, second: int) -> float:
    """The two correctness levels as one mark from 0 to 1."""
    return (first + second) / (2 * TOP_LEVEL)


def judges_disagree(first: int, second: int) -> bool:
    return abs(first - second) > DISAGREE_ABOVE


def _second(
    verdicts: dict[str, dict[str, Any]], instance_id: str, run: PipelineRun
) -> dict[str, Any] | None:
    return verdicts.get(sj.repeat_key(instance_id, run.pipeline, run.repeat))


def _levels(score: RunScore | None, line: dict[str, Any] | None) -> tuple[int, int] | str:
    """Both judges' correctness, or the reason the answer has no mark."""
    if score is None:
        return GENERATION_FAILED
    if score.judge is None or score.judge.scores is None:
        return FIRST_JUDGE_FAILED
    if line is None:
        return SECOND_JUDGE_PENDING
    if line["scores"] is None:
        return SECOND_JUDGE_FAILED
    return score.judge.scores.correctness, int(line["scores"]["correctness"])


def _extractor(instance_id: str, verdicts: dict[str, dict[str, Any]]) -> Extractor:
    def value(score: RunScore, run: PipelineRun) -> float | None:
        levels = _levels(score, _second(verdicts, instance_id, run))
        return None if isinstance(levels, str) else judge_mark(*levels)

    return value


def _answers(
    results: Sequence[InstanceResult], verdicts: dict[str, dict[str, Any]]
) -> Iterator[tuple[InstanceResult, PipelineRun, tuple[int, int] | str]]:
    """Every answer of the run, in run order, with both levels or why it has no mark."""
    for result in results:
        for tag in PIPELINES:
            for run, score in zip(
                result.runs.get(tag, []), result.scores.get(tag, []), strict=True
            ):
                line = _second(verdicts, result.instance.instance_id, run)
                yield result, run, _levels(score, line)


def combine(
    run_id: str,
    payload: dict[str, Any],
    summary: dict[str, Any],
    verdicts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """``combined.json``: the judges' mark over one run, from the run's
    results, the second judge's summary and its verdicts."""
    record = payload["reproducibility"]["run"]
    if record.get("judge_prompt_version") != summary["judge_prompt_version"]:
        raise ValueError(
            f"the first judge used prompt {record.get('judge_prompt_version')!r} and the "
            f"second {summary['judge_prompt_version']!r}; marks of two prompts are not combined"
        )
    results = [
        instance_result_from_payload(entry)
        for world in payload["worlds"]
        for entry in world["results"]
    ]
    pipelines = [tag for tag in PIPELINES if any(tag in r.scores for r in results)]
    observations = [
        observe(r, {JUDGE_MARK: _extractor(r.instance.instance_id, verdicts)}) for r in results
    ]
    comparisons = paired_comparisons(observations, (JUDGE_MARK,), JUDGE_FAMILY)
    answers = list(_answers(results, verdicts))
    missing = Counter(levels for _, _, levels in answers if isinstance(levels, str))
    split = [
        (result, run, levels)
        for result, run, levels in answers
        if not isinstance(levels, str) and judges_disagree(*levels)
    ]
    by_stratum = Counter(stratum_key(result.instance) for result, _, _ in split)
    return {
        "schema_version": COMBINED_SCHEMA_VERSION,
        "kind": "combined",
        "family": FAMILY,
        "run_id": run_id,
        "measure": JUDGE_MARK,
        "definition": DEFINITION,
        "first_judge": summary["first_judge"],
        "second_judge": summary["second_judge"],
        "judge_prompt_version": summary["judge_prompt_version"],
        "judge_prompt_hash": summary["judge_prompt_hash"],
        # The second judge's pass this was computed from; a newer pass makes it stale.
        "second_judge_finished_at": summary["finished_at"],
        "computed_at": datetime.now(UTC).isoformat(),
        "git_sha": git_sha(),
        "git_dirty": git_dirty(),
        "min_kappa_items": summary["min_kappa_items"],
        "counts": {
            "answers": len(answers),
            "both_judged": len(answers) - missing.total(),
            "agreed": sum(
                1
                for _, _, levels in answers
                if not isinstance(levels, str) and levels[0] == levels[1]
            ),
            "missing": {reason: missing[reason] for reason in MISSING_REASONS},
            "disagreements": len(split),
        },
        "metrics": {
            key: metric_table(
                [o for o in observations if key in (o.stratum, OVERALL)], pipelines, (JUDGE_MARK,)
            )[JUDGE_MARK]
            for key in (*STRATUM_KEYS, OVERALL)
        },
        "comparisons": [c.to_payload() for c in comparisons],
        "headlines": family_headlines(comparisons, PRIMARY, {JUDGE_MARK: UNIT}, JUDGE_MARK),
        "agreement": sj.between_judges(results, verdicts),
        "disagreements_by_stratum": {
            **{key: by_stratum[key] for key in STRATUM_KEYS},
            OVERALL: len(split),
        },
        "disagreements": [
            {
                "instance_id": result.instance.instance_id,
                "question_id": result.instance.question_id,
                "world_seed": result.instance.world_seed,
                "stratum": stratum_key(result.instance),
                "pipeline": run.pipeline,
                "repeat": run.repeat,
                "question": result.instance.text,
                "first": first,
                "second": second,
            }
            for result, run, (first, second) in split
        ],
    }


def _summary(out_dir: Path) -> dict[str, Any]:
    path = out_dir / sj.SUMMARY_FILE
    if not path.exists():
        raise ValueError(
            f"{out_dir} has no {sj.SUMMARY_FILE}: the second judge has not finished this run"
        )
    summary: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return summary


def write_combined(source: Path, out_dir: Path) -> Path:
    """Compute the judges' mark of the run in ``source`` from the second
    judge's finished pass in ``out_dir`` and write ``combined.json`` there.
    Calls no model and changes neither the run nor the verdicts."""
    sj.refuse_runs(out_dir, source)
    summary = _summary(out_dir)
    second = summary["second_judge"]
    record = {
        "model": second["model"],
        "reasoning": second["reasoning"],
        "temperature": second["temperature"],
        "max_tokens": second["max_tokens"],
        "prompt_version": summary["judge_prompt_version"],
        "prompt_hash": summary["judge_prompt_hash"],
    }
    verdicts = sj.stored_verdicts(out_dir / sj.VERDICTS_FILE, record)
    combined = combine(source.name, load_results(source), summary, verdicts)
    path = out_dir / COMBINED_FILE
    path.write_text(json.dumps(combined, indent=2) + "\n", encoding="utf-8")
    return path


def combine_run(source: Path, root: Path | None = None) -> Path:
    """``combined.json`` for the newest second judge of the run in ``source``."""
    root = root or sj.SECOND_JUDGE_ROOT
    found = sj.published(root, source.name)
    if found is None:
        raise ValueError(f"run {source.name!r} has no finished second judge under {root}")
    model = found[0]["second_judge"]["model"]
    return write_combined(source, sj.run_out_dir(root, source.name, model))


def published(root: Path, run_id: str, summary: dict[str, Any]) -> dict[str, Any] | None:
    """The judges' mark beside the second-judge ``summary`` the run publishes;
    None when it has not been computed, is of another schema, or was computed
    from an earlier pass of that second judge (stale)."""
    path = sj.run_out_dir(root, run_id, summary["second_judge"]["model"]) / COMBINED_FILE
    if not path.exists():
        return None
    combined: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    if combined.get("schema_version") != COMBINED_SCHEMA_VERSION:
        return None
    if combined.get("second_judge_finished_at") != summary["finished_at"]:
        return None
    return combined
