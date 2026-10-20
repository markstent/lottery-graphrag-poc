"""Query run store and background execution (docs/07 sections 3-6, 15).

POST /queries accepts a question, returns a run id immediately and executes
the selected pipelines in a worker thread. Recorded events and results are
kept in memory: replay uses the recorded sequence, never a re-execution, and
the store keeps the most recent runs of the demo process (bounded; this is a
presentation service, not a persistence layer).

The truth ledger is never read here: the service grounds nothing and scores
nothing. It runs retrieval and returns observable events plus answers.
"""

from __future__ import annotations

import dataclasses
import logging
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from app.api.errors import UNEXPECTED_MESSAGE, ErrorCode, classify
from app.api.schemas import QueryRequest
from app.config import GraphConfig, RetrievalSettings
from app.events import EventEmitter, ListEventSink, RetrievalEvent
from app.lab import Lab, build_generator, build_lab, wired_pipelines
from app.observability.logging import run_context, stage_timer
from app.retrieval.standard.index import index_corpus, persists_index, write_manifest

MAX_RUNS = 50

# Driver and unexpected errors carry hosts, queries or traces: the log has
# them, the response gets a plain sentence.
GENERIC_MESSAGES = {
    ErrorCode.GRAPH_QUERY_ERROR: "The graph database could not answer the query.",
    ErrorCode.RUN_ERROR: UNEXPECTED_MESSAGE,
}
logger = logging.getLogger(__name__)


@dataclass
class RunRecord:
    """One query run: request, recorded events, results, error surface."""

    run_id: str
    question: str
    configurations: list[str]
    market_scope: list[str] = field(default_factory=list)
    status: str = "running"
    events: list[dict[str, Any]] = field(default_factory=list)
    results: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None
    error_retryable: bool = False


def _message(code: ErrorCode, error: Exception) -> str:
    """The user-facing message: the error's own text, except where it is technical detail."""
    if code in (ErrorCode.RUN_ERROR, ErrorCode.GRAPH_QUERY_ERROR):
        return GENERIC_MESSAGES[code]
    return str(error)


class QueryService:
    """Owns the shared lab and every run's record; safe for concurrent calls."""

    def __init__(
        self,
        settings: RetrievalSettings,
        graph_config: GraphConfig,
        generator_name: str = "fake",
    ) -> None:
        self._settings = settings
        self._graph_config = graph_config
        self._generator_name = generator_name
        self._lab: Lab | None = None
        self._lock = threading.Lock()
        self._runs: OrderedDict[str, RunRecord] = OrderedDict()

    def _lab_once(self) -> Lab:
        with self._lock:
            if self._lab is None:
                lab = build_lab(
                    self._settings,
                    build_generator(self._generator_name, self._settings),
                )
                # Cold-start indexing: the CLI flows rely on a pre-built
                # index (make index-vector), but a service must be usable
                # after a fresh start. build_lab has already refused a
                # populated index this code must not use; a valid one is
                # left untouched. Only a persistent (Qdrant) index gets a
                # manifest: an in-memory index dies with the process and
                # must not overwrite the manifest of the real one.
                if lab.store.count() == 0 and lab.corpus:
                    corpus = list(lab.corpus.values())
                    index_corpus(lab.store, lab.embeddings, lab.sparse, corpus)
                    if persists_index(self._settings.embedding.provider):
                        manifest = write_manifest(
                            self._settings, lab.embeddings, lab.sparse, corpus
                        )
                        lab = dataclasses.replace(lab, index_manifest=manifest)
                self._lab = lab
            return self._lab

    # -- API surface ------------------------------------------------------

    def start(self, request: QueryRequest) -> str:
        run_id = f"RUN-{uuid.uuid4().hex[:12].upper()}"
        record = RunRecord(
            run_id=run_id,
            question=request.question,
            configurations=list(request.configurations),
            market_scope=list(request.market_scope),
        )
        with self._lock:
            self._runs[run_id] = record
            while len(self._runs) > MAX_RUNS:
                self._runs.popitem(last=False)
        worker = threading.Thread(
            target=self._execute, args=(record,), name=f"query-{run_id}", daemon=True
        )
        worker.start()
        return run_id

    def snapshot(self, run_id: str) -> RunRecord | None:
        with self._lock:
            record = self._runs.get(run_id)
            if record is None:
                return None
            # Copy under the lock so the worker cannot mutate mid-serialise.
            return RunRecord(
                run_id=record.run_id,
                question=record.question,
                configurations=list(record.configurations),
                market_scope=list(record.market_scope),
                status=record.status,
                events=[dict(event) for event in record.events],
                results=dict(record.results),
                error_code=record.error_code,
                error_message=record.error_message,
                error_retryable=record.error_retryable,
            )

    # -- execution --------------------------------------------------------

    def _execute(self, record: RunRecord) -> None:
        try:
            lab = self._lab_once()
            scope = record.market_scope or None
            for tag in record.configurations:
                # Identifiers only: never the question or any answer text.
                with run_context(run_id=record.run_id, pipeline=tag), stage_timer("pipeline_run"):
                    if tag == "A":
                        sink = ListEventSink()
                        result = lab.pipeline_a(sink=sink).run(record.question, markets=scope)
                        record.results["A"] = result
                        self._attach(record, sink.events)
                    else:
                        self._run_graph(lab, record, tag)
            record.status = "completed"
        except Exception as error:  # surfaced as a typed error, never a trace
            code, retryable = classify(error)
            logger.error(
                "run failed",
                exc_info=error,
                extra={"run_id": record.run_id, "error_code": code, "retryable": retryable},
            )
            record.status = "failed"
            record.error_code = code
            record.error_retryable = retryable
            record.error_message = _message(code, error)
            self._attach_error(record, code, record.error_message, retryable)

    def _run_graph(self, lab: Lab, record: RunRecord, tag: str) -> None:
        wired = wired_pipelines(lab, self._graph_config)
        try:
            for pipeline_tag, pipeline in wired.pipelines:
                if pipeline_tag != tag:
                    continue
                result = pipeline.run(record.question, markets=record.market_scope or None)
                record.results[pipeline_tag] = result
                self._attach(record, pipeline.events)
        finally:
            wired.reader.close()

    def _attach(self, record: RunRecord, events: list[RetrievalEvent]) -> None:
        with self._lock:
            for event in events:
                record.events.append({"sequence": len(record.events) + 1, **event.as_dict()})

    def _attach_error(self, record: RunRecord, code: str, message: str, retryable: bool) -> None:
        """Record the docs/07 section 11 error event on the failed run."""
        sink = ListEventSink()
        EventEmitter("+".join(record.configurations), sink, clock=lambda: 0.0).emit(
            "run.error", error_code=code, message=message, retryable=retryable
        )
        self._attach(record, sink.events)
