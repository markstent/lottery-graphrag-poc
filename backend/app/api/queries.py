"""Query execution endpoints (docs/07 sections 3-6, 15) plus the fixed demo
configuration and the published benchmark summary.

Replay contract: GET /queries/{run_id}/events returns the recorded event
sequence; it never re-executes retrieval.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.errors import ApiErrorBody
from app.api.runs import QueryService
from app.api.schemas import (
    BenchmarkSummary,
    DemoQuestion,
    EventStream,
    QueryAccepted,
    QueryRequest,
    QueryResults,
    RecordedEvent,
)

# Saved presentation questions (fixed demo configuration). These are
# pipeline-visible question texts only; they mirror the public phrasing used
# by the trace CLI and never encode expected answers.
# Phase 4 (spec 10a.1) replaces these with bank 2.0.0 questions generated
# from the ledger per world, so no scenario-planted id is hard-coded here.
DEMO_QUESTIONS: list[DemoQuestion] = [
    DemoQuestion(
        id="DEMO-01",
        question=(
            "What is the current ticket price for GAME_UK_01, and why does the "
            "rules document disagree with the source record?"
        ),
        category="document_structured_conflict",
        benchmark_question_id="Q30",
    ),
    DemoQuestion(
        id="DEMO-02",
        question=(
            "Have we seen this digital checkout problem in other markets? Which "
            "platform version connects the Greek payment checkout incident on "
            "platform version PLV_PAYMENTS_3 to the other markets, and why was "
            "the UK unaffected?"
        ),
        category="cross_market_platform_incident",
        benchmark_question_id="Q25",
    ),
    DemoQuestion(
        id="DEMO-03",
        question=(
            "Which accounts share payment instruments with PLAYER_GR_001283, "
            "and how many accounts are involved?"
        ),
        category="shared_payment_cluster",
        profile="fraud",
        benchmark_question_id="Q28",
    ),
    DemoQuestion(
        id="DEMO-04",
        question=(
            "Are there player accounts that look like the same person operating "
            "multiple identities across devices?"
        ),
        category="shared_identity_cluster",
    ),
]


def build_queries_router(service: QueryService) -> APIRouter:
    router = APIRouter()

    @router.post("/queries", status_code=202, response_model=QueryAccepted)
    def submit_query(request: QueryRequest) -> QueryAccepted:
        run_id = service.start(request)
        return QueryAccepted(
            run_id=run_id,
            results_url=f"/api/v1/queries/{run_id}",
            events_url=f"/api/v1/queries/{run_id}/events",
        )

    @router.get("/queries/{run_id}", response_model=QueryResults)
    def read_results(run_id: str) -> QueryResults:
        record = service.snapshot(run_id)
        if record is None:
            raise HTTPException(status_code=404, detail="unknown run_id")
        return QueryResults(
            run_id=record.run_id,
            question=record.question,
            status=record.status,  # type: ignore[arg-type]
            configurations=record.configurations,  # type: ignore[arg-type]
            market_scope=record.market_scope,
            results=record.results,
            error=(
                None
                if record.error_code is None
                else ApiErrorBody(
                    error_code=record.error_code,
                    message=record.error_message or "run failed",
                    retryable=record.error_retryable,
                )
            ),
        )

    @router.get("/queries/{run_id}/events", response_model=EventStream)
    def read_events(run_id: str) -> EventStream:
        record = service.snapshot(run_id)
        if record is None:
            raise HTTPException(status_code=404, detail="unknown run_id")
        events = [RecordedEvent(**event) for event in record.events]
        return EventStream(run_id=record.run_id, status=record.status, events=events)  # type: ignore[arg-type]

    @router.get("/demo/questions", response_model=list[DemoQuestion])
    def read_demo_questions() -> list[DemoQuestion]:
        return DEMO_QUESTIONS

    return router


# The summary.json schema this API publishes; the benchmark harness writes it,
# and the API reads it from disk only.
SUMMARY_SCHEMA_VERSION = "2"


def latest_benchmark(runs_dir: Path) -> tuple[str, dict[str, Any]] | None:
    """The newest official run of the whole bank under ``runs_dir``, else the
    newest run of any kind (a subset official run, such as a pilot, counts as
    any kind and is published with its label).

    A run is a directory holding a schema-2 ``summary.json``; newest means the
    latest ``reproducibility.run.started_at`` as a point in time, then the
    directory name. A malformed summary raises rather than being skipped.
    """
    runs: list[tuple[str, dict[str, Any]]] = []
    for path in runs_dir.glob("*/summary.json"):
        summary = json.loads(path.read_text(encoding="utf-8"))
        if summary.get("schema_version") == SUMMARY_SCHEMA_VERSION:
            runs.append((path.parent.name, summary))
    official = [run for run in runs if run[1]["run_kind"] == "official" and _full(run[1])]
    pool = official or runs
    if not pool:
        return None
    return max(
        pool,
        key=lambda run: (
            datetime.fromisoformat(run[1]["reproducibility"]["run"]["started_at"]),
            run[0],
        ),
    )


def _full(summary: dict[str, Any]) -> bool:
    """Whether the run scored the whole bank (no strata, no per-question limit)."""
    return bool(summary["selection"] == {"strata": None, "limit": None})


def build_benchmarks_router(runs_dir: Path) -> APIRouter:
    """Publish the latest benchmark summary under ``runs_dir`` (ApiSettings.benchmark_dir)."""
    router = APIRouter()

    @router.get("/benchmarks/latest", response_model=BenchmarkSummary)
    def read_latest_benchmark() -> BenchmarkSummary:
        latest = latest_benchmark(runs_dir)
        if latest is None:
            raise HTTPException(status_code=404, detail="no published benchmark run")
        run_id, summary = latest
        return BenchmarkSummary(
            run_id=run_id, run_kind=summary["run_kind"], label=summary["label"], summary=summary
        )

    return router
