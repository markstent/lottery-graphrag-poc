"""Readiness checks behind GET /api/v1/health/ready (spec 6.1).

Five checks, reported separately from liveness:

- ``lab``: the retrieval lab is built. Readiness never builds it or waits
  for a build; it reads the query service's state.
- ``index``: the vector collection exists, holds points and, for a
  persistent index, its manifest names this code's record serialiser.
- ``graph``: Neo4j answers ``RETURN 1`` within ``NEO4J_TIMEOUT_S`` and does
  not hold another world than the configured dataset
  (``app.api.graph_world``, cached for 30 s).
- ``model``: the generation model is reachable (``gateway.probe``: an
  Ollama model must be listed by its server, any other provider must answer
  a 1-token completion); the fake generator is always reachable. Results
  are cached for 30 s.
- ``embedding``: the embedding model is reachable (an Ollama model must be
  listed by its server; the hashing embedder is always reachable), through
  the same cached ``ModelReachability`` as ``model``.

Each check runs in its own thread under its own timeout, so one slow
service never hides the others and readiness never raises. Details are
curated sentences: the raw driver or provider text, which can name service
addresses, goes to the log only.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Hashable, Mapping
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.api.graph_world import GraphWorldCheck
from app.api.runs import LabState, QueryService
from app.api.schemas import Check, Readiness
from app.config import (
    EmbeddingSettings,
    GenerationSettings,
    GraphConfig,
    RetrievalSettings,
    from_env,
)
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
    configured collection (never created here, closed after the check)."""
    if store is not None:
        return _index_state(settings, store)
    if not persists_index(settings.embedding.provider):
        return Check(ok=False, detail="not built: the in-memory index is built with the lab")
    view = QdrantVectorStore(
        url=settings.vector.url,
        collection=settings.vector.collection,
        dimensions=settings.embedding.dimensions,
    )
    try:
        return _index_state(settings, view)
    finally:
        view.close()


def _index_state(settings: RetrievalSettings, store: VectorStore) -> Check:
    points = int(store.collection_info()["points"])
    if points == 0:
        return Check(ok=False, detail="the collection holds no points")
    if persists_index(settings.embedding.provider):
        try:
            check_manifest(Path(settings.dataset_dir))
        except VectorStoreError as error:
            logger.warning("index manifest refused", extra={"reason": str(error)})
            return Check(
                ok=False, detail="the index was built by another record serialiser; rebuild it"
            )
    return Check(ok=True, detail=f"{points} points")


def graph_check(config: GraphConfig, dataset_dir: Path | None, world: GraphWorldCheck) -> Check:
    """Neo4j answers and, when ``dataset_dir`` is given, does not hold
    another world than it (a dataset never ingested cannot be compared).
    While a benchmark job holds the graph it is not ready, whatever it holds."""
    if world.benchmark_running:
        return Check(ok=False, detail="a benchmark run is using the graph")
    reader = GraphReader(config)
    try:
        reader.ping()
        if dataset_dir is not None and world(reader, dataset_dir) is False:
            return Check(ok=False, detail="the graph holds another world")
    finally:
        reader.close()
    return Check(ok=True, detail="Neo4j answered")


class ModelReachability:
    """Whether a model provider is reachable, cached per configuration for
    ``MODEL_CACHE_TTL_S`` (failures too, so a down provider is not called on
    every poll). Single-flight: concurrent checks of one configuration share
    one probe. Safe for concurrent calls.

    ``check`` is the generation model (``gateway.probe``); ``check_embedding``
    is the embedding model, listed by its Ollama server."""

    def __init__(
        self, clock: Clock = time.monotonic, transport: httpx.BaseTransport | None = None
    ) -> None:
        self._clock = clock
        self._transport = transport
        self._lock = threading.Lock()
        self._cached: dict[Hashable, tuple[float, Check]] = {}
        self._in_flight: dict[Hashable, Future[Check]] = {}

    def check(self, settings: GenerationSettings, ollama_host: str | None = None) -> Check:
        return self._shared((settings, ollama_host), lambda: self._probe(settings, ollama_host))

    def check_embedding(self, settings: EmbeddingSettings) -> Check:
        return self._shared(settings, lambda: self._probe_embedding(settings))

    def _shared(self, key: Hashable, probe: Callable[[], Check]) -> Check:
        with self._lock:
            now = self._clock()
            cached = self._cached.get(key)
            if cached is not None and now - cached[0] < MODEL_CACHE_TTL_S:
                return cached[1]
            shared = self._in_flight.get(key)
            if shared is None:
                owned: Future[Check] = Future()
                self._in_flight[key] = owned
        if shared is not None:
            return shared.result()
        try:
            result = probe()
        except BaseException as error:
            # The probe curates every expected failure; anything else is a
            # defect. Waiters must never be left blocked on a stale entry,
            # so it is cleared even for an interrupt.
            owned.set_exception(error)
            raise
        else:
            with self._lock:
                self._cached[key] = (now, result)
            owned.set_result(result)
            return result
        finally:
            with self._lock:
                del self._in_flight[key]

    def _probe(self, settings: GenerationSettings, ollama_host: str | None) -> Check:
        if settings.provider == "fake":
            return Check(ok=True, detail="fake generator (offline)")
        if settings.provider != "litellm":
            return Check(ok=False, detail="unknown generation provider")
        reached = gateway.probe(settings, ollama_host, self._transport)
        return Check(ok=reached.ok, detail=reached.detail)

    def _probe_embedding(self, settings: EmbeddingSettings) -> Check:
        if settings.provider == "hashing":
            return Check(ok=True, detail="hashing embedder (offline)")
        if settings.provider != "ollama":
            return Check(ok=False, detail="unknown embedding provider")
        reached = gateway.probe_ollama(settings.host.rstrip("/"), settings.model, self._transport)
        return Check(ok=reached.ok, detail=reached.detail)


class ReadinessChecks:
    """Runs the five checks for the API. Settings come from the built lab,
    or from the environment while it is not built."""

    def __init__(
        self,
        service: QueryService,
        graph: GraphConfig,
        settings: Callable[[], RetrievalSettings] = from_env,
        clock: Clock = time.monotonic,
        world: GraphWorldCheck | None = None,
    ) -> None:
        self._service = service
        self._graph = graph
        self._settings = settings
        self.model = ModelReachability(clock)
        self._world = world if world is not None else GraphWorldCheck(clock)

    def run(self) -> Readiness:
        lab, state = self._service.lab_status()
        dataset_dir: Path | None = None
        try:
            settings = lab.settings if lab is not None else self._settings()
        except ValueError as error:
            logger.warning("readiness settings invalid", exc_info=error)
            invalid = Check(ok=False, detail="the configuration is invalid")
            index = model = embedding = Probe(lambda: invalid, timeout_s=LAB_TIMEOUT_S)
        else:
            dataset_dir = Path(settings.dataset_dir)
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
            embedding = Probe(
                lambda: self.model.check_embedding(settings.embedding),
                timeout_s=gateway.OLLAMA_PROBE_TIMEOUT_S,
            )
        checks = run_checks(
            {
                "lab": Probe(lambda: lab_check(state), timeout_s=LAB_TIMEOUT_S),
                "index": index,
                "graph": Probe(
                    lambda: graph_check(self._graph, dataset_dir, self._world),
                    timeout_s=self._graph.timeout_s,
                    failure="Neo4j did not answer.",
                ),
                "model": model,
                "embedding": embedding,
            }
        )
        return Readiness(ready=all(check.ok for check in checks.values()), checks=checks)
