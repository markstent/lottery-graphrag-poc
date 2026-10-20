"""Readiness checks behind GET /api/v1/health/ready (spec 6.1).

Four checks, reported separately from liveness:

- ``lab``: the retrieval lab is built. Readiness never builds it or waits
  for a build; it reads the query service's state.
- ``index``: the vector collection exists, holds points and, for a
  persistent index, its manifest names this code's record serialiser.
- ``graph``: Neo4j answers ``RETURN 1`` within ``NEO4J_TIMEOUT_S``.
- ``model``: the generation model is reachable (``gateway.probe``: an
  Ollama model must be listed by its server, any other provider must answer
  a 1-token completion); the fake generator is always reachable. Results
  are cached for 30 s.

Each check runs in its own thread under its own timeout, so one slow
service never hides the others and readiness never raises. Details are
curated sentences: the raw driver or provider text, which can name service
addresses, goes to the log only.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Mapping
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.api.runs import LabState, QueryService
from app.api.schemas import Check, Readiness
from app.config import GenerationSettings, GraphConfig, RetrievalSettings, from_env
from app.models import gateway
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.standard.index import check_manifest, persists_index
from app.retrieval.standard.vector_store import QdrantVectorStore, VectorStore, VectorStoreError

logger = logging.getLogger(__name__)

Clock = Callable[[], float]

# The lab check reads in-process state only.
LAB_TIMEOUT_S = 1.0
INDEX_TIMEOUT_S = 5.0
MODEL_CACHE_TTL_S = 30.0

UNEXPECTED_DETAIL = "The check failed unexpectedly; the details are in the server log."
_LAB_DETAILS: dict[LabState, str] = {
    "built": "built",
    "building": "building",
    "not started": "not started",
    "failed": "the last build failed; the next run retries it",
}


@dataclass(frozen=True, slots=True)
class Probe:
    """One check: the call, its timeout and the detail shown when it raises."""

    run: Callable[[], Check]
    timeout_s: float
    failure: str = UNEXPECTED_DETAIL


def run_checks(probes: Mapping[str, Probe]) -> dict[str, Check]:
    """Run every probe in its own thread at once; each gets its own timeout.

    A probe that times out keeps running in its daemon thread and reports
    ``timed out after N s``; one that raises reports its curated failure.
    """
    started = time.monotonic()
    futures: dict[str, Future[Check]] = {}
    for name, probe in probes.items():
        future: Future[Check] = Future()
        futures[name] = future
        threading.Thread(
            target=_settle, args=(name, probe, future), name=f"ready-{name}", daemon=True
        ).start()
    results: dict[str, Check] = {}
    for name, probe in probes.items():
        remaining = max(0.0, started + probe.timeout_s - time.monotonic())
        try:
            results[name] = futures[name].result(timeout=remaining)
        except FutureTimeout:
            results[name] = Check(ok=False, detail=f"timed out after {probe.timeout_s:g} s")
    return results


def _settle(name: str, probe: Probe, future: Future[Check]) -> None:
    try:
        future.set_result(probe.run())
    except Exception as error:
        logger.warning("readiness check failed", exc_info=error, extra={"check": name})
        future.set_result(Check(ok=False, detail=probe.failure))


def lab_check(state: LabState) -> Check:
    return Check(ok=state == "built", detail=_LAB_DETAILS[state])


def index_check(settings: RetrievalSettings, store: VectorStore | None) -> Check:
    """The built lab's store when given, else a read-only view of the
    configured collection (never created here)."""
    persistent = persists_index(settings.embedding.provider)
    if store is None:
        if not persistent:
            return Check(ok=False, detail="not built: the in-memory index is built with the lab")
        store = QdrantVectorStore(
            url=settings.vector.url,
            collection=settings.vector.collection,
            dimensions=settings.embedding.dimensions,
        )
    points = int(store.collection_info()["points"])
    if points == 0:
        return Check(ok=False, detail="the collection holds no points")
    if persistent:
        try:
            check_manifest(Path(settings.dataset_dir))
        except VectorStoreError as error:
            logger.warning("index manifest refused", extra={"reason": str(error)})
            return Check(
                ok=False, detail="the index was built by another record serialiser; rebuild it"
            )
    return Check(ok=True, detail=f"{points} points")


def graph_check(config: GraphConfig) -> Check:
    reader = GraphReader(config)
    try:
        reader.ping()
    finally:
        reader.close()
    return Check(ok=True, detail="Neo4j answered")


class ModelReachability:
    """Whether the generation provider is reachable (``gateway.probe``),
    cached per configuration for ``MODEL_CACHE_TTL_S`` (failures too, so a
    down provider is not called on every poll). Safe for concurrent calls."""

    def __init__(
        self, clock: Clock = time.monotonic, transport: httpx.BaseTransport | None = None
    ) -> None:
        self._clock = clock
        self._transport = transport
        self._lock = threading.Lock()
        self._cached: tuple[tuple[GenerationSettings, str | None], float, Check] | None = None

    def check(self, settings: GenerationSettings, ollama_host: str | None = None) -> Check:
        key = (settings, ollama_host)
        now = self._clock()
        with self._lock:
            cached = self._cached
        if cached is not None:
            cached_key, checked_at, result = cached
            if cached_key == key and now - checked_at < MODEL_CACHE_TTL_S:
                return result
        result = self._probe(settings, ollama_host)
        with self._lock:
            self._cached = (key, now, result)
        return result

    def _probe(self, settings: GenerationSettings, ollama_host: str | None) -> Check:
        if settings.provider == "fake":
            return Check(ok=True, detail="fake generator (offline)")
        if settings.provider != "litellm":
            return Check(ok=False, detail="unknown generation provider")
        reached = gateway.probe(settings, ollama_host, self._transport)
        return Check(ok=reached.ok, detail=reached.detail)


class ReadinessChecks:
    """Runs the four checks for the API. Settings come from the built lab,
    or from the environment while it is not built."""

    def __init__(
        self,
        service: QueryService,
        graph: GraphConfig,
        settings: Callable[[], RetrievalSettings] = from_env,
        clock: Clock = time.monotonic,
    ) -> None:
        self._service = service
        self._graph = graph
        self._settings = settings
        self.model = ModelReachability(clock)

    def run(self) -> Readiness:
        lab, state = self._service.lab_status()
        try:
            settings = lab.settings if lab is not None else self._settings()
        except ValueError as error:
            logger.warning("readiness settings invalid", exc_info=error)
            invalid = Check(ok=False, detail="the configuration is invalid")
            index = model = Probe(lambda: invalid, timeout_s=LAB_TIMEOUT_S)
        else:
            store = lab.store if lab is not None else None
            index = Probe(
                lambda: index_check(settings, store),
                timeout_s=INDEX_TIMEOUT_S,
                failure="The vector index could not be read.",
            )
            host = settings.embedding.host or None
            model = Probe(
                lambda: self.model.check(settings.generation, host),
                timeout_s=gateway.probe_timeout_s(settings.generation, host),
            )
        checks = run_checks(
            {
                "lab": Probe(lambda: lab_check(state), timeout_s=LAB_TIMEOUT_S),
                "index": index,
                "graph": Probe(
                    lambda: graph_check(self._graph),
                    timeout_s=self._graph.timeout_s,
                    failure="Neo4j did not answer.",
                ),
                "model": model,
            }
        )
        return Readiness(ready=all(check.ok for check in checks.values()), checks=checks)
