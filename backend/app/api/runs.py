"""Persisted query runs: the worker, the recording sink, cancellation and the
lab start-up (docs/07 sections 3-6, ADR-007).

POST /queries stores a queued run and starts one worker thread for it. The
worker runs the requested pipelines in order A, B, C. Every event goes
through a ``RecordingSink`` into the run store the moment it is emitted, and
each pipeline's result is stored as soon as that pipeline finishes, so a
client reads A while C is still traversing. Replay and the live stream read
the same stored events; nothing is re-executed.

Cancellation is cooperative: once a run's cancel flag is set, the next
event any pipeline emits raises ``RunCancelled``, so every event is a
cancellation point between stages.

The truth ledger is never read here: the service grounds nothing and scores
nothing. It runs retrieval and records observable events plus answers.
"""

from __future__ import annotations

import dataclasses
import logging
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from app.api.errors import CANCELLED_BODY, ApiErrorBody, ErrorCode, classify, run_error_body
from app.api.schemas import QueryRequest
from app.config import GraphConfig, RetrievalSettings
from app.events import (
    GRAPH_CONTEXT_ASSEMBLED,
    GRAPH_ENTITY_RESOLUTION_STARTED,
    GRAPH_GENERATION_COMPLETED,
    GRAPH_GENERATION_STARTED,
    GRAPH_RERANK_STARTED,
    PIPELINE_CANCELLED,
    PIPELINE_COMPLETED,
    PIPELINE_FAILED,
    PIPELINE_STARTED,
    RAG_CONTEXT_ASSEMBLED,
    RAG_EMBEDDING_COMPLETED,
    RAG_EMBEDDING_STARTED,
    RAG_GENERATION_COMPLETED,
    RAG_GENERATION_STARTED,
    RAG_RERANK_STARTED,
    RAG_VECTOR_SEARCH_STARTED,
    RUN_CANCELLED,
    RUN_COMPLETED,
    RUN_FAILED,
    RUN_PIPELINE,
    RUN_STARTED,
    EventEmitter,
    EventSink,
    EventValue,
    RetrievalEvent,
)
from app.evidence import GraphRunResult, RagRunResult
from app.lab import Lab, WiredGraphPipelines, build_generator, build_lab, wired_pipelines
from app.observability.logging import log_stage, run_context, stage_timer
from app.persistence.store import RunRow, RunStore
from app.retrieval.standard.index import index_corpus, persists_index, write_manifest

logger = logging.getLogger(__name__)

# Stage timings come from the pipelines' own events: a stage opens at its
# start event and closes at its end event. Where a pipeline emits no event
# between two stages, the boundary is the next stage's start: vector
# retrieval in A ends when reranking starts; graph retrieval in B and C
# (entity resolution, traversal, ontology expansion and candidate building)
# ends when reranking starts. Reranking ends when the context is assembled,
# so it includes context selection, which no event separates from it.
_STAGE_STARTS: dict[str, str] = {
    RAG_EMBEDDING_STARTED: "embedding",
    RAG_VECTOR_SEARCH_STARTED: "vector_retrieval",
    RAG_RERANK_STARTED: "reranking",
    RAG_GENERATION_STARTED: "generation",
    GRAPH_ENTITY_RESOLUTION_STARTED: "graph_traversal",
    GRAPH_RERANK_STARTED: "reranking",
    GRAPH_GENERATION_STARTED: "generation",
}
_STAGE_ENDS: dict[str, str] = {
    RAG_EMBEDDING_COMPLETED: "embedding",
    RAG_RERANK_STARTED: "vector_retrieval",
    RAG_CONTEXT_ASSEMBLED: "reranking",
    RAG_GENERATION_COMPLETED: "generation",
    GRAPH_RERANK_STARTED: "graph_traversal",
    GRAPH_CONTEXT_ASSEMBLED: "reranking",
    GRAPH_GENERATION_COMPLETED: "generation",
}


class RunCancelled(Exception):
    """Raised by ``RecordingSink.emit`` once the run's cancel flag is set."""


class RecordingSink(EventSink):
    """Stores each event of one run as it is emitted and wakes its waiters.

    ``emit`` is the pipelines' entry point and a cancellation point: it
    raises ``RunCancelled`` instead of recording once ``cancelled`` is set.
    ``record`` stores an event regardless, for the lifecycle events that
    report what already happened (including the cancellation itself).
    ``finishing`` is set, under the service lock, once the worker has
    claimed the run's outcome; ``close`` wakes every waiter for good.
    """

    def __init__(self, store: RunStore, run_id: str, cancelled: threading.Event) -> None:
        self.store = store
        self.run_id = run_id
        self.cancelled = cancelled
        self._condition = threading.Condition()
        self.finishing = False
        self._closed = False
        self._last_sequence = 0
        self._open_stages: dict[tuple[str, str], float] = {}

    def emit(self, event: RetrievalEvent) -> None:
        if self.cancelled.is_set():
            raise RunCancelled(self.run_id)
        self.record(event)

    def record(self, event: RetrievalEvent) -> None:
        sequence = self.store.append_event(self.run_id, {**event.as_dict(), "run_id": self.run_id})
        with self._condition:
            self._last_sequence = sequence
            self._condition.notify_all()
        self._time_stage(event)

    def wait(self, after: int, timeout: float) -> bool:
        """Whether, within ``timeout``, an event with a sequence above
        ``after`` is stored or the run ends (nothing more will arrive)."""
        with self._condition:
            return self._condition.wait_for(
                lambda: self._closed or self._last_sequence > after, timeout
            )

    def close(self) -> None:
        """The run has ended: wake every waiter now and on any later wait."""
        with self._condition:
            self._closed = True
            self._condition.notify_all()

    def _time_stage(self, event: RetrievalEvent) -> None:
        ended = _STAGE_ENDS.get(event.event_type)
        if ended is not None:
            started = self._open_stages.pop((event.pipeline, ended), None)
            if started is not None:
                log_stage(ended, event.t_ms - started)
        opened = _STAGE_STARTS.get(event.event_type)
        if opened is not None:
            self._open_stages[(event.pipeline, opened)] = event.t_ms


def start_lab(settings: RetrievalSettings) -> Lab:
    """Build the lab the API serves, indexing the corpus on a cold start.

    The CLI flows rely on a pre-built index (make index-vector), but a
    service must be usable after a fresh start. ``build_lab`` has already
    refused a populated index this code must not use; a valid one is left
    untouched. Only a persistent (Qdrant) index gets a manifest: an in-memory
    index dies with the process and must not overwrite the manifest of the
    real one.
    """
    lab = build_lab(settings, build_generator(settings.generation.provider, settings))
    if lab.store.count() == 0 and lab.corpus:
        corpus = list(lab.corpus.values())
        index_corpus(lab.store, lab.embeddings, lab.sparse, corpus)
        if persists_index(settings.embedding.provider):
            manifest = write_manifest(settings, lab.embeddings, lab.sparse, corpus)
            lab = dataclasses.replace(lab, index_manifest=manifest)
    return lab


def _now() -> str:
    return datetime.now(UTC).isoformat()


class QueryService:
    """Starts, runs and cancels persisted runs; safe for concurrent calls.

    ``_lock`` guards only the map of active runs (each holding its cancel
    flag); the store is safe to share across threads. The lab is built once,
    on the first run, behind its own lock that no route takes, so a slow
    cold start never blocks a read.
    """

    def __init__(
        self, store: RunStore, lab_factory: Callable[[], Lab], graph_config: GraphConfig
    ) -> None:
        self.store = store
        self._lab_factory = lab_factory
        self._graph_config = graph_config
        self._lab: Lab | None = None
        self._lab_lock = threading.Lock()
        self._lock = threading.Lock()
        self._active: dict[str, RecordingSink] = {}

    def start(self, request: QueryRequest) -> str:
        """Store a queued run and start its worker; returns the run id."""
        run_id = f"RUN-{uuid.uuid4().hex[:12].upper()}"
        configurations = tuple(request.configurations)
        row = RunRow(
            run_id=run_id,
            kind="live",
            status="queued",
            question=request.question,
            market_scope=tuple(request.market_scope),
            configurations=configurations,
            benchmark_instance_id=None,
            created_at=_now(),
            finished_at=None,
            pipeline_status=dict.fromkeys(configurations, "pending"),
            error=None,
        )
        self.store.create_run(row)
        sink = RecordingSink(self.store, run_id, threading.Event())
        with self._lock:
            self._active[run_id] = sink
        worker = threading.Thread(
            target=self._execute, args=(row, sink), name=f"query-{run_id}", daemon=True
        )
        worker.start()
        return run_id

    def cancel(self, run_id: str) -> bool:
        """Ask a queued or running run to stop; False when it is unknown or
        already finishing. True means the run ends ``cancelled``, unless a
        pipeline fails before its next cancellation point: then it ends
        ``failed`` with the real error."""
        with self._lock:
            sink = self._active.get(run_id)
            if sink is None or sink.finishing:
                return False
            sink.cancelled.set()
        return True

    def wait_for(self, run_id: str, after: int, timeout: float) -> bool:
        """Block until the run stores an event after sequence ``after``.

        Returns False only when ``timeout`` passes with nothing new. A run
        that is not active (finished, or unknown) returns True at once: it
        will store nothing more, so the caller reads what the store holds.
        """
        with self._lock:
            sink = self._active.get(run_id)
        if sink is None:
            return True
        return sink.wait(after, timeout)

    # -- execution --------------------------------------------------------

    def _lab_once(self) -> Lab:
        with self._lab_lock:
            if self._lab is None:
                self._lab = self._lab_factory()
            return self._lab

    def _execute(self, row: RunRow, sink: RecordingSink) -> None:
        # Identifiers only in the log context: never the question or any answer text.
        with run_context(run_id=row.run_id):
            try:
                outcome, status, current = self._run_pipelines(row, sink)
                self._finish(sink, outcome, status, current)
            finally:
                # Whatever happened, the run is no longer active and its waiters wake.
                with self._lock:
                    self._active.pop(row.run_id, None)
                sink.close()
                self.store.close()

    def _run_pipelines(
        self, row: RunRow, sink: RecordingSink
    ) -> tuple[ApiErrorBody | None, dict[str, str], str | None]:
        """Run the requested pipelines in order; return the failure or
        cancellation envelope (None when every pipeline completed), the
        pipeline states and the pipeline that was running when it stopped."""
        status = dict(row.pipeline_status)
        current: str | None = None
        wiring: WiredGraphPipelines | None = None
        try:
            self.store.update_run(row.run_id, status="running")
            _record(sink, RUN_PIPELINE, RUN_STARTED)
            lab = self._lab_once()
            scope = list(row.market_scope) or None
            for tag in row.configurations:
                EventEmitter(tag, sink).emit(PIPELINE_STARTED)
                current = tag
                status[tag] = "running"
                self.store.update_run(row.run_id, pipeline_status=status)
                result: RagRunResult | GraphRunResult
                with run_context(pipeline=tag), stage_timer("pipeline_run"):
                    if tag == "A":
                        result = lab.pipeline_a(sink=sink).run(row.question, markets=scope)
                    else:
                        if wiring is None:
                            wiring = wired_pipelines(lab, self._graph_config, sink=sink)
                        graph = next(p for t, p in wiring.pipelines if t == tag)
                        result = graph.run(row.question, markets=scope)
                self.store.put_result(row.run_id, tag, result.model_dump(mode="json"))
                status[tag] = "completed"
                current = None
                self.store.update_run(row.run_id, pipeline_status=status)
                _record(sink, tag, PIPELINE_COMPLETED)
            return None, status, None
        except RunCancelled:
            return CANCELLED_BODY, status, current
        except Exception as error:  # surfaced as a typed error, never a trace
            body = run_error_body(error)
            logger.error(
                "run failed",
                exc_info=error,
                extra={
                    "failed_pipeline": current or RUN_PIPELINE,
                    "error_code": body.error_code,
                    "retryable": body.retryable,
                },
            )
            return body, status, current
        finally:
            if wiring is not None:
                _close_reader(wiring)

    def _finish(
        self,
        sink: RecordingSink,
        body: ApiErrorBody | None,
        status: dict[str, str],
        current: str | None,
    ) -> None:
        """Decide the outcome, then write the one terminal event and the final row.

        Claiming the run as finishing under the lock settles a race with
        ``cancel``: a cancel accepted before the claim ends the run
        ``cancelled`` even when its last pipeline completed (the stored
        results stay); one arriving after the claim is refused. The running
        pipeline takes the outcome and pipelines that never started are
        skipped. The terminal event goes first, so a client that sees the
        final status finds every event stored. If the store fails here the
        run is left for ``mark_interrupted`` to repair at the next start.
        """
        with self._lock:
            sink.finishing = True
            if body is None and sink.cancelled.is_set():
                body = CANCELLED_BODY
        outcome = "completed" if body is None else _outcome_of(body.error_code)
        envelope = body.model_dump() if body is not None else None
        try:
            if current is not None and envelope is not None:
                status[current] = outcome
                _record(sink, current, _PIPELINE_END_EVENTS[outcome], **envelope)
            for tag, state in status.items():
                if state == "pending":
                    status[tag] = "skipped"
            _record(sink, RUN_PIPELINE, _TERMINAL_EVENTS[outcome], **(envelope or {}))
            self.store.update_run(
                sink.run_id,
                status=outcome,
                finished_at=_now(),
                pipeline_status=status,
                error=envelope,
            )
        except Exception as error:
            code, _retryable = classify(error)
            logger.error(
                "run end could not be stored; the next start-up marks it interrupted",
                exc_info=error,
                extra={"outcome": outcome, "error_code": code},
            )


def _close_reader(wiring: WiredGraphPipelines) -> None:
    """Close the run's graph reader; a close failure is logged and never
    costs the run its terminal event."""
    try:
        wiring.reader.close()
    except Exception as error:
        code, _retryable = classify(error)
        logger.error("graph reader close failed", exc_info=error, extra={"error_code": code})


def _outcome_of(code: str) -> str:
    return "cancelled" if code == ErrorCode.CANCELLED else "failed"


_PIPELINE_END_EVENTS = {"failed": PIPELINE_FAILED, "cancelled": PIPELINE_CANCELLED}
_TERMINAL_EVENTS = {"completed": RUN_COMPLETED, "failed": RUN_FAILED, "cancelled": RUN_CANCELLED}


def _record(sink: RecordingSink, pipeline: str, event_type: str, **payload: EventValue) -> None:
    """Store a lifecycle event even after cancellation: it reports a fact."""
    EventEmitter(pipeline, _Recorder(sink)).emit(event_type, **payload)


class _Recorder(EventSink):
    """Forwards to ``RecordingSink.record``, bypassing the cancellation check."""

    def __init__(self, sink: RecordingSink) -> None:
        self._sink = sink

    def emit(self, event: RetrievalEvent) -> None:
        self._sink.record(event)
