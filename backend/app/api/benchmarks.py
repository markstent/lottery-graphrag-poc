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
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from app.api.errors import ApiError, ApiErrorBody, ErrorCode, classify, run_error_body
from app.api.graph_world import GraphLease
from app.api.schemas import (
    BenchmarkJob,
    BenchmarkRunOut,
    BenchmarkStart,
    BenchmarkSummary,
    JobProgress,
    JobStatus,
    PipelineScore,
    QuestionOut,
)
from app.evaluation.bank import STRATA
from app.evaluation.catalogue import instance_scores, question_catalogue
from app.evaluation.grounding import load_frozen_bank
from app.evaluation.official import (
    OFFICIAL_SEEDS,
    PRESENTATION_SEED,
    BenchmarkCancelled,
    load_results,
    preflight,
    run_benchmark,
    run_id,
    world_paths,
)
from app.evaluation.report import SUMMARY_SCHEMA_VERSION
from app.observability.logging import run_context

logger = logging.getLogger(__name__)

Published = tuple[str, dict[str, Any]]


def published_runs(runs_dir: Path) -> list[Published]:
    """Every published run under ``runs_dir``, newest first: the latest
    ``reproducibility.run.started_at`` as a point in time, then the directory
    name. A malformed summary raises rather than being skipped."""
    runs: list[Published] = []
    for path in runs_dir.glob("*/summary.json"):
        summary = json.loads(path.read_text(encoding="utf-8"))
        if summary.get("schema_version") == SUMMARY_SCHEMA_VERSION:
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
    name, summary = run
    return BenchmarkSummary(
        run_id=name, run_kind=summary["run_kind"], label=summary["label"], summary=summary
    )


def _questions(runs_dir: Path, name: str | None) -> list[QuestionOut]:
    """The presentation bank's questions, scored by the named run, else by
    the newest official run of the whole bank; unscored without either."""
    paths = world_paths(PRESENTATION_SEED)
    if not paths.bank_path.is_file():
        raise ApiError(
            404,
            ErrorCode.NOT_FOUND,
            f"no frozen bank for world seed {PRESENTATION_SEED}; run a benchmark to ground it",
        )
    bank = load_frozen_bank(paths.bank_path)
    cards = question_catalogue(bank, paths.ledger_path)
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


@dataclasses.dataclass
class _Job:
    job_id: str
    cancelled: threading.Event
    status: JobStatus = "running"
    run_id: str | None = None
    error: ApiErrorBody | None = None
    progress: JobProgress | None = None


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
        except ValueError as error:
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, str(error)) from None
        self._lease.take_benchmark()
        try:
            job = _Job(job_id=f"JOB-{uuid.uuid4().hex[:12].upper()}", cancelled=threading.Event())
            with self._lock:
                self._jobs[job.job_id] = job
            out_dir = self._runs_dir / run_id(request.kind)
            threading.Thread(
                target=self._execute,
                args=(job, request, out_dir),
                name=f"benchmark-{job.job_id}",
                daemon=True,
            ).start()
        except BaseException:
            self._lease.release_benchmark()
            raise
        return self.get(job.job_id)

    def get(self, job_id: str) -> BenchmarkJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise ApiError(404, ErrorCode.NOT_FOUND, f"unknown benchmark job {job_id!r}")
            return BenchmarkJob(
                job_id=job.job_id,
                status=job.status,
                run_id=job.run_id,
                error=job.error,
                progress=job.progress,
            )

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
                    409, ErrorCode.VALIDATION_ERROR, f"benchmark job {job_id} has already finished"
                )
            if job is not None:
                job.cancelled.set()
        return self.get(job_id)

    def job_ids(self) -> list[str]:
        with self._lock:
            return list(self._jobs)

    def _execute(self, job: _Job, request: BenchmarkStart, out_dir: Path) -> None:
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
                self._finish(job, "completed", run_id=out_dir.name)
            except BenchmarkCancelled:
                self._finish(job, "cancelled")
            except Exception as error:  # surfaced as a typed error, never a trace
                code, _retryable = classify(error)
                logger.error("benchmark job failed", exc_info=error, extra={"error_code": code})
                self._finish(job, "failed", error=run_error_body(error))
            finally:
                self._lease.release_benchmark()

    def _progress(self, job: _Job, seed: int, done: int, total: int) -> None:
        with self._lock:
            job.progress = JobProgress(world_seed=seed, instances_done=done, instances_total=total)

    def _finish(
        self,
        job: _Job,
        status: JobStatus,
        run_id: str | None = None,
        error: ApiErrorBody | None = None,
    ) -> None:
        with self._lock:
            job.status, job.run_id, job.error = status, run_id, error


def _check(request: BenchmarkStart) -> None:
    """Refuse seeds and strata the harness does not run, as a 422."""
    if unknown := sorted(set(request.seeds) - set(OFFICIAL_SEEDS)):
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            f"unknown seeds {unknown}; expected some of {list(OFFICIAL_SEEDS)}",
        )
    if len(set(request.seeds)) != len(request.seeds):
        raise ApiError(422, ErrorCode.VALIDATION_ERROR, "seeds must not repeat")
    if request.strata is not None and (unknown_strata := sorted(set(request.strata) - set(STRATA))):
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            f"unknown strata {unknown_strata}; expected some of {list(STRATA)}",
        )


def build_benchmarks_router(runs_dir: Path, jobs: BenchmarkJobs) -> APIRouter:
    """The benchmark routes over ``runs_dir`` (ApiSettings.benchmark_dir)."""
    router = APIRouter()

    @router.get("/benchmarks", response_model=list[BenchmarkRunOut])
    def list_benchmarks() -> list[BenchmarkRunOut]:
        return [
            BenchmarkRunOut(
                run_id=name,
                run_kind=summary["run_kind"],
                label=summary["label"],
                started_at=summary["reproducibility"]["run"]["started_at"],
                selection=summary["selection"],
                worlds=summary["worlds"],
            )
            for name, summary in published_runs(runs_dir)
        ]

    @router.get("/benchmarks/latest", response_model=BenchmarkSummary)
    def read_latest_benchmark() -> BenchmarkSummary:
        latest = latest_benchmark(runs_dir)
        if latest is None:
            raise ApiError(404, ErrorCode.NOT_FOUND, "no published benchmark run")
        return _summary_out(latest)

    @router.get("/benchmarks/questions", response_model=list[QuestionOut])
    def read_questions(run_id: str | None = None) -> list[QuestionOut]:
        return _questions(runs_dir, run_id)

    @router.post("/benchmarks", status_code=202, response_model=BenchmarkJob)
    def start_benchmark(request: BenchmarkStart) -> BenchmarkJob:
        return jobs.start(request)

    @router.get("/benchmarks/jobs/{job_id}", response_model=BenchmarkJob)
    def read_job(job_id: str) -> BenchmarkJob:
        return jobs.get(job_id)

    @router.post("/benchmarks/jobs/{job_id}/cancel", status_code=202, response_model=BenchmarkJob)
    def cancel_job(job_id: str) -> BenchmarkJob:
        """Request the job to stop before its next instance; the instance in
        progress finishes first, so the job stays running until then."""
        return jobs.cancel(job_id)

    # Last: the run id is a free path segment.
    @router.get("/benchmarks/{run_id}", response_model=BenchmarkSummary)
    def read_benchmark(run_id: str) -> BenchmarkSummary:
        return _summary_out(_published(runs_dir, run_id))

    return router
