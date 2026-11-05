"""The second judge: a recorded second opinion over stored answers (D-100).

A second judge model, of another family than the answer model and the
first judge, re-judges the stored answers of a run with the same judge
prompt, the same reply cap and the same parser. Each repeat's item is
rebuilt exactly as the first judge saw it (``runner.judge_item``, the same
blinding seed), so the two judges read the same prompt text.

It reads the run and never writes into it: everything goes to
``data/evaluation/second-judge/<run id>/<model slug>/``. ``verdicts.jsonl``
gains one line per repeat as it goes, so an interrupted pass resumes where
it stopped; a directory holds one model, one prompt and one set of model
settings only. ``summary.json`` is written at the end.

The label mode judges the hand-labelled sample's items (D-089) the same way
and measures each judge's correctness against the consensus label with the
labelling analysis.

Like the first judge it is descriptive: the tested results use the
deterministic scorer. It is evaluator-only: the item holds the expected
answer and the claim statements, which are evaluator data and never reach a
pipeline.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import os
import re
from collections import Counter
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import JudgeSettings, judge_settings_from_env
from app.evaluation import labelling
from app.evaluation.checks import is_abstention
from app.evaluation.grounding import BankInstance
from app.evaluation.judge import (
    JUDGE_DIMENSIONS,
    JUDGE_MAX_TOKENS,
    JUDGE_PROMPT_VERSION,
    GatewayJudge,
    JudgeScores,
    JudgeVerdict,
    agreement,
    judge_prompt_hash,
)
from app.evaluation.official import DATA_DIR, load_results, run_dir
from app.evaluation.report import MIN_KAPPA_ITEMS, judge_agreement
from app.evaluation.runner import (
    PIPELINES,
    InstanceResult,
    PipelineRun,
    RunScore,
    git_dirty,
    git_sha,
    instance_result_from_payload,
    judge_item,
)
from app.models.gateway import (
    Completion,
    CompletionRequest,
    EmptyCompletionError,
    GatewayError,
    complete,
)
from app.observability.logging import run_context

logger = logging.getLogger(__name__)

SECOND_JUDGE_DIR_NAME = "second-judge"
SECOND_JUDGE_ROOT = DATA_DIR / "evaluation" / SECOND_JUDGE_DIR_NAME
SUMMARY_SCHEMA_VERSION = 1
VERDICTS_FILE = "verdicts.jsonl"
SUMMARY_FILE = "summary.json"
# The directory of a label pass: "labels-" and the sample's directory name.
LABELS_PREFIX = "labels-"
ENV_PREFIX = "SECOND_JUDGE"
# The measure the label pass adds to the labelling analysis.
LABEL_MEASURE = "second_judge"
# Why a judge call gave no scores.
GATEWAY_ERROR = "gateway_error"
UNUSABLE_REPLY = "unusable_reply"
# The model answered with no text, as a thinking model does that spends the
# reply cap on hidden reasoning.
EMPTY_REPLY = "empty_reply"
# The fields every line of one directory shares; a line that differs is refused.
IDENTITY_FIELDS = (
    "model",
    "reasoning",
    "temperature",
    "max_tokens",
    "prompt_version",
    "prompt_hash",
)


@dataclass(frozen=True, slots=True)
class Target:
    """One stored repeat to judge again: ``key`` names its verdict line."""

    key: str
    instance: BankInstance
    run: PipelineRun
    score: RunScore


def repeat_key(instance_id: str, pipeline: str, repeat: int) -> str:
    return f"{instance_id}:{pipeline}:{repeat}"


def model_slug(model: str) -> str:
    """A directory name for a model: lower case, runs of other characters as "-"."""
    return re.sub(r"[^a-z0-9]+", "-", model.casefold()).strip("-")


def second_judge_settings() -> JudgeSettings:
    """The SECOND_JUDGE_* variables (see .env.example), read as JUDGE_* are."""
    settings = judge_settings_from_env(ENV_PREFIX)
    if settings.provider != "litellm":
        raise ValueError(
            f"the second judge calls a model: set {ENV_PREFIX}_PROVIDER=litellm and "
            f"{ENV_PREFIX}_MODEL (see .env.example), got provider {settings.provider!r}"
        )
    return dataclasses.replace(settings, max_tokens=_reply_limit())


def _reply_limit() -> int:
    """SECOND_JUDGE_MAX_TOKENS, the one setting that may differ from the first
    judge (D-100 amendment): a model that spends hidden tokens with reasoning
    off needs room to reply. Unset or empty is the first judge's limit."""
    name = f"{ENV_PREFIX}_MAX_TOKENS"
    raw = os.environ.get(name) or str(JUDGE_MAX_TOKENS)
    try:
        value = int(raw)
    except ValueError:
        value = 0
    if value < 1:
        raise ValueError(f"{name} must be a whole number of at least 1, got {raw!r}")
    return value


def reply_limit(settings: JudgeSettings) -> int:
    """The reply limit the judge is called with."""
    return settings.max_tokens or JUDGE_MAX_TOKENS


def check_second_family(
    second: str | None, generation: str | None, first_judge: str | None
) -> None:
    """Refuse a second judge with no family, or of the answer model's or the
    first judge's family (compared without case); refuse a run that does not
    record both of those."""
    if not second:
        raise ValueError(f"the second judge needs a model family ({ENV_PREFIX}_MODEL_FAMILY)")
    for role, family in (("answer model", generation), ("first judge", first_judge)):
        if not family:
            raise ValueError(
                f"the run records no {role} family, so the second judge cannot be checked"
            )
        if family.casefold() == second.casefold():
            raise ValueError(
                f"the second judge must be of another model family than the {role}; "
                f"both are {family!r}"
            )


def identity(settings: JudgeSettings) -> dict[str, Any]:
    """What every verdict line of one directory records alike."""
    return {
        "model": settings.model,
        "reasoning": settings.reasoning,
        "temperature": settings.temperature,
        "max_tokens": reply_limit(settings),
        "prompt_version": JUDGE_PROMPT_VERSION,
        "prompt_hash": judge_prompt_hash(),
    }


def judged_repeats(payload: dict[str, Any]) -> Iterator[Target]:
    """Every repeat of the run the first judge was asked about: each
    successful repeat, whether the first judge gave scores or failed."""
    for world in payload["worlds"]:
        for entry in world["results"]:
            result = instance_result_from_payload(entry)
            for tag, runs in result.runs.items():
                for run, score in zip(runs, result.scores[tag], strict=True):
                    if score is not None and score.judge is not None:
                        key = repeat_key(result.instance.instance_id, run.pipeline, run.repeat)
                        yield Target(key, result.instance, run, score)


def label_targets(payload: dict[str, Any], key: dict[str, Any]) -> list[Target]:
    """The sample's items as stored repeats of the run, keyed by item id."""
    repeats = {target.key: target for target in judged_repeats(payload)}
    targets = []
    for item_id, item in key["items"].items():
        found = repeats.get(repeat_key(item["instance_id"], item["pipeline"], item["repeat"]))
        if found is None:
            raise ValueError(f"{item_id}: the run holds no judged repeat {item['instance_id']}")
        targets.append(dataclasses.replace(found, key=item_id))
    return targets


class _Recorder:
    """The gateway, keeping the last call's completion, so its raw text and
    stop reason go into the record, or its gateway error, so the failure's
    kind does."""

    def __init__(self, gateway: Callable[[CompletionRequest], Completion]) -> None:
        self._gateway = gateway
        self.last: Completion | None = None
        self.error: GatewayError | None = None

    def __call__(self, request: CompletionRequest) -> Completion:
        self.last, self.error = None, None
        try:
            self.last = self._gateway(request)
        except GatewayError as error:
            self.error = error
            raise
        return self.last

    def failure_kind(self) -> str:
        """Why the last call gave no scores."""
        if self.last is not None:
            return UNUSABLE_REPLY
        return EMPTY_REPLY if isinstance(self.error, EmptyCompletionError) else GATEWAY_ERROR


def _scores(scores: JudgeScores | None) -> dict[str, int] | None:
    return None if scores is None else dataclasses.asdict(scores)


def _line(
    target: Target,
    verdict: JudgeVerdict,
    recorder: _Recorder,
    record: dict[str, Any],
    called_at: str,
) -> dict[str, Any]:
    first = target.score.judge
    assert first is not None
    completion = recorder.last
    kind = None if verdict.failure is None else recorder.failure_kind()
    return {
        **record,
        "key": target.key,
        "instance_id": target.instance.instance_id,
        "question_id": target.instance.question_id,
        "pipeline": target.run.pipeline,
        "repeat": target.run.repeat,
        "called_at": called_at,
        "scores": _scores(verdict.scores),
        "failure": verdict.failure,
        "failure_kind": kind,
        "raw_reply": None if completion is None else completion.text,
        "finish_reason": None if completion is None else completion.finish_reason,
        "token_limit_reached": None if completion is None else completion.token_limit_reached,
        "latency_ms": verdict.latency_ms,
        "first_judge": {
            "model": first.model,
            "scores": _scores(first.scores),
            "failure": first.failure,
        },
    }


def read_verdicts(path: Path, record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Each repeat's latest verdict line by key (a retried failure is
    followed by its new line). A last line cut short by an interruption is
    dropped from the file; a line of another model, prompt or model setting,
    reply limit included, than ``record`` is refused."""
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    kept = _complete(text)
    if kept != text:
        path.write_text(kept, encoding="utf-8")
    return _by_key(path, kept, record)


def stored_verdicts(path: Path, record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Read only, for a pass that may still be writing: each repeat's latest
    line by key, with a last line not yet complete left out and the file
    untouched; a line of another judge setting than ``record`` is refused."""
    if not path.exists():
        raise ValueError(f"{path} does not exist: the second judge has judged nothing here")
    return _by_key(path, _complete(path.read_text(encoding="utf-8")), record)


def _complete(text: str) -> str:
    """The text up to its last full line: a line cut short, by an
    interruption or because it is still being written, is left out."""
    return text if not text or text.endswith("\n") else text[: text.rfind("\n") + 1]


def _by_key(path: Path, text: str, record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lines = [json.loads(line) for line in text.splitlines() if line.strip()]
    for line in lines:
        mixed = [f for f in IDENTITY_FIELDS if line.get(f) != record[f]]
        if mixed:
            shown = ", ".join(f"{f} {line.get(f)!r} (now {record[f]!r})" for f in mixed)
            raise ValueError(
                f"{path} holds verdicts of another judge setting ({shown}); one directory "
                "holds one model and one prompt, so use another directory"
            )
    return {line["key"]: line for line in lines}


def judge_targets(
    targets: Sequence[Target],
    settings: JudgeSettings,
    out_dir: Path,
    run_id: str,
    gateway: Callable[[CompletionRequest], Completion] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> dict[str, dict[str, Any]]:
    """Judge every target that has no scores yet in ``out_dir``'s verdicts,
    appending one line per call as it goes: a resumed pass skips the scored
    repeats and retries the failed ones, and a repeat's latest line is the
    one that counts. Returns each repeat's latest line by key."""
    record = identity(settings)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / VERDICTS_FILE
    done = read_verdicts(path, record)
    recorder = _Recorder(gateway or complete)
    judge = GatewayJudge(settings, gateway=recorder)
    todo = [
        target for target in targets if target.key not in done or done[target.key]["scores"] is None
    ]
    with path.open("a", encoding="utf-8") as handle:
        for count, target in enumerate(todo, start=1):
            called_at = datetime.now(UTC).isoformat()
            verdict = judge.judge(judge_item(target.instance, target.run))
            line = _line(target, verdict, recorder, record, called_at)
            handle.write(json.dumps(line) + "\n")
            handle.flush()
            done[target.key] = line
            _log(run_id, line)
            if on_progress is not None:
                on_progress(len(targets) - len(todo) + count, len(targets))
    return done


def _log(run_id: str, line: dict[str, Any]) -> None:
    """One structured record per call: identifiers, timing and failure only."""
    with run_context(run_id=run_id, question_id=line["question_id"], pipeline=line["pipeline"]):
        logger.info(
            "second judge verdict",
            extra={
                "instance_id": line["instance_id"],
                "repeat": line["repeat"],
                "judge_model": line["model"],
                "latency_ms": line["latency_ms"],
                "failure_kind": line["failure_kind"],
                "failure": line["failure"],
            },
        )


def _verdict(line: dict[str, Any] | None) -> JudgeVerdict | None:
    if line is None:
        return None
    scores = None if line["scores"] is None else JudgeScores(**line["scores"])
    return JudgeVerdict(scores, line["failure"], line["model"], line["latency_ms"])


def _with_second(
    results: Sequence[InstanceResult], verdicts: dict[str, dict[str, Any]]
) -> list[InstanceResult]:
    """The results with each judgement replaced by the second judge's; a
    repeat it has no line for has no judgement."""
    return [
        dataclasses.replace(
            result,
            scores={
                tag: [
                    None
                    if score is None
                    else dataclasses.replace(
                        score,
                        judge=_verdict(
                            verdicts.get(
                                repeat_key(result.instance.instance_id, run.pipeline, run.repeat)
                            )
                        ),
                    )
                    for run, score in zip(result.runs[tag], scores, strict=True)
                ]
                for tag, scores in result.scores.items()
            },
        )
        for result in results
    ]


def _both(
    results: Sequence[InstanceResult], verdicts: dict[str, dict[str, Any]]
) -> Iterator[tuple[PipelineRun, JudgeScores, JudgeScores]]:
    """Each repeat both judges gave scores, with the two judgements."""
    for result in results:
        for tag, runs in result.runs.items():
            for run, score in zip(runs, result.scores[tag], strict=True):
                line = verdicts.get(
                    repeat_key(result.instance.instance_id, run.pipeline, run.repeat)
                )
                if (
                    score is None
                    or score.judge is None
                    or score.judge.scores is None
                    or line is None
                    or line["scores"] is None
                ):
                    continue
                yield run, score.judge.scores, JudgeScores(**line["scores"])


def between_judges(
    results: Sequence[InstanceResult], verdicts: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Correctness of the first judge against the second over the repeats
    both judged, split by whether the answer abstained: exact agreement,
    linear weighted kappa and the 3x3 count, rows the first judge's level."""
    pairs: dict[str, list[tuple[int, int]]] = {"answered": [], "abstained": []}
    for run, first, second in _both(results, verdicts):
        key = "abstained" if is_abstention(run.verdict) else "answered"
        pairs[key].append((first.correctness, second.correctness))
    found = {}
    for key, split in pairs.items():
        confusion = [[0, 0, 0] for _ in range(3)]
        for a, b in split:
            confusion[a][b] += 1
        found[key] = {**dataclasses.asdict(agreement(split)), "confusion": confusion}
    return found


def judge_means(
    results: Sequence[InstanceResult], verdicts: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Per pipeline, each judge's mean of the five dimensions over the
    repeats both judged; descriptive."""
    both: dict[str, list[tuple[JudgeScores, JudgeScores]]] = {}
    for run, first, second in _both(results, verdicts):
        both.setdefault(run.pipeline, []).append((first, second))
    return {
        tag: {
            "n": len(both[tag]),
            "first": _dimension_means(first for first, _ in both[tag]),
            "second": _dimension_means(second for _, second in both[tag]),
        }
        for tag in PIPELINES
        if tag in both
    }


def _dimension_means(scores: Iterable[JudgeScores]) -> dict[str, float]:
    kept = list(scores)
    return {
        dimension: sum(getattr(s, dimension) for s in kept) / len(kept)
        for dimension in JUDGE_DIMENSIONS
    }


def _counts(targets: Sequence[Target], verdicts: dict[str, dict[str, Any]]) -> dict[str, Any]:
    lines = [verdicts[t.key] for t in targets if t.key in verdicts]
    failed = [line for line in lines if line["failure"] is not None]
    return {
        "repeats": len(targets),
        "judged": sum(line["scores"] is not None for line in lines),
        "failures": len(failed),
        "pending": len(targets) - len(lines),
        "failure_kinds": dict(sorted(Counter(line["failure_kind"] for line in failed).items())),
        "failure_messages": dict(Counter(line["failure"] for line in failed).most_common()),
        "cut_off_replies": sum(line["token_limit_reached"] is True for line in lines),
    }


def _header(
    kind: str,
    settings: JudgeSettings,
    record: dict[str, Any],
    targets: Sequence[Target],
    verdicts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """The fields every summary carries, in order."""
    called = [verdicts[t.key]["called_at"] for t in targets if t.key in verdicts]
    return {
        "schema_version": SUMMARY_SCHEMA_VERSION,
        "kind": kind,
        "second_judge": {
            "model": settings.model,
            "model_family": settings.model_family,
            "reasoning": settings.reasoning,
            "temperature": settings.temperature,
            "max_tokens": reply_limit(settings),
        },
        "judge_prompt_version": JUDGE_PROMPT_VERSION,
        "judge_prompt_hash": judge_prompt_hash(),
        "first_judge": {
            "model": record.get("judge_model"),
            "model_family": record.get("judge_model_family"),
            "prompt_version": record.get("judge_prompt_version"),
            # Runs do not record it: the judge's reply limit is the code's.
            "max_tokens": JUDGE_MAX_TOKENS,
        },
        "generation_model": record.get("generation_model"),
        "started_at": min(called, default=None),
        "finished_at": datetime.now(UTC).isoformat(),
        "git_sha": git_sha(),
        "git_dirty": git_dirty(),
        "min_kappa_items": MIN_KAPPA_ITEMS,
        "counts": _counts(targets, verdicts),
    }


def run_summary(
    run_id: str,
    payload: dict[str, Any],
    settings: JudgeSettings,
    verdicts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """The second judge's summary over one run."""
    record = payload["reproducibility"]["run"]
    results = [
        instance_result_from_payload(entry)
        for world in payload["worlds"]
        for entry in world["results"]
    ]
    pipelines = [tag for tag in PIPELINES if any(tag in r.scores for r in results)]
    return {
        **_header("run", settings, record, list(judged_repeats(payload)), verdicts),
        "run_id": run_id,
        "agreement_with_answer_level": {
            "first": judge_agreement(results, pipelines),
            "second": judge_agreement(_with_second(results, verdicts), pipelines),
        },
        "agreement_between_judges": between_judges(results, verdicts),
        "means": judge_means(results, verdicts),
    }


def run_out_dir(root: Path, run_id: str, model: str) -> Path:
    return root / run_id / model_slug(model)


def labels_out_dir(root: Path, sample_dir: Path, model: str) -> Path:
    return root / f"{LABELS_PREFIX}{sample_dir.name}" / model_slug(model)


def refuse_runs(out_dir: Path, source: Path) -> None:
    """Refuse a location inside the run or anywhere under the runs root."""
    where = out_dir.resolve()
    for runs in (source, labelling.RUNS_ROOT):
        if where.is_relative_to(runs.resolve()):
            raise ValueError(f"{out_dir} is inside {runs}; the second judge never writes there")


def _write_summary(out_dir: Path, summary: dict[str, Any]) -> Path:
    path = out_dir / SUMMARY_FILE
    path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return path


def judge_run(
    source: Path,
    settings: JudgeSettings,
    out_root: Path | None = None,
    gateway: Callable[[CompletionRequest], Completion] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> Path:
    """Judge every judged repeat of the run in ``source`` again and write
    the verdicts and the summary under ``out_root``. Returns the summary."""
    payload = load_results(source)
    record = payload["reproducibility"]["run"]
    check_second_family(
        settings.model_family,
        record.get("generation_model_family"),
        record.get("judge_model_family"),
    )
    out_dir = run_out_dir(out_root or SECOND_JUDGE_ROOT, source.name, settings.model)
    refuse_runs(out_dir, source)
    targets = list(judged_repeats(payload))
    verdicts = judge_targets(targets, settings, out_dir, source.name, gateway, on_progress)
    return _write_summary(out_dir, run_summary(source.name, payload, settings, verdicts))


def judge_labels(
    sample_dir: Path,
    settings: JudgeSettings,
    out_root: Path | None = None,
    source: Path | None = None,
    gateway: Callable[[CompletionRequest], Completion] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> Path:
    """Judge the labelled items of ``sample_dir`` (stored repeats of the run
    its key names, or of ``source``) and measure both judges against the
    consensus labels. Returns the summary."""
    path = sample_dir / "key.json"
    if not path.exists():
        raise ValueError(f"{sample_dir} holds no key.json; draw the sample first")
    key = json.loads(path.read_text(encoding="utf-8"))
    source = source or run_dir(key["run"])
    payload = load_results(source)
    record = payload["reproducibility"]["run"]
    check_second_family(
        settings.model_family,
        record.get("generation_model_family"),
        record.get("judge_model_family"),
    )
    out_dir = labels_out_dir(out_root or SECOND_JUDGE_ROOT, sample_dir, settings.model)
    refuse_runs(out_dir, source)
    # Refuse missing or unsettled labels before any model call, not hours later.
    labelling.label_agreement(sample_dir, source)
    targets = label_targets(payload, key)
    verdicts = judge_targets(targets, settings, out_dir, source.name, gateway, on_progress)
    levels = {
        item_id: line["scores"]["correctness"]
        for item_id, line in verdicts.items()
        if line["scores"] is not None
    }
    described = f"second judge {settings.model} with judge prompt {JUDGE_PROMPT_VERSION}"
    found = labelling.label_agreement(
        sample_dir, source, extra={LABEL_MEASURE: (described, levels)}
    )
    summary = {
        **_header("labels", settings, record, targets, verdicts),
        "run_id": source.name,
        "sample": sample_dir.name,
        "agreement_with_labels": found,
    }
    return _write_summary(out_dir, summary)


def _newest(paths: Iterable[Path]) -> dict[str, Any] | None:
    summaries = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    kept = [s for s in summaries if s.get("schema_version") == SUMMARY_SCHEMA_VERSION]
    return max(kept, key=lambda s: str(s["finished_at"]), default=None)


def published(root: Path, run_id: str) -> tuple[dict[str, Any], dict[str, Any] | None] | None:
    """The newest second-judge summary of the run under ``root``, and the
    newest label summary of the same model; None when the run has none.
    ``run_id`` must already be a published run's name."""
    found = _newest((root / run_id).glob(f"*/{SUMMARY_FILE}"))
    if found is None:
        return None
    slug = model_slug(found["second_judge"]["model"])
    labels = _newest(root.glob(f"{LABELS_PREFIX}*/{slug}/{SUMMARY_FILE}"))
    return found, labels
