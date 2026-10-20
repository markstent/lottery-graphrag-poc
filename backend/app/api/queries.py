"""Query execution endpoints (docs/07 sections 3-6, 15) plus the demo
questions, drawn from the presentation world's frozen bank. The benchmark
routes are in app.api.benchmarks.

Every run route reads the run store. Replay contract: GET
/queries/{run_id}/events returns the recorded event sequence; it never
re-executes retrieval. The routes are synchronous, so each runs on a worker
thread of the server's pool; each closes that thread's store connection
before it returns (ADR-007's per-thread rule).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse

from app.api.benchmarks import presentation_bank
from app.api.errors import ApiError, ErrorCode
from app.api.runs import QueryService
from app.api.schemas import (
    HISTORY_LIMIT_DEFAULT,
    HISTORY_LIMIT_MAX,
    DemoQuestion,
    EventStream,
    QueryAccepted,
    QueryRequest,
    QueryResults,
    QueryStatus,
    RunHistory,
    RunSummary,
)
from app.api.scoring import demo_questions, require_bank, score_state
from app.api.stream import sse_frames
from app.persistence.store import RunRow, RunStore, cursor


def query_service(request: Request) -> QueryService:
    """The application's service, created at start-up (see app.main)."""
    service: QueryService = request.app.state.query_service
    return service


Service = Annotated[QueryService, Depends(query_service)]


@contextmanager
def _reading(store: RunStore) -> Iterator[RunStore]:
    """Use the store on this request thread, then close its connection."""
    try:
        yield store
    finally:
        store.close()


def _unknown_run() -> ApiError:
    return ApiError(404, ErrorCode.NOT_FOUND, "unknown run_id")


def _summary(row: RunRow) -> dict[str, Any]:
    return {
        "run_id": row.run_id,
        "kind": row.kind,
        "question": row.question,
        "status": row.status,
        "configurations": list(row.configurations),
        "market_scope": list(row.market_scope),
        "pipeline_status": row.pipeline_status,
        "created_at": row.created_at,
        "finished_at": row.finished_at,
        "error": row.error,
    }


# A resume point is a stored sequence: a non-negative integer that fits
# SQLite's 64-bit INTEGER, written in ASCII digits only.
_MAX_SEQUENCE = 2**63 - 1
_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _resume_point(last_event_id: str | None, after: str | None) -> int:
    """The sequence to stream after: ``Last-Event-ID`` (a reconnecting
    EventSource sends it) wins over ``?after=``; neither means from the start."""
    name, value = (
        ("Last-Event-ID", last_event_id) if last_event_id is not None else ("after", after)
    )
    if value is None:
        return 0
    # The length bound comes first: int() refuses very long digit strings.
    digits = value.isascii() and value.isdigit() and len(value) <= len(str(_MAX_SEQUENCE))
    if not digits or int(value) > _MAX_SEQUENCE:
        raise ApiError(
            422, ErrorCode.VALIDATION_ERROR, f"{name} must be a non-negative integer sequence"
        )
    return int(value)


def build_queries_router(heartbeat_s: float) -> APIRouter:
    """The run routes; the event stream sends a heartbeat after ``heartbeat_s``
    seconds without an event (ApiSettings.sse_heartbeat_s)."""
    router = APIRouter()

    @router.post("/queries", status_code=202, response_model=QueryAccepted)
    def submit_query(request: QueryRequest, service: Service) -> QueryAccepted:
        with _reading(service.store):
            run_id = service.start(request)
        return QueryAccepted(
            run_id=run_id,
            results_url=f"/api/v1/queries/{run_id}",
            events_url=f"/api/v1/queries/{run_id}/events",
        )

    @router.get("/queries", response_model=RunHistory)
    def read_history(
        service: Service,
        limit: Annotated[int, Query(ge=1, le=HISTORY_LIMIT_MAX)] = HISTORY_LIMIT_DEFAULT,
        before: str | None = None,
        status: QueryStatus | None = None,
    ) -> RunHistory:
        with _reading(service.store) as store:
            try:
                rows = store.list_runs(limit + 1, before, status)
            except ValueError as error:
                raise ApiError(422, ErrorCode.VALIDATION_ERROR, str(error)) from None
        page = rows[:limit]
        return RunHistory(
            runs=[RunSummary.model_validate(_summary(row)) for row in page],
            next_before=cursor(page[-1]) if len(rows) > limit else None,
        )

    @router.get("/queries/{run_id}", response_model=QueryResults)
    def read_results(run_id: str, service: Service) -> QueryResults:
        with _reading(service.store) as store:
            row = store.get_run(run_id)
            if row is None:
                raise _unknown_run()
            results = store.results(run_id)
            state = score_state(row, store.score(run_id))
        return QueryResults.model_validate(
            {
                **_summary(row),
                "results": results,
                "benchmark_instance_id": row.benchmark_instance_id,
                "answer_key": "none" if row.benchmark_instance_id is None else "available",
                "score_status": state.status,
                "score_failure": state.failure_reason,
                "score": state.score,
            }
        )

    @router.post("/queries/{run_id}/cancel", status_code=202, response_model=RunSummary)
    def cancel_run(run_id: str, service: Service) -> RunSummary:
        with _reading(service.store) as store:
            cancelled = service.cancel(run_id)
            row = store.get_run(run_id)
        if row is None:
            raise _unknown_run()
        if not cancelled:
            raise ApiError(409, ErrorCode.VALIDATION_ERROR, f"run {run_id} has already finished")
        return RunSummary.model_validate(_summary(row))

    @router.get("/queries/{run_id}/events", response_model=EventStream)
    def read_events(run_id: str, service: Service) -> EventStream:
        with _reading(service.store) as store:
            row = store.get_run(run_id)
            if row is None:
                raise _unknown_run()
            events = store.events(run_id)
        return EventStream.model_validate(
            {"run_id": run_id, "status": row.status, "events": events}
        )

    @router.get(
        "/queries/{run_id}/events/stream",
        response_class=StreamingResponse,
        responses={200: {"content": {"text/event-stream": {}}}},
    )
    def stream_events(
        run_id: str,
        service: Service,
        after: str | None = None,
        last_event_id: Annotated[str | None, Header()] = None,
    ) -> StreamingResponse:
        """The run's events as server-sent events: every stored event after
        the resume point, then each new one, closing after the terminal event."""
        start = _resume_point(last_event_id, after)
        with _reading(service.store) as store:
            if store.get_run(run_id) is None:
                raise _unknown_run()
        frames = sse_frames(run_id, start, service.store, service.wait_for, heartbeat_s)
        return StreamingResponse(frames, media_type="text/event-stream", headers=_STREAM_HEADERS)

    @router.get("/demo/questions", response_model=list[DemoQuestion])
    def read_demo_questions() -> list[DemoQuestion]:
        """One bank instance per demo stratum; a 503 before the bank is grounded."""
        return demo_questions(require_bank(presentation_bank()))

    return router
