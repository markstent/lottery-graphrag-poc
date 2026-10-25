"""Server-sent event framing of a run's stored events (docs/reference/07 section 6, ADR-004).

The stream reads the run store, the same events replay serves, so a client
that reconnects with ``Last-Event-ID`` (or ``?after=``) resumes exactly where
it stopped and nothing is ever re-executed. Between events it waits on the
query service; a wait that passes with nothing new yields a heartbeat comment
so proxies keep the connection open.

``sse_frames`` is a plain generator that Starlette iterates on its thread
pool, one ``next`` at a time on whichever pool thread is free. Each read
therefore closes its own thread's store connection (ADR-007's per-thread
rule), and the run identifier goes into each log record's ``extra`` rather
than a ``run_context`` held across a ``yield``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator

from app.api.event_schemas import RecordedEvent
from app.events import TERMINAL_EVENT_TYPES
from app.persistence.store import RunStore

HEARTBEAT = ": keep-alive\n\n"
logger = logging.getLogger(__name__)


def _frame(event: RecordedEvent) -> str:
    inner = event.root
    return f"id: {inner.sequence}\nevent: {inner.event_type}\ndata: {event.model_dump_json()}\n\n"


def _read(store: RunStore, run_id: str, after: int) -> list[RecordedEvent]:
    try:
        return [RecordedEvent.model_validate(event) for event in store.events(run_id, after)]
    finally:
        store.close()


def sse_frames(
    run_id: str,
    after: int,
    store: RunStore,
    wait_for: Callable[[str, int, float], bool],
    heartbeat_s: float,
) -> Iterator[str]:
    """Frame every stored event after sequence ``after``, then each new one
    as it is stored, until the run's terminal event.

    ``wait_for(run_id, after, timeout)`` is ``QueryService.wait_for``: True
    once something after ``after`` is stored, or at once when the run is no
    longer active. A True wait followed by an empty read therefore means the
    run has ended without a terminal event (its final write failed), and the
    stream closes rather than spinning. A store failure is logged and closes
    the stream between frames, never inside one.
    """
    woke = False
    while True:
        try:
            events = _read(store, run_id, after)
        except Exception as error:  # the body is already streaming: no error response is possible
            logger.error(
                "event stream read failed; closing the stream",
                exc_info=error,
                extra={"run_id": run_id},
            )
            return
        for event in events:
            yield _frame(event)
            after = event.root.sequence
            if event.root.event_type in TERMINAL_EVENT_TYPES:
                return
        if woke and not events:
            return
        woke = wait_for(run_id, after, heartbeat_s)
        if not woke:
            yield HEARTBEAT
