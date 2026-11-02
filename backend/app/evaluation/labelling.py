"""The hand-labelling sample of a stored run and its agreement analysis (D-089).

About 100 judged repeats of the v0.2.0 run are drawn from the cells where
the two answer measures disagreed (proposal section 4.4), by a hashed seed,
and written as a blind sheet: question, reference answer, key facts, the
shown blocks shuffled and renumbered as the judge saw them (each block's
``ShownBlock.judge_text``, never its title) and the blinded answer.
The approach, the cell and every recorded score and judgement go to
``key.json``, which the labellers do not open
before labelling. Two labellers fill empty templates independently and
settle their disagreements in a consensus file; the analysis then measures
how far each answer measure agrees with the consensus label.

It is evaluator-only and model-free. The labels never reach a pipeline.
"""

from __future__ import annotations

import csv
import dataclasses
import hashlib
import io
import json
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.evaluation.addendum import Checks, rescore_instance, rescoring_checks
from app.evaluation.checks import SCORER_VERSION, SetCheck, is_abstention
from app.evaluation.grounding import BankInstance
from app.evaluation.judge import Agreement, JudgeItem, agreement, answer_level, blind
from app.evaluation.official import DATA_DIR, load_results
from app.evaluation.report import MIN_KAPPA_ITEMS, TOO_FEW_FOR_KAPPA
from app.evaluation.runner import (
    PipelineRun,
    RunScore,
    instance_result_from_payload,
)

LABELS_ROOT = DATA_DIR / "evaluation" / "labels"
# Where official runs live; nothing here is ever written under it.
RUNS_ROOT = DATA_DIR / "evaluation" / "runs"
DEFAULT_SAMPLE_DIR = LABELS_ROOT / "v0.2.0-sample"
SAMPLE_SALT = "v0.3-labels-2026-10-27"
# The cells in precedence order with their sizes: a repeat goes to the first it fits.
CELLS: tuple[tuple[str, int], ...] = (
    ("abstention_judged_correct", 25),
    ("l03_date", 15),
    ("version_label", 10),
    ("partial_set", 25),
    ("agree", 25),
)
LABELLERS = ("owner", "controller")
LABEL_HEADER = ("item_id", "correctness", "abstained", "notes")
CONSENSUS_FILE = "labels-consensus.csv"
# The rule for acting on the labels: a measure is wrong on its cell when the
# labels contradict it on at least this share of the cell's items.
WRONG_SHARE_RULE = 0.80
# The judge's correctness sentence, verbatim from judge prompt 1.1.0.
CORRECTNESS_RUBRIC = (
    "correctness: the answer agrees with the reference answer; an answer that says the "
    "sources do not answer scores 0 when the reference answer gives an answer."
)
# The judge prompt whose abstention rule is applied mechanically to the recorded judge.
ABSTENTION_RULE_VERSION = "1.1.0"
MEASURES = ("scorer_recorded", "scorer_rescored", "judge_recorded", "judge_abstention_rule")


@dataclass(frozen=True, slots=True)
class SampleItem:
    """One judged repeat drawn into the sample, with its recorded score."""

    item_id: str
    cell: str
    instance: BankInstance
    run: PipelineRun
    score: RunScore


def sample_hash(instance_id: str, pipeline: str, repeat: int) -> str:
    """The hashed order of a repeat within its cell and across the sample."""
    text = f"{SAMPLE_SALT}:{instance_id}:{pipeline}:{repeat}"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _correctness(score: RunScore) -> int:
    assert score.judge is not None and score.judge.scores is not None
    return score.judge.scores.correctness


def _answer(score: RunScore) -> float:
    assert score.answer is not None
    return score.answer


def _abstention_judged_correct(instance: BankInstance, run: PipelineRun, score: RunScore) -> bool:
    return is_abstention(run.verdict) and _correctness(score) == 2 and bool(instance.checks)


def _l03_date(instance: BankInstance, run: PipelineRun, score: RunScore) -> bool:
    return instance.question_id == "L03" and _answer(score) < 1


def _version_label(instance: BankInstance, run: PipelineRun, score: RunScore) -> bool:
    return instance.question_id == "L02" and _answer(score) < 0.5 and _correctness(score) == 2


def _partial_set(instance: BankInstance, run: PipelineRun, score: RunScore) -> bool:
    has_set = any(isinstance(check, SetCheck) for check in instance.checks)
    return has_set and 0.5 <= _answer(score) < 1


def _agree(instance: BankInstance, run: PipelineRun, score: RunScore) -> bool:
    answer, correctness = _answer(score), _correctness(score)
    both_right = answer == 1 and correctness == 2
    both_wrong = answer == 0 and correctness == 0
    return not is_abstention(run.verdict) and (both_right or both_wrong)


_MEMBERSHIP: dict[str, Callable[[BankInstance, PipelineRun, RunScore], bool]] = {
    "abstention_judged_correct": _abstention_judged_correct,
    "l03_date": _l03_date,
    "version_label": _version_label,
    "partial_set": _partial_set,
    "agree": _agree,
}


def _judged_repeats(
    payload: dict[str, Any],
) -> Iterator[tuple[BankInstance, PipelineRun, RunScore]]:
    """Every repeat with a recorded answer score and a judge's scores."""
    for world in payload["worlds"]:
        for entry in world["results"]:
            result = instance_result_from_payload(entry)
            for tag, runs in result.runs.items():
                for run, score in zip(runs, result.scores[tag], strict=True):
                    if (
                        score is not None
                        and score.answer is not None
                        and score.judge is not None
                        and score.judge.scores is not None
                    ):
                        yield result.instance, run, score


# A cell member: its hash, then the repeat.
_Member = tuple[str, BankInstance, PipelineRun, RunScore]


def _members(payload: dict[str, Any]) -> dict[str, list[_Member]]:
    """Each cell's members in hashed order, each repeat in the first cell it fits."""
    members: dict[str, list[_Member]] = {cell: [] for cell, _ in CELLS}
    for instance, run, score in _judged_repeats(payload):
        cell = next((c for c, _ in CELLS if _MEMBERSHIP[c](instance, run, score)), None)
        if cell is not None:
            key = sample_hash(instance.instance_id, run.pipeline, run.repeat)
            members[cell].append((key, instance, run, score))
    for found in members.values():
        found.sort(key=lambda member: member[0])
    return members


def _sample(payload: dict[str, Any]) -> tuple[list[SampleItem], dict[str, int]]:
    """The sample and the member count of each cell."""
    members = _members(payload)
    taken = sorted(
        ((member, cell) for cell, size in CELLS for member in members[cell][:size]),
        key=lambda pair: pair[0][0],
    )
    items = [
        SampleItem(f"S{n:03d}", cell, instance, run, score)
        for n, ((_, instance, run, score), cell) in enumerate(taken, start=1)
    ]
    return items, {cell: len(found) for cell, found in members.items()}


def build_sample(payload: dict[str, Any]) -> list[SampleItem]:
    """The first n members of each cell by hash (a smaller cell whole, never
    backfilled), numbered S001 onwards in hashed order across the cells."""
    return _sample(payload)[0]


def render_sheet(items: Sequence[SampleItem]) -> str:
    """The labellers' sheet: the rubric, then one section per item. It names
    no approach, cell, title, score or judgement."""
    lines = [
        "# Hand-labelling sheet",
        "",
        "Do not open key.json before labelling.",
        "Label every item in your own file, labels-owner.csv or labels-controller.csv,"
        " without discussing it with the other labeller.",
        "",
        "## Rubric",
        "",
        "Each item shows a question, the reference answer, the key facts a complete answer"
        " states, the numbered context sources the answerer was shown, the answerer's verdict"
        " and its answer, which cites sources as [n]; [?] marks a citation of a source that"
        " was not shown.",
        "Label only from what is given here.",
        "",
        "- Levels: correctness is 0, 1 or 2, where 0 means wrong or absent, 1 means partly"
        " and 2 means fully.",
        f"- {CORRECTNESS_RUBRIC}",
        "- abstained: y or n; y when the answer says the sources do not answer the question,"
        " n otherwise.",
        "- notes: optional free text.",
        "",
    ]
    for item in items:
        lines += _item_lines(item)
    return "\n".join(lines).rstrip("\n") + "\n"


def _item_lines(item: SampleItem) -> list[str]:
    instance = item.instance
    shown, answer = blind(
        JudgeItem(
            question=instance.text,
            expected_answer=instance.expected_answer,
            claim_statements=tuple(claim.statement for claim in instance.claims),
            blocks=item.run.blocks,
            answer=item.run.answer,
            cited_blocks=item.run.cited_blocks,
            blind_seed=item.item_id,
        )
    )
    facts = [f"- {claim.statement}" for claim in instance.claims] or ["- (none)"]
    sources = [f"[{n}] {block.judge_text}" for n, block in enumerate(shown, start=1)]
    lines = [
        f"## {item.item_id}",
        "",
        f"Question: {instance.text}",
        "",
        f"Reference answer: {instance.expected_answer}",
        "",
        "Key facts a complete answer states:",
        "",
        *facts,
        "",
        "Context sources the answerer was shown:",
        "",
    ]
    for source in sources or ["(no context was shown)"]:
        lines += [source, ""]
    lines += [f"Verdict: {item.run.verdict}", "", "Answer:", ""]
    lines += [f"> {line}".rstrip() for line in answer.splitlines() or [""]]
    return [*lines, ""]


def _label_template(items: Sequence[SampleItem]) -> str:
    """An empty label file: the header and one row per item."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(LABEL_HEADER)
    writer.writerows((item.item_id, "", "", "") for item in items)
    return buffer.getvalue()


def _key(
    run_dir: Path, payload: dict[str, Any], items: Sequence[SampleItem], members: dict[str, int]
) -> dict[str, Any]:
    """Item id to repeat, cell and recorded values, and each cell's counts."""
    record = payload["reproducibility"]["run"]
    taken = {cell: sum(item.cell == cell for item in items) for cell, _ in CELLS}
    return {
        "run": run_dir.name,
        "recorded_scorer_version": record["scorer_version"],
        "recorded_judge_prompt_version": record["judge_prompt_version"],
        "salt": SAMPLE_SALT,
        "cells": {
            cell: {
                "size": size,
                "members": members[cell],
                "taken": taken[cell],
                "shortfall": size - taken[cell],
            }
            for cell, size in CELLS
        },
        "items": {
            item.item_id: {
                "instance_id": item.instance.instance_id,
                "question_id": item.instance.question_id,
                "pipeline": item.run.pipeline,
                "repeat": item.run.repeat,
                "cell": item.cell,
                "recorded_answer_score": item.score.answer,
                "recorded_judgement": None
                if item.score.judge is None or item.score.judge.scores is None
                else dataclasses.asdict(item.score.judge.scores),
            }
            for item in items
        },
    }


def write_sample(run_dir: Path, out_dir: Path) -> Path:
    """Draw the sample from the run in ``run_dir`` and write the sheet, the
    two empty label files and the key into the new directory ``out_dir``,
    which may not be inside the run or already exist. Returns ``out_dir``."""
    _refuse_runs(out_dir, run_dir)
    if out_dir.exists():
        raise ValueError(f"{out_dir} already exists; a sample is drawn once")
    payload = load_results(run_dir)
    items, members = _sample(payload)
    out_dir.mkdir(parents=True)
    (out_dir / "sheet.md").write_text(render_sheet(items), encoding="utf-8")
    template = _label_template(items)
    for labeller in LABELLERS:
        (out_dir / f"labels-{labeller}.csv").write_text(template, encoding="utf-8")
    key = _key(run_dir, payload, items, members)
    (out_dir / "key.json").write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    return out_dir


def _refuse_runs(out: Path, run_dir: Path) -> None:
    """Refuse a location inside the run or anywhere under the runs root."""
    where = out.resolve()
    if where.is_relative_to(run_dir.resolve()):
        raise ValueError(f"{out} is inside the run {run_dir}; labels are never written there")
    if where.is_relative_to(RUNS_ROOT.resolve()):
        raise ValueError(
            f"{out} is inside the runs directory {RUNS_ROOT}; labels are never written there"
        )


def shortfall_lines(sample_dir: Path) -> list[str]:
    """One line per cell drawn short of its size, from the key."""
    cells = _read_key(sample_dir)["cells"]
    return [
        f"{cell}: {found['taken']} of {found['size']}, short by {found['shortfall']}"
        for cell, found in cells.items()
        if found["shortfall"]
    ]


def _read_key(sample_dir: Path) -> dict[str, Any]:
    path = sample_dir / "key.json"
    if not path.exists():
        raise ValueError(f"{sample_dir} holds no key.json; draw the sample first")
    key: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return key


@dataclass(frozen=True, slots=True)
class Label:
    """One labeller's label of one item."""

    correctness: int
    abstained: bool


def _read_rows(path: Path) -> dict[str, dict[str, str]]:
    """The rows of a label file by item id; refuses a wrong header or a
    repeated item."""
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != LABEL_HEADER:
            raise ValueError(f"{path.name}: the header must be {','.join(LABEL_HEADER)}")
        rows: dict[str, dict[str, str]] = {}
        repeated: list[str] = []
        for row in reader:
            item_id = (row["item_id"] or "").strip()
            if item_id in rows:
                repeated.append(item_id)
            rows[item_id] = row
    if repeated:
        raise ValueError(f"{path.name}: items listed more than once: {', '.join(repeated)}")
    return rows


def _label(row: dict[str, str] | None) -> Label | None:
    """The label of a row, or None when it is missing or invalid."""
    if row is None:
        return None
    correctness = (row["correctness"] or "").strip()
    abstained = (row["abstained"] or "").strip().casefold()
    if correctness not in {"0", "1", "2"} or abstained not in {"y", "n"}:
        return None
    return Label(int(correctness), abstained == "y")


def _labels(
    path: Path, item_ids: Sequence[str], rows: dict[str, dict[str, str]]
) -> dict[str, Label]:
    """A label for every item, else a refusal naming the items without one
    and any item the sample does not hold."""
    unknown = sorted(set(rows) - set(item_ids))
    if unknown:
        raise ValueError(f"{path.name} holds items not in the sample: {', '.join(unknown)}")
    labels = {item_id: _label(rows.get(item_id)) for item_id in item_ids}
    invalid = [item_id for item_id, label in labels.items() if label is None]
    if invalid:
        raise ValueError(
            f"{path.name}: items without a valid label (correctness 0, 1 or 2 and"
            f" abstained y or n): {', '.join(invalid)}"
        )
    return {item_id: label for item_id, label in labels.items() if label is not None}


def _labeller(sample_dir: Path, labeller: str, item_ids: Sequence[str]) -> dict[str, Label] | None:
    """One labeller's labels, or None when the file is missing or untouched
    (that labeller did not label). A half-filled file is refused."""
    path = sample_dir / f"labels-{labeller}.csv"
    if not path.exists():
        return None
    rows = _read_rows(path)
    untouched = not any(
        (row["correctness"] or "").strip() or (row["abstained"] or "").strip()
        for row in rows.values()
    )
    if untouched:
        return None
    return _labels(path, item_ids, rows)


def _consensus(
    sample_dir: Path, first: dict[str, Label], second: dict[str, Label] | None
) -> tuple[dict[str, Label], list[str]]:
    """The consensus label of every item and the disputed items: the shared
    label where the labellers agree, the consensus file's where they do not."""
    if second is None:
        return first, []
    disputed = [item_id for item_id in first if first[item_id] != second[item_id]]
    if not disputed:
        return first, []
    path = sample_dir / CONSENSUS_FILE
    if not path.exists():
        raise ValueError(
            f"the labellers disagree; disputed items need {CONSENSUS_FILE} with their"
            f" agreed labels: {', '.join(disputed)}"
        )
    rows = _read_rows(path)
    undisputed = sorted(set(rows) - set(disputed))
    if undisputed:
        raise ValueError(
            f"{CONSENSUS_FILE} holds items that are not disputed: {', '.join(undisputed)}"
        )
    settled = _labels(path, disputed, rows)
    return {item_id: settled.get(item_id, label) for item_id, label in first.items()}, disputed


def measure_cell(pairs: Sequence[tuple[int, int]]) -> dict[str, Any]:
    """Agreement of a measure's levels with the labels over one cell, its
    wrong share and whether the share meets the rule for acting on it (never
    over fewer than MIN_KAPPA_ITEMS items)."""
    found = _measure(pairs)
    share = found["wrong_share"]
    enough = found["n"] >= MIN_KAPPA_ITEMS
    return {**found, "flagged": enough and share is not None and share >= WRONG_SHARE_RULE}


def _measure(pairs: Sequence[tuple[int, int]]) -> dict[str, Any]:
    found = agreement(pairs)
    wrong = sum(a != b for a, b in pairs) / len(pairs) if pairs else None
    return {**_agreement_fields(found), "wrong_share": wrong}


def _agreement_fields(found: Agreement) -> dict[str, Any]:
    """The agreement as recorded; ``kappa_shown`` is False below ``MIN_KAPPA_ITEMS``
    items, where the page says "too few to say" in place of the kappa."""
    return {
        "n": found.n,
        "agreement": found.agreement,
        "weighted_kappa": found.weighted_kappa,
        "kappa_shown": found.n >= MIN_KAPPA_ITEMS,
    }


def _binary(labels: Sequence[tuple[bool, bool]]) -> dict[str, Any]:
    """Agreement of two yes or no readings; the linear weighted kappa on
    two levels is Cohen's kappa."""
    return _agreement_fields(agreement([(int(a), int(b)) for a, b in labels]))


def _measure_levels(
    payload: dict[str, Any], items: dict[str, dict[str, Any]], checks: Checks
) -> dict[str, tuple[dict[str, int], bool]]:
    """Each item's level under every measure and whether its verdict is an
    abstention, read from the stored run and rescored with the current scorer
    under ``checks``, the run's instances grounded now."""
    entries = {
        entry["instance"]["instance_id"]: entry
        for world in payload["worlds"]
        for entry in world["results"]
    }
    levels: dict[str, tuple[dict[str, int], bool]] = {}
    for item_id, keyed in items.items():
        entry = entries.get(keyed["instance_id"])
        if entry is None:
            raise ValueError(f"{item_id}: the run holds no instance {keyed['instance_id']}")
        recorded = instance_result_from_payload(entry)
        rescored = rescore_instance(entry, checks)
        pipeline, repeat = keyed["pipeline"], keyed["repeat"]
        index = next(
            (i for i, run in enumerate(recorded.runs.get(pipeline, [])) if run.repeat == repeat),
            None,
        )
        if index is None:
            raise ValueError(f"{item_id}: the run holds no repeat {pipeline} {repeat}")
        run = recorded.runs[pipeline][index]
        before, after = recorded.scores[pipeline][index], rescored.scores[pipeline][index]
        if (
            before is None
            or after is None
            or before.answer is None
            or after.answer is None
            or before.judge is None
            or before.judge.scores is None
        ):
            raise ValueError(f"{item_id}: the stored repeat has no score or no judgement")
        judged = before.judge.scores.correctness
        abstained = is_abstention(run.verdict)
        levels[item_id] = (
            {
                "scorer_recorded": answer_level(before.answer),
                "scorer_rescored": answer_level(after.answer),
                "judge_recorded": judged,
                "judge_abstention_rule": 0 if abstained and recorded.instance.checks else judged,
            },
            abstained,
        )
    return levels


def label_agreement(
    sample_dir: Path,
    run_dir: Path,
    extra: dict[str, tuple[str, dict[str, int]]] | None = None,
) -> dict[str, Any]:
    """Agreement of every measure with the consensus label, overall, per
    cell and per approach; refuses incomplete labels or unsettled disagreements.
    One labeller file (owner or controller) is enough, or both with consensus.

    ``extra`` adds measures read elsewhere, such as the second judge (D-100):
    a name to its description and the level of each item it gave one; an
    item without a level is left out of that measure's pairs."""
    extra = extra or {}
    key = _read_key(sample_dir)
    if key["run"] != run_dir.name:
        raise ValueError(f"the sample was drawn from the run {key['run']}, not {run_dir.name}")
    items: dict[str, dict[str, Any]] = key["items"]
    item_ids = list(items)
    filled = {name: _labeller(sample_dir, name, item_ids) for name in LABELLERS}
    labelled = {name: labels for name, labels in filled.items() if labels is not None}
    if not labelled:
        raise ValueError(
            "no labeller has labelled the sample; fill labels-owner.csv, labels-controller.csv"
            " or both"
        )
    first, *rest = labelled.values()
    second = rest[0] if rest else None
    consensus, disputed = _consensus(sample_dir, first, second)
    payload = load_results(run_dir)
    record = payload["reproducibility"]["run"]
    levels = _measure_levels(payload, items, rescoring_checks(payload))

    def level(measure: str, item_id: str) -> int | None:
        if measure in extra:
            return extra[measure][1].get(item_id)
        return levels[item_id][0][measure]

    def pairs(measure: str, field: str | None = None, value: str = "") -> list[tuple[int, int]]:
        return [
            (found, consensus[item_id].correctness)
            for item_id in item_ids
            if (field is None or items[item_id][field] == value)
            and (found := level(measure, item_id)) is not None
        ]

    pipelines = sorted({item["pipeline"] for item in items.values()})
    measures = (*MEASURES, *extra)

    return {
        "run": run_dir.name,
        "labellers": {
            "names": list(labelled),
            "disputed": disputed,
            "correctness": None
            if second is None
            else _agreement_fields(
                agreement([(first[i].correctness, second[i].correctness) for i in item_ids])
            ),
            "abstained": None
            if second is None
            else _binary([(first[i].abstained, second[i].abstained) for i in item_ids]),
        },
        "measures": {
            "scorer_recorded": f"scorer {record['scorer_version']} as recorded",
            "scorer_rescored": f"scorer {SCORER_VERSION} rescored",
            "judge_recorded": f"judge {record['judge_prompt_version']} as recorded",
            "judge_abstention_rule": (
                f"judge {record['judge_prompt_version']} with the {ABSTENTION_RULE_VERSION}"
                " abstention rule applied mechanically"
            ),
            **{name: described for name, (described, _) in extra.items()},
        },
        "wrong_share_rule": WRONG_SHARE_RULE,
        "overall": {measure: _measure(pairs(measure)) for measure in measures},
        "cells": {
            cell: {
                "n": sum(item["cell"] == cell for item in items.values()),
                "measures": {
                    measure: measure_cell(pairs(measure, "cell", cell)) for measure in measures
                },
            }
            for cell, _ in CELLS
        },
        "approaches": {
            pipeline: {
                "n": sum(item["pipeline"] == pipeline for item in items.values()),
                "measures": {
                    measure: _measure(pairs(measure, "pipeline", pipeline)) for measure in measures
                },
            }
            for pipeline in pipelines
        },
        "abstention": _binary(
            [(levels[item_id][1], consensus[item_id].abstained) for item_id in item_ids]
        ),
    }


def write_agreement(sample_dir: Path, run_dir: Path) -> Path:
    """Write ``agreement.json`` and ``agreement.md`` into the sample
    directory, never inside a run. Returns the sample directory."""
    _refuse_runs(sample_dir, run_dir)
    result = label_agreement(sample_dir, run_dir)
    (sample_dir / "agreement.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    (sample_dir / "agreement.md").write_text(render_agreement(result), encoding="utf-8")
    return sample_dir


def render_agreement(result: dict[str, Any]) -> str:
    """The agreement page, one sentence per line."""
    labellers = result["labellers"]
    lines = [
        f"# Agreement of the answer measures with the hand labels of {result['run']}",
        "",
        "Each measure's level (0, 1 or 2) is compared with the consensus label's correctness,"
        " with exact agreement and linearly weighted kappa.",
        f"A measure is flagged on a cell when the labels show it wrong on at least"
        f" {result['wrong_share_rule']:.0%} of the cell's items, the rule for acting on the"
        " labels.",
        f"A weighted kappa over fewer than {MIN_KAPPA_ITEMS} items is not shown (too few to say),"
        " and such a cell is never flagged.",
        _labelled_by(labellers["names"]),
    ]
    if labellers["correctness"] is not None:
        lines += [
            f"Labellers' correctness: {_found(labellers['correctness'])}.",
            f"Labellers' abstained: {_found(labellers['abstained'])}.",
            f"Disputed items settled by consensus: {len(labellers['disputed'])}.",
        ]
    lines += [
        f"Abstention verdicts against the labelled abstained: {_found(result['abstention'])}.",
        "",
        "## Overall",
        "",
    ]
    for measure, found in result["overall"].items():
        lines.append(
            f"- {result['measures'][measure]}: {_found(found)},"
            f" wrong share {_number(found['wrong_share'])}."
        )
    for cell, found_cell in result["cells"].items():
        lines += ["", f"## Cell {cell} ({found_cell['n']} items)", ""]
        for measure, found in found_cell["measures"].items():
            flag = " Flagged." if found["flagged"] else ""
            lines.append(
                f"- {result['measures'][measure]}: {_found(found)},"
                f" wrong share {_number(found['wrong_share'])}.{flag}"
            )
    for pipeline, found_approach in result["approaches"].items():
        lines += ["", f"## Approach {pipeline} ({found_approach['n']} items)", ""]
        for measure, found in found_approach["measures"].items():
            lines.append(
                f"- {result['measures'][measure]}: {_found(found)},"
                f" wrong share {_number(found['wrong_share'])}."
            )
    return "\n".join(lines) + "\n"


def _labelled_by(names: list[str]) -> str:
    """The sentence naming who labelled, plain about a single labeller."""
    if names == ["controller"]:
        return (
            "Labelled by: controller only (a model labeller; no human labelled this sample,"
            " so there is no labeller-to-labeller agreement)."
        )
    if len(names) == 1:
        return (
            f"Labelled by: {names[0]} only"
            " (one labeller, so there is no labeller-to-labeller agreement)."
        )
    return f"Labelled by: {', '.join(names)}."


def _found(found: dict[str, Any]) -> str:
    return (
        f"n {found['n']}, agreement {_number(found['agreement'])}, weighted kappa {_kappa(found)}"
    )


def _kappa(found: dict[str, Any]) -> str:
    return _number(found["weighted_kappa"]) if found["kappa_shown"] else TOO_FEW_FOR_KAPPA


def _number(value: float | None) -> str:
    return "undefined" if value is None else f"{value:.3f}"
