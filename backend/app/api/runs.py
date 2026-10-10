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

import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from app.api.schemas import QueryRequest
from app.config import RetrievalSettings
from app.events import ListEventSink
from app.graph.config import GraphConfig
from app.retrieval.graph.lab import Lab, build_generator, build_lab, wired_pipelines
from app.retrieval.standard.embeddings import EmbeddingError
from app.retrieval.standard.generation import GenerationError
from app.retrieval.standard.vector_store import VectorStoreError

# Error classes from docs/07 section 11.
_ERROR_CODES: dict[type[Exception], str] = {
    GenerationError: "MODEL_ERROR",
    EmbeddingError: "EMBEDDING_ERROR",
    VectorStoreError: "VECTOR_RETRIEVAL_ERROR",
}

MAX_RUNS = 50


@dataclass
class RunRecord:
    """One query run: request, recorded events, results, error surface."""

    run_id: str
    question: str
    configurations: list[str]
    profile: str | None
    status: str = "running"
    events: list[dict[str, Any]] = field(default_factory=list)
    results: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None


def _error_code(error: Exception) -> str:
    for error_type, code in _ERROR_CODES.items():
        if isinstance(error, error_type):
            return code
    return "RUN_ERROR"


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
                # after a fresh start. A persisted Qdrant collection is
                # already populated and is left untouched.
                if lab.store.count() == 0 and lab.corpus:
                    ids = list(lab.corpus)
                    lab.store.upsert(
                        ids=ids,
                        vectors=lab.embeddings.embed(
                            [lab.corpus[chunk_id].text for chunk_id in ids]
                        ),
                        payloads=[lab.corpus[chunk_id].to_payload() for chunk_id in ids],
                    )
                self._lab = lab
            return self._lab

    # -- API surface ------------------------------------------------------

    def start(self, request: QueryRequest) -> str:
        run_id = f"RUN-{uuid.uuid4().hex[:12].upper()}"
        record = RunRecord(
            run_id=run_id,
            question=request.question,
            configurations=list(request.configurations),
            profile=request.profile,
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
                profile=record.profile,
                status=record.status,
                events=[dict(event) for event in record.events],
                results=dict(record.results),
                error_code=record.error_code,
                error_message=record.error_message,
            )

    # -- execution --------------------------------------------------------

    def _execute(self, record: RunRecord) -> None:
        try:
            lab = self._lab_once()
            for tag in record.configurations:
                if tag == "A":
                    sink = ListEventSink()
                    result = lab.pipeline_a(sink=sink).run(record.question)
                    record.results["A"] = result
                    self._attach(record, "A", sink.events)
                else:
                    self._run_graph(lab, record, tag)
            record.status = "completed"
        except (GenerationError, EmbeddingError, VectorStoreError) as error:
            record.status = "failed"
            record.error_code = _error_code(error)
            record.error_message = str(error)
            self._attach_error(record, record.error_code, str(error))
        except Exception as error:  # surfaced as a typed error, never a trace
            record.status = "failed"
            record.error_code = _error_code(error)
            record.error_message = f"{type(error).__name__}: {error}"
            self._attach_error(record, record.error_code, record.error_message)

    def _run_graph(self, lab: Lab, record: RunRecord, tag: str) -> None:
        wired = wired_pipelines(lab, self._graph_config, record.profile)
        try:
            for pipeline_tag, pipeline in wired.pipelines:
                if pipeline_tag != tag:
                    continue
                result = pipeline.run(record.question)
                record.results[pipeline_tag] = result
                self._attach(record, pipeline_tag, pipeline.events)
        finally:
            wired.reader.close()

    def _attach(self, record: RunRecord, pipeline: str, events: list[Any]) -> None:
        with self._lock:
            for event in events:
                record.events.append(
                    {
                        "sequence": len(record.events) + 1,
                        "event_type": event.event_type,
                        "pipeline": pipeline,
                        "t_ms": round(event.t_ms, 1),
                        "payload": dict(event.payload),
                    }
                )

    def _attach_error(self, record: RunRecord, code: str, message: str) -> None:
        """Record the docs/07 section 11 error event on the failed run."""
        with self._lock:
            record.events.append(
                {
                    "sequence": len(record.events) + 1,
                    "event_type": "run.error",
                    "pipeline": "+".join(record.configurations),
                    "t_ms": 0.0,
                    "payload": {"error_code": code, "message": message, "retryable": True},
                }
            )
