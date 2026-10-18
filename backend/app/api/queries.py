"""Query execution endpoints (docs/07 sections 3-6, 15) plus the fixed demo
configuration and the published benchmark summary.

Replay contract: GET /queries/{run_id}/events returns the recorded event
sequence; it never re-executes retrieval.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.api.runs import QueryService
from app.api.schemas import (
    ApiError,
    BenchmarkQuestionResult,
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
            "platform version connects incident INC_S007_GR to the other markets, "
            "and why was the UK unaffected?"
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
                else ApiError(
                    error_code=record.error_code,
                    message=record.error_message or "run failed",
                )
            ),
        )

    @router.get("/queries/{run_id}/events", response_model=EventStream)
    def read_events(run_id: str) -> EventStream:
        record = service.snapshot(run_id)
        if record is None:
            raise HTTPException(status_code=404, detail="unknown run_id")
        events = [
            RecordedEvent(
                sequence=event["sequence"],
                event_type=event["event_type"],
                pipeline=event["pipeline"],
                t_ms=event["t_ms"],
                payload=event["payload"],
            )
            for event in record.events
        ]
        return EventStream(run_id=record.run_id, status=record.status, events=events)  # type: ignore[arg-type]

    @router.get("/demo/questions", response_model=list[DemoQuestion])
    def read_demo_questions() -> list[DemoQuestion]:
        return DEMO_QUESTIONS

    return router


def build_benchmarks_router() -> APIRouter:
    router = APIRouter()

    @router.get("/benchmarks/latest", response_model=BenchmarkSummary)
    def read_latest_benchmark() -> BenchmarkSummary:
        runs_dir = Path(os.environ.get("BENCHMARK_DIR", "data/evaluation"))
        candidates = sorted(
            (path for path in runs_dir.glob("run-*") if (path / "results.json").exists()),
            key=lambda path: path.name,
        )
        if not candidates:
            raise HTTPException(status_code=404, detail="no published benchmark run")
        latest = candidates[-1]
        payload = json.loads((latest / "results.json").read_text(encoding="utf-8"))
        summary_path = latest / "summary.json"
        summary = (
            json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else None
        )
        questions = [
            BenchmarkQuestionResult(
                question_id=result["question_id"],
                scores=result["scores"],
                failure_classes={
                    tag: score.get("failure_class") for tag, score in result["scores"].items()
                },
            )
            for result in payload.get("results", [])
        ]
        return BenchmarkSummary(
            run_id=latest.name,
            reproducibility=payload.get("reproducibility", {}),
            questions=questions,
            summary=summary,
        )

    return router
