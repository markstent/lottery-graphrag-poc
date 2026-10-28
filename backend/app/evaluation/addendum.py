"""The addendum to a stored run: the same answers and blocks rescored with
the current scorer and the groundedness measure (D-090).

It is model-free and descriptive: means per pipeline and stratum, the
recorded value beside the rescored one, with counts, and no comparison
tests, because a run's tested family is its own published record. It is
written to a directory of its own, never into the run.
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from app.evaluation.checks import answer_score, groundedness, is_abstention
from app.evaluation.grounding import BankInstance
from app.evaluation.judge import agreement, judge_pairs
from app.evaluation.official import DATA_DIR, load_results, method_of
from app.evaluation.report import MIN_KAPPA_ITEMS, kappa_text, stratum_key
from app.evaluation.runner import (
    SCORER_VERSION,
    InstanceResult,
    PipelineRun,
    RunScore,
    instance_result_from_payload,
)

ADDENDUM_ROOT = DATA_DIR / "evaluation" / "addenda"

# One repeat: its run, its recorded score and its rescored one.
_Repeat = tuple[PipelineRun, RunScore | None, RunScore | None]


def addendum_dir(run_dir: Path) -> Path:
    """Where a run's addendum goes by default, beside the runs, not in them."""
    return ADDENDUM_ROOT / f"{run_dir.name}-scorer-{SCORER_VERSION}"


def rescore_instance(payload: dict[str, Any]) -> InstanceResult:
    """One stored instance result with the answer score and the groundedness
    recomputed; evidence, citations, failure class and judgement stay as
    recorded."""
    return _rescored_result(instance_result_from_payload(payload))


def _rescored_result(recorded: InstanceResult) -> InstanceResult:
    scores: dict[str, list[RunScore | None]] = {}
    for tag, runs in recorded.runs.items():
        scores[tag] = [
            None if score is None else _rescored(recorded.instance, run, score)
            for run, score in zip(runs, recorded.scores[tag], strict=True)
        ]
    return dataclasses.replace(recorded, scores=scores)


def _rescored(instance: BankInstance, run: PipelineRun, score: RunScore) -> RunScore:
    texts = [block.text for block in run.blocks]
    grounded = (
        None
        if texts and not any(texts)
        else groundedness(instance.text, run.verdict, run.answer, texts)
    )
    return dataclasses.replace(
        score, answer=answer_score(instance.checks, run.verdict, run.answer), groundedness=grounded
    )


def rescore(payload: dict[str, Any]) -> dict[str, Any]:
    """Per stratum and pipeline: the answer mean as recorded and as rescored,
    the groundedness means, the abstention count and the three-level
    agreement of the recorded judge with each answer score."""
    cells: dict[str, dict[str, list[_Repeat]]] = {}
    for world in payload["worlds"]:
        for entry in world["results"]:
            recorded = instance_result_from_payload(entry)
            rescored = _rescored_result(recorded)
            stratum = cells.setdefault(stratum_key(recorded.instance), {})
            for tag, runs in recorded.runs.items():
                stratum.setdefault(tag, []).extend(
                    zip(runs, recorded.scores[tag], rescored.scores[tag], strict=True)
                )
    run_record = payload["reproducibility"]["run"]
    return {
        "recorded_scorer_version": run_record["scorer_version"],
        "rescored_scorer_version": SCORER_VERSION,
        "recorded_judge_prompt_version": run_record["judge_prompt_version"],
        "strata": {
            stratum: {tag: _cell(repeats) for tag, repeats in sorted(pipelines.items())}
            for stratum, pipelines in sorted(cells.items())
        },
    }


def _cell(repeats: list[_Repeat]) -> dict[str, Any]:
    old = [(run.verdict, before) for run, before, _ in repeats]
    new = [(run.verdict, after) for run, _, after in repeats]
    grounded = [after.groundedness for _, _, after in repeats if after is not None]
    supported = [g.supported_share for g in grounded if g and g.supported_share is not None]
    unsupported = [g.unsupported_share for g in grounded if g and g.unsupported_share is not None]
    return {
        "repeats": len(repeats),
        "answer_recorded": _mean([s.answer for _, s in old if s and s.answer is not None]),
        "answer_rescored": _mean([s.answer for _, s in new if s and s.answer is not None]),
        "abstentions": sum(is_abstention(run.verdict) for run, _, _ in repeats),
        "groundedness": {
            "n": len([g for g in grounded if g is not None]),
            "supported": _mean(supported),
            "unsupported": _mean(unsupported),
        },
        "agreement": _agreement(old, new),
    }


def _mean(values: list[float]) -> dict[str, Any]:
    return {"n": len(values), "mean": sum(values) / len(values) if values else None}


def _agreement(
    old: Iterable[tuple[str, RunScore | None]], new: Iterable[tuple[str, RunScore | None]]
) -> dict[str, dict[str, Any]]:
    recorded, rescored = judge_pairs(old), judge_pairs(new)
    return {
        key: {
            "recorded": dataclasses.asdict(agreement(recorded[key])),
            "rescored": dataclasses.asdict(agreement(rescored[key])),
        }
        for key in ("answered", "abstained")
    }


def write_addendum(run_dir: Path, out_dir: Path) -> Path:
    """Rescore the run in ``run_dir`` and write ``addendum.json`` and
    ``addendum.md`` into the new directory ``out_dir``, which may not be
    inside the run or already exist. Returns ``out_dir``."""
    if out_dir.resolve().is_relative_to(run_dir.resolve()):
        raise ValueError(
            f"{out_dir} is inside the run {run_dir}; an addendum is never written there"
        )
    if out_dir.exists():
        raise ValueError(f"{out_dir} already exists; an addendum is written once")
    payload = load_results(run_dir)
    run_record = payload["reproducibility"]["run"]
    document = {
        "run": run_dir.name,
        "run_method_version": method_of(run_record),
        **rescore(payload),
    }
    out_dir.mkdir(parents=True)
    (out_dir / "addendum.json").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    (out_dir / "addendum.md").write_text(render(document), encoding="utf-8")
    return out_dir


def render(document: dict[str, Any]) -> str:
    """The addendum page, one sentence per line."""
    run = document["run"]
    lines = [
        f"# Addendum to the official run v{document['run_method_version']}",
        "",
        f"This is an addendum to the run `{run}`, "
        f"rescored with scorer {document['rescored_scorer_version']} and the groundedness measure, "
        "no model was called, and the original record is unchanged.",
        f"The run's own scorer was scorer {document['recorded_scorer_version']}"
        " and its record is the published one.",
        "Only the answer score and groundedness were recomputed from the stored answers.",
        "Evidence, citations and the judge's verdicts are as recorded.",
        f"The judge was judge prompt {document['recorded_judge_prompt_version']}, as recorded;"
        " agreement is that judge's correctness against the answer score on three levels"
        " (0, partial, 1), with exact agreement and linearly weighted kappa,"
        f" which is shown only over at least {MIN_KAPPA_ITEMS} repeats"
        " (below that: too few to say).",
        "Everything here is descriptive: means and counts, with no comparison tests.",
        "",
    ]
    for stratum, pipelines in document["strata"].items():
        lines += [f"## {stratum}", ""]
        for tag, cell in pipelines.items():
            lines += _cell_lines(tag, cell)
    return "\n".join(lines).rstrip("\n") + "\n"


def _cell_lines(tag: str, cell: dict[str, Any]) -> list[str]:
    grounded = cell["groundedness"]
    lines = [
        f"### Pipeline {tag}",
        "",
        f"- Repeats: {cell['repeats']}; abstentions: {cell['abstentions']}.",
        f"- Answer score as recorded: {_shown(cell['answer_recorded'])}.",
        f"- Answer score rescored: {_shown(cell['answer_rescored'])}.",
        # Both shares are defined exactly when the answer has an atom, so
        # supported and unsupported always share one n.
        f"- Groundedness, over the {grounded['supported']['n']} of {grounded['n']} repeats"
        " whose answer states an id, date or number not in the question:"
        f" supported {_number(grounded['supported']['mean'])},"
        f" unsupported {_number(grounded['unsupported']['mean'])}.",
    ]
    for key, label in (("answered", "answered"), ("abstained", "abstained")):
        for version in ("recorded", "rescored"):
            found = cell["agreement"][key][version]
            lines.append(
                f"- Judge agreement on {label} repeats, {version} answer score:"
                f" n {found['n']}, agreement {_number(found['agreement'])},"
                f" weighted kappa {kappa_text(found['n'], found['weighted_kappa'])}."
            )
    return [*lines, ""]


def _shown(mean: dict[str, Any]) -> str:
    return f"{_number(mean['mean'])} (n {mean['n']})"


def _number(value: float | None) -> str:
    return "undefined" if value is None else f"{value:.3f}"
