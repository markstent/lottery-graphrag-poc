"""Structured JSON logging with run context, stage timings and redaction.

``configure_logging`` installs one JSON handler on the root logger. Run
identifiers are bound with ``run_context`` through ``contextvars`` and copied
onto every record by a record factory, so they reach any handler (including
test capture) without being repeated in each ``extra=``. Records never carry
a field whose name suggests a secret.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

# Stage names of docs/07 and the evaluation scorer; "pipeline_run" times a
# whole pipeline call where the stages cannot be split.
STAGES = (
    "embedding",
    "vector_retrieval",
    "graph_traversal",
    "reranking",
    "context_building",
    "generation",
    "evaluation",
    "pipeline_run",
)
_SECRET_MARKERS = ("key", "token", "password", "secret")
_STANDARD_ATTRIBUTES = frozenset(vars(logging.makeLogRecord({}))) | {
    "message",
    "asctime",
    "taskName",
}
_context: ContextVar[dict[str, str] | None] = ContextVar("log_context", default=None)
_factory_installed = False


@contextmanager
def run_context(**fields: str) -> Iterator[None]:
    """Bind identifiers (experiment_id, run_id, question_id, pipeline, ...) to every record."""
    token = _context.set({**(_context.get() or {}), **fields})
    try:
        yield
    finally:
        _context.reset(token)


@contextmanager
def stage_timer(stage: str) -> Iterator[None]:
    """Log the stage, its duration and its outcome (``ok`` or the exception class name)."""
    if stage not in STAGES:
        raise ValueError(f"unknown stage {stage!r}; expected one of {STAGES}")
    started = time.perf_counter()
    outcome = "ok"
    try:
        yield
    except BaseException as error:
        outcome = type(error).__name__
        raise
    finally:
        logging.getLogger(__name__).info(
            "stage timed",
            extra={
                "stage": stage,
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                "outcome": outcome,
            },
        )


def _is_secret(name: str) -> bool:
    lowered = name.lower()
    return any(marker in lowered for marker in _SECRET_MARKERS)


def _install_record_factory() -> None:
    global _factory_installed
    if _factory_installed:
        return
    previous = logging.getLogRecordFactory()

    def factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = previous(*args, **kwargs)
        for name, value in (_context.get() or {}).items():
            record.__dict__.setdefault(name, value)
        return record

    logging.setLogRecordFactory(factory)
    _factory_installed = True


class _StderrHandler(logging.StreamHandler):  # type: ignore[type-arg]
    """Writes to whatever ``sys.stderr`` is at emit time, so redirection is honoured."""

    def __init__(self) -> None:
        super().__init__(sys.stderr)

    @property
    def stream(self) -> Any:
        return sys.stderr

    @stream.setter
    def stream(self, _value: Any) -> None:
        """The base class assigns a stream on construction; the live one always wins."""


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, logger, message, then context and extras."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for name, value in record.__dict__.items():
            if name not in _STANDARD_ATTRIBUTES and not _is_secret(name):
                payload[name] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON handler on the root logger; calling it again only updates the level."""
    _install_record_factory()
    root = logging.getLogger()
    root.setLevel(level.upper())
    for handler in root.handlers:
        if isinstance(handler.formatter, JsonFormatter):
            return
    handler = _StderrHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)


_install_record_factory()
