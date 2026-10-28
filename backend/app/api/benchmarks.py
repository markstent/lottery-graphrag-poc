"""Benchmark routes: published runs, the question catalogue and benchmark jobs.

Published runs are the run directories under ``ApiSettings.benchmark_dir``
that hold a ``summary.json`` of the schema the report writes; the harness
writes that file last, so a run is published only once it is complete.

The question catalogue lists the frozen bank of the presentation world with
each question's answer key, the hidden truth of a planted pattern and the
per-pipeline scores of a published run, all read from evaluator output.

A benchmark job runs ``run_benchmark`` on one background thread in this
process; one job runs at a time, and never while a live run holds the graph
(``GraphLease``), because the run ingests other worlds into the same Neo4j.
Cancellation is cooperative, between instances. Jobs live in memory only: a
restart loses a running job, and its run directory, having no
``summary.json``, is never published.

This is one of the two API modules that may import ``app.evaluation``
(ADR-008); it reaches the ledger only through the evaluator's functions.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import threading
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import ValidationError

from app.api.errors import (
    CANCELLED_BODY,
    ApiError,
    ApiErrorBody,
    ErrorCode,
    classify,
    run_error_body,
)
from app.api.graph_world import GraphLease, LeaseHold
from app.api.schemas import (
    BenchmarkJob,
    BenchmarkRunOut,
    BenchmarkStart,
    BenchmarkSummary,
    ExperimentSettings,
    InstancePipelineOut,
    InstanceResultOut,
    JobProgress,
    JobStatus,
    PipelineScore,
    QuestionOut,
    SummaryOut,
    error_responses,
)
from app.api.scoring import require_bank
from app.config import REPO_ROOT, from_env, judge_settings_from_env
from app.evaluation.bank import STRATA
from app.evaluation.catalogue import LedgerMismatch, instance_scores, question_catalogue
from app.evaluation.grounding import FrozenBank, GroundingError, load_frozen_bank
from app.evaluation.judge import FakeJudge, GatewayJudge
from app.evaluation.official import (
    PRESENTATION_SEED,
    SEEN_SEEDS,
    BenchmarkCancelled,
    NotDevWorld,
    bank_matches_active_world,
    check_seeds,
    ground_command,
    kept_world_count,
    load_results,
    method_of,
    preflight,
    run_benchmark,
    run_id,
    world_paths,
)
from app.evaluation.report import SUMMARY_SCHEMA_VERSION, instance_means
from app.evaluation.runner import (
    OFFICIAL_MIN_REPEATS,
    WORLD_MANIFEST,
    instance_result_from_payload,
    settings_fields,
)
from app.observability.logging import run_context

logger = logging.getLogger(__name__)

# The summary schemas the API publishes: 2 for runs of method v0.2 (such as
# the official run v0.2.0), the current one for method v0.3.
PUBLISHED_SCHEMA_VERSIONS = frozenset({"2", SUMMARY_SCHEMA_VERSION})
# The worlds a benchmark job may name: the seen ones only. The official run on
# the unseen seeds goes through ``make run-benchmark`` after the owner's
# go-ahead, never through the API (D-091); ``check_seeds`` still refuses a
# full-bank official start on them.
JOB_SEEDS = SEEN_SEEDS

Published = tuple[str, dict[str, Any]]

# What a run records about the checkout, which is not a setting.
_GIT_FIELDS = frozenset({"git_sha", "git_dirty"})
# The fields that name the judge model; the offline judge is no model.
_JUDGE_MODEL_FIELDS = ("judge_model", "judge_model_family", "judge_reasoning", "judge_temperature")


def stale_bank_message() -> str:
    """The 503 message of a bank that is not current, naming the command that grounds it."""
    return f"the question bank does not match the active world; run {ground_command()}"


def published_runs(runs_dir: Path) -> list[Published]:
    """Every published run under ``runs_dir``, newest first: the latest
    ``reproducibility.run.started_at`` as a point in time, then the directory
    name. A malformed summary raises rather than being skipped."""
    runs: list[Published] = []
    for path in runs_dir.glob("*/summary.json"):
        summary = json.loads(path.read_text(encoding="utf-8"))
        if summary.get("schema_version") in PUBLISHED_SCHEMA_VERSIONS:
            runs.append((path.parent.name, summary))
    return sorted(runs, key=_started, reverse=True)


def _started(run: Published) -> tuple[datetime, str]:
    return datetime.fromisoformat(run[1]["reproducibility"]["run"]["started_at"]), run[0]


def latest_official(runs: list[Published]) -> Published | None:
    """The newest official run of the whole bank (no strata, no limit)."""
    return next((run for run in runs if run[1]["run_kind"] == "official" and _full(run[1])), None)


def latest_benchmark(runs_dir: Path) -> Published | None:
    """The newest official run of the whole bank, else the newest run of any
    kind (a subset official run, such as a pilot, counts as any kind and is
    published with its label)."""
    runs = published_runs(runs_dir)
    return latest_official(runs) or next(iter(runs), None)


def _full(summary: dict[str, Any]) -> bool:
    """Whether the run scored the whole bank (no strata, no per-question limit)."""
    return bool(summary["selection"] == {"strata": None, "limit": None})


def _published(runs_dir: Path, name: str) -> Published:
    """The published run called ``name``; a 404 for any other name, so no
    path outside ``runs_dir`` is ever read."""
    run = next((run for run in published_runs(runs_dir) if run[0] == name), None)
    if run is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, f"no published benchmark run {name!r}")
    return run


def _summary_out(run: Published) -> BenchmarkSummary:
    """The run's summary, typed; one that does not fit is a 500 naming the run."""
    name, summary = run
    try:
        typed = SummaryOut.model_validate(summary)
    except ValidationError as error:
        raise RuntimeError(
            f"the summary of benchmark run {name!r} is malformed: {error}"
        ) from error
    return BenchmarkSummary(
        run_id=name,
        run_kind=typed.run_kind,
        label=typed.label,
        method_version=method_of(summary["reproducibility"]["run"]),
        summary=typed,
    )


def _instances(runs_dir: Path, name: str) -> list[InstanceResultOut]:
    """Each scored instance of the run with its pipelines' means: the
    question's text and scores, never its answer key or any answer text."""
    _published(runs_dir, name)
    try:
        results = load_results(runs_dir / name)
    except ValueError:
        raise ApiError(404, ErrorCode.NOT_FOUND, "This run has no per-question results.") from None
    out = []
    for world in results["worlds"]:
        for payload in world["results"]:
            result = instance_result_from_payload(payload)
            instance = result.instance
            means = instance_means(result)
            out.append(
                InstanceResultOut(
                    instance_id=instance.instance_id,
                    question_id=instance.question_id,
                    world_seed=instance.world_seed,
                    stratum=instance.stratum,
                    sub_stratum=instance.sub_stratum,
                    ontology_dependent=instance.ontology_dependent,
                    text=instance.text,
                    pipelines={
                        tag: InstancePipelineOut(
                            repeats=len(scores),
                            unscored_repeats=sum(score is None for score in scores),
                            failure_classes=dict(
                                sorted(
                                    Counter(
                                        score.failure_class
                                        for score in scores
                                        if score is not None and score.failure_class
                                    ).items()
                                )
                            ),
                            **{
                                metric: means[tag][metric]
                                for metric in InstancePipelineOut.model_fields
                                if metric in means[tag]
                            },
                        )
                        for tag, scores in result.scores.items()
                    },
                )
            )
    return out


def presentation_bank() -> FrozenBank | None:
    """The frozen bank of the presentation world (``DATASET_DIR`` and
    the world's ledger), or None before it is grounded.

    A bank that does not match the world (its manifest, ledger, bank version
    or record serialiser), or that is corrupt, is a 503
    ``CONFIGURATION_ERROR``, and so is an invalid setting, which the message
    names. The bank is loaded and checked once, then served until the size or
    modification time of the bank, the world manifest or the ledger changes.
    """
    try:
        paths = world_paths(PRESENTATION_SEED)
    except ValueError as error:
        raise ApiError(
            503, ErrorCode.CONFIGURATION_ERROR, f"invalid configuration: {error}"
        ) from None
    if not paths.bank_path.is_file():
        return None
    files = (paths.bank_path, paths.world_dir / WORLD_MANIFEST, paths.ledger_path)
    stamp = tuple(_stat_key(file) for file in files)
    cached = _checked
    if cached is not None and cached[0] == (files, stamp):
        return cached[1]
    try:
        bank = load_frozen_bank(paths.bank_path)
    except GroundingError as error:
        logger.warning("question bank refused", extra={"reason": str(error)})
        raise ApiError(503, ErrorCode.CONFIGURATION_ERROR, stale_bank_message()) from None
    if not bank_matches_active_world():
        logger.warning(
            "question bank refused", extra={"reason": "not current for the active world"}
        )
        raise ApiError(503, ErrorCode.CONFIGURATION_ERROR, stale_bank_message())
    _remember((files, stamp), bank)
    return bank


# The last bank that passed the checks, with the files and stamps it passed on.
_checked: tuple[tuple[tuple[Path, ...], tuple[tuple[int, int] | None, ...]], FrozenBank] | None = (
    None
)


def _remember(
    key: tuple[tuple[Path, ...], tuple[tuple[int, int] | None, ...]], bank: FrozenBank
) -> None:
    global _checked
    _checked = (key, bank)


def _stat_key(path: Path) -> tuple[int, int] | None:
    """The modification time and size of a file, None when it is missing."""
    try:
        info = path.stat()
    except FileNotFoundError:
        return None
    return info.st_mtime_ns, info.st_size


def _questions(runs_dir: Path, name: str | None) -> list[QuestionOut]:
    """The presentation bank's questions, scored by the named run, else by
    the newest official run of the whole bank; unscored without either."""
    bank = require_bank(presentation_bank())
    paths = world_paths(PRESENTATION_SEED)
    try:
        cards = question_catalogue(bank, paths.ledger_path)
    except LedgerMismatch as error:
        logger.warning("question catalogue refused", extra={"reason": str(error)})
        # The ledger changed after the bank was checked: the bank no longer matches.
        raise ApiError(503, ErrorCode.CONFIGURATION_ERROR, stale_bank_message()) from None
    run = (
        _published(runs_dir, name)
        if name is not None
        else latest_official(published_runs(runs_dir))
    )
    scores = {} if run is None else instance_scores(load_results(runs_dir / run[0]), bank)
    return [
        QuestionOut(
            **dataclasses.asdict(card),
            scores=(
                {tag: PipelineScore(**dataclasses.asdict(m)) for tag, m in by_tag.items()}
                if (by_tag := scores.get(card.instance_id)) is not None
                else None
            ),
        )
        for card in cards
    ]


def _job_out(job: _Job) -> BenchmarkJob:
    return BenchmarkJob(
        job_id=job.job_id,
        status=job.status,
        run_id=job.run_id,
        error=job.error,
        progress=job.progress,
    )


@dataclasses.dataclass
class _Job:
    job_id: str
    cancelled: threading.Event
    status: JobStatus = "running"
    run_id: str | None = None
    error: ApiErrorBody | None = None
    progress: JobProgress | None = None
    seeds: tuple[int, ...] = ()


class BenchmarkJobs:
    """Starts, tracks and cancels benchmark jobs, one at a time.

    ``_lock`` guards the job map and each job's fields; the graph lease
    makes a job and a live run exclude each other.
    """

    def __init__(self, runs_dir: Path, lease: GraphLease) -> None:
        self._runs_dir = runs_dir
        self._lease = lease
        self._lock = threading.Lock()
        self._jobs: dict[str, _Job] = {}

    def start(self, request: BenchmarkStart) -> BenchmarkJob:
        """Check the request and the run settings, take the graph and start
        the job's thread; a 422 or a 409 starts nothing."""
        _check(request)
        try:
            preflight(request.kind, request.repeats)
        except NotDevWorld as error:
            raise ApiError(503, ErrorCode.CONFIGURATION_ERROR, str(error)) from None
        except ValueError as error:
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, str(error)) from None
        hold = self._lease.take_benchmark()
        try:
            job = _Job(
                job_id=f"JOB-{uuid.uuid4().hex[:12].upper()}",
                cancelled=threading.Event(),
                seeds=tuple(request.seeds),
            )
            with self._lock:
                self._jobs[job.job_id] = job
            out_dir = self._runs_dir / run_id(request.kind)
            threading.Thread(
                target=self._execute,
                args=(job, request, out_dir, hold),
                name=f"benchmark-{job.job_id}",
                daemon=True,
            ).start()
        except BaseException:
            hold.release()
            raise
        return self.get(job.job_id)

    def get(self, job_id: str) -> BenchmarkJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise ApiError(404, ErrorCode.NOT_FOUND, f"unknown benchmark job {job_id!r}")
            return _job_out(job)

    def all_jobs(self) -> list[BenchmarkJob]:
        """Every job since the server started, newest first."""
        with self._lock:
            return [_job_out(job) for job in reversed(self._jobs.values())]

    def cancel(self, job_id: str) -> BenchmarkJob:
        """Ask a running job to stop; a 409 once it finished.

        Cancellation is cooperative: the job stops before its next instance
        or world, so the instance in progress (every repeat of every pipeline,
        and its judging) finishes first, which can take minutes on an
        official run. The job then ingests the presentation world again.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None and job.status != "running":
                raise ApiError(
                    409, ErrorCode.CONFLICT, f"benchmark job {job_id} has already finished"
                )
            if job is not None:
                job.cancelled.set()
        return self.get(job_id)

    def _execute(self, job: _Job, request: BenchmarkStart, out_dir: Path, hold: LeaseHold) -> None:
        """Run the job; whatever ends it, the job ends with a terminal status,
        published only after the graph is free (``run_benchmark`` has already
        restored the presentation graph)."""
        with run_context(run_id=job.job_id):
            try:
                run_benchmark(
                    request.kind,
                    request.seeds,
                    request.repeats,
                    out_dir,
                    strata=request.strata,
                    limit=request.limit,
                    cancelled=job.cancelled,
                    on_progress=lambda seed, done, total: self._progress(job, seed, done, total),
                )
                self._finish(job, hold, "completed", run_id=out_dir.name)
            except BenchmarkCancelled:
                self._finish(
                    job, hold, "cancelled", error=_with_kept_worlds(None, request, out_dir)
                )
            except BaseException as error:  # surfaced as a typed error, never a trace
                code, _retryable = classify(error)
                logger.error("benchmark job failed", exc_info=error, extra={"error_code": code})
                self._finish(job, hold, "failed", error=_with_kept_worlds(error, request, out_dir))
                if isinstance(error, (KeyboardInterrupt, SystemExit)):
                    raise  # recorded; shutdown still sees it
            finally:
                hold.release()

    def _progress(self, job: _Job, seed: int, done: int, total: int) -> None:
        with self._lock:
            # A world counts as done once its last instance is: the last report is complete.
            job.progress = JobProgress(
                world_seed=seed,
                instances_done=done,
                instances_total=total,
                worlds_done=job.seeds.index(seed) + (done == total),
                worlds_total=len(job.seeds),
            )

    def _finish(
        self,
        job: _Job,
        hold: LeaseHold,
        status: JobStatus,
        run_id: str | None = None,
        error: ApiErrorBody | None = None,
    ) -> None:
        """Free the graph, then publish the job's terminal status."""
        hold.release()
        self._publish(job, status, run_id, error)

    def _publish(
        self, job: _Job, status: JobStatus, run_id: str | None, error: ApiErrorBody | None
    ) -> None:
        with self._lock:
            job.status, job.run_id, job.error = status, run_id, error


def _with_kept_worlds(
    error: BaseException | None, request: BenchmarkStart, out_dir: Path
) -> ApiErrorBody | None:
    """The body of a failed or cancelled job; when the run kept finished worlds
    it says how many and names the command that resumes the run (the API
    itself never resumes). ``error`` is None for a cancelled job."""
    kept = kept_world_count(out_dir)
    body = CANCELLED_BODY if error is None else run_error_body(error)
    if kept == 0:
        return None if error is None else body
    options = [
        f"--kind {request.kind}",
        f"--seeds {','.join(str(seed) for seed in request.seeds)}",
        f"--repeats {request.repeats}",
    ]
    if request.strata is not None:
        options.append(f"--strata {','.join(request.strata)}")
    if request.limit is not None:
        options.append(f"--limit {request.limit}")
    # Relative to the repository root when inside it: the CLI resolves --out from there.
    shown = out_dir.relative_to(REPO_ROOT) if out_dir.is_relative_to(REPO_ROOT) else out_dir
    # The form the Makefile uses, so the command works pasted at the repository root.
    command = (
        "uv --directory backend run python -m app.evaluation run "
        f"{' '.join(options)} --out {shown} --resume"
    )
    worlds = "world was" if kept == 1 else "worlds were"
    return body.model_copy(
        update={"message": f"{body.message} {kept} finished {worlds} kept; resume with: {command}"}
    )


def _check(request: BenchmarkStart) -> None:
    """Refuse seeds and strata the harness does not run, and seeds the
    request's kind may not use (the unseen worlds, D-091), as a 422."""
    if unknown := sorted(set(request.seeds) - set(JOB_SEEDS)):
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            f"unknown seeds {unknown}; expected some of {list(JOB_SEEDS)}",
        )
    if len(set(request.seeds)) != len(request.seeds):
        raise ApiError(422, ErrorCode.VALIDATION_ERROR, "seeds must not repeat")
    try:
        check_seeds(
            request.kind, request.seeds, full_bank=request.strata is None and request.limit is None
        )
    except ValueError as error:
        raise ApiError(422, ErrorCode.VALIDATION_ERROR, f"seeds: {error}") from None
    if request.strata is not None and (unknown_strata := sorted(set(request.strata) - set(STRATA))):
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            f"unknown strata {unknown_strata}; expected some of {list(STRATA)}",
        )


def _experiment_settings() -> ExperimentSettings:
    """The fields an official run records, from the environment now. The judge is
    built without a model call; with no judge model set its fields are None."""
    try:
        judge_settings = judge_settings_from_env()
        configured = judge_settings.provider != "fake"
        judge = GatewayJudge(judge_settings) if configured else FakeJudge()
        fields = settings_fields(from_env(), judge, "official", OFFICIAL_MIN_REPEATS)
    except ValueError as error:
        raise ApiError(
            503, ErrorCode.CONFIGURATION_ERROR, f"invalid configuration: {error}"
        ) from error
    values = {key: value for key, value in fields.items() if key not in _GIT_FIELDS}
    if not configured:
        values.update({key: None for key in _JUDGE_MODEL_FIELDS})
    return ExperimentSettings(values=values, judge_configured=configured)


def build_benchmarks_router(runs_dir: Path, jobs: BenchmarkJobs) -> APIRouter:
    """The benchmark routes over ``runs_dir`` (ApiSettings.benchmark_dir)."""
    router = APIRouter()

    @router.get("/settings", response_model=ExperimentSettings, responses=error_responses(503))
    def read_settings() -> ExperimentSettings:
        return _experiment_settings()

    @router.get("/benchmarks", response_model=list[BenchmarkRunOut], responses=error_responses())
    def list_benchmarks() -> list[BenchmarkRunOut]:
        return [
            BenchmarkRunOut(
                run_id=name,
                run_kind=summary["run_kind"],
                label=summary["label"],
                method_version=method_of(summary["reproducibility"]["run"]),
                started_at=summary["reproducibility"]["run"]["started_at"],
                selection=summary["selection"],
                worlds=summary["worlds"],
                headlines=summary.get("headlines", []),
            )
            for name, summary in published_runs(runs_dir)
        ]

    @router.get(
        "/benchmarks/latest", response_model=BenchmarkSummary, responses=error_responses(404)
    )
    def read_latest_benchmark() -> BenchmarkSummary:
        latest = latest_benchmark(runs_dir)
        if latest is None:
            raise ApiError(404, ErrorCode.NOT_FOUND, "no published benchmark run")
        return _summary_out(latest)

    @router.get(
        "/benchmarks/questions",
        response_model=list[QuestionOut],
        responses=error_responses(404, 422, 503),
    )
    def read_questions(run_id: str | None = None) -> list[QuestionOut]:
        return _questions(runs_dir, run_id)

    @router.post(
        "/benchmarks",
        status_code=202,
        response_model=BenchmarkJob,
        responses=error_responses(409, 422, 503),
    )
    def start_benchmark(request: BenchmarkStart) -> BenchmarkJob:
        return jobs.start(request)

    @router.get("/benchmarks/jobs", response_model=list[BenchmarkJob], responses=error_responses())
    def list_jobs() -> list[BenchmarkJob]:
        return jobs.all_jobs()

    @router.get(
        "/benchmarks/jobs/{job_id}",
        response_model=BenchmarkJob,
        responses=error_responses(404, 422),
    )
    def read_job(job_id: str) -> BenchmarkJob:
        return jobs.get(job_id)

    @router.post(
        "/benchmarks/jobs/{job_id}/cancel",
        status_code=202,
        response_model=BenchmarkJob,
        responses=error_responses(404, 409, 422),
    )
    def cancel_job(job_id: str) -> BenchmarkJob:
        """Request the job to stop before its next instance; the instance in
        progress finishes first, so the job stays running until then."""
        return jobs.cancel(job_id)

    @router.get(
        "/benchmarks/{run_id}/instances",
        response_model=list[InstanceResultOut],
        responses=error_responses(404, 422),
    )
    def read_instances(run_id: str) -> list[InstanceResultOut]:
        return _instances(runs_dir, run_id)

    # Last: the run id is a free path segment.
    @router.get(
        "/benchmarks/{run_id}", response_model=BenchmarkSummary, responses=error_responses(404, 422)
    )
    def read_benchmark(run_id: str) -> BenchmarkSummary:
        return _summary_out(_published(runs_dir, run_id))

    return router
