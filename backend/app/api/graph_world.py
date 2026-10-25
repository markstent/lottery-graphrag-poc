"""Who holds the graph, and whether it holds the active world.

The fingerprint itself (``graph_world_matches``) lives in
``app.graph.fingerprint``; ``GraphWorldCheck`` caches it here.

``GraphLease`` records who holds the graph: live runs, or one benchmark job
that ingests other worlds into it. While a job holds it, every graph read
for the active dataset is refused or degraded without consulting the cache.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.api.errors import ApiError, ErrorCode
from app.graph.fingerprint import LabelCounts, graph_world_matches
from app.graph.ingest import GRAPH_STATS_FILE

Clock = Callable[[], float]

WORLD_CHECK_TTL_S = 30.0


GRAPH_BUSY_MESSAGE = "a benchmark run is using the graph; try again when it finishes"
QUERY_RUNNING_MESSAGE = "a live query is using the graph; try again when it finishes"
JOB_RUNNING_MESSAGE = "a benchmark job is already running; one runs at a time"


class GraphLease:
    """Who holds the shared graph: any number of live runs, or one benchmark job.

    A benchmark job re-ingests other worlds into the Neo4j that live runs
    read, so neither starts while the other holds the graph; each refusal is
    a 409 a client may retry. ``app.main`` owns the one lease and hands it to
    the query service and the benchmark jobs. Safe for concurrent calls.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queries = 0
        self._benchmark = False
        # Bumped whenever a benchmark job takes or releases the graph, so a
        # world check cached under one holder is never served under another.
        self.generation = 0

    @property
    def benchmark_running(self) -> bool:
        return self._benchmark

    def take_query(self) -> LeaseHold:
        """Hold the graph for one live run; a 409 while a benchmark job holds it."""
        with self._lock:
            if self._benchmark:
                raise ApiError(409, ErrorCode.CONFLICT, GRAPH_BUSY_MESSAGE, retryable=True)
            self._queries += 1
        return LeaseHold(self._release_query)

    def take_benchmark(self) -> LeaseHold:
        """Hold the graph for one benchmark job; a 409 while a job or a live run holds it."""
        with self._lock:
            if self._benchmark:
                raise ApiError(409, ErrorCode.CONFLICT, JOB_RUNNING_MESSAGE, retryable=True)
            if self._queries:
                raise ApiError(409, ErrorCode.CONFLICT, QUERY_RUNNING_MESSAGE, retryable=True)
            self._benchmark = True
            self.generation += 1
        return LeaseHold(self._release_benchmark)

    def _release_query(self) -> None:
        with self._lock:
            self._queries -= 1

    def _release_benchmark(self) -> None:
        with self._lock:
            self._benchmark = False
            self.generation += 1


class LeaseHold:
    """One holder's claim on the graph. ``release`` is idempotent, so a
    holder releases as soon as it is done with the graph (before it
    publishes its final status) and again in a ``finally`` as a backstop."""

    def __init__(self, release: Callable[[], None]) -> None:
        self._release = release
        self._lock = threading.Lock()
        self._released = False

    def release(self) -> None:
        with self._lock:
            if self._released:
                return
            self._released = True
        self._release()


class GraphWorldCheck:
    """``graph_world_matches`` cached for ``WORLD_CHECK_TTL_S`` for the last
    dataset and statistics file checked, so a re-ingestion that rewrites the
    file is seen at once. A failed graph read is not cached. Safe for
    concurrent calls.

    With a ``lease``, ``benchmark_running`` tells callers to answer before
    any check; the cache is then neither read nor written, and each entry is
    keyed by the lease's generation, so a match cached before a job is
    never served after it."""

    def __init__(self, clock: Clock = time.monotonic, lease: GraphLease | None = None) -> None:
        self._clock = clock
        self._lease = lease
        self._lock = threading.Lock()
        # (dataset directory, statistics mtime, lease generation), when read,
        # result: the last check.
        self._cached: tuple[tuple[Path, int, int], float, bool | None] | None = None

    @property
    def benchmark_running(self) -> bool:
        """Whether a benchmark job holds the graph, which then holds any world."""
        return self._lease is not None and self._lease.benchmark_running

    def __call__(self, reader: LabelCounts, dataset_dir: Path) -> bool | None:
        try:
            stamp = (dataset_dir / GRAPH_STATS_FILE).stat().st_mtime_ns
        except FileNotFoundError:
            return None
        if self.benchmark_running:
            return False
        generation = self._lease.generation if self._lease is not None else 0
        key = (dataset_dir.resolve(), stamp, generation)
        with self._lock:
            cached = self._cached
            now = self._clock()
            if cached is not None and cached[0] == key and now - cached[1] < WORLD_CHECK_TTL_S:
                return cached[2]
        result = graph_world_matches(reader, dataset_dir)
        if self.benchmark_running:
            return False
        with self._lock:
            self._cached = (key, now, result)
        return result
