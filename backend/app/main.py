"""FastAPI application entry point.

Wires the presentation surface: health, persisted query runs over pipelines
A/B/C with recorded replayable events and run history (docs/07 sections 3-6,
ADR-007), the fixed demo question set, the benchmark routes (published
runs, the question catalogue and benchmark jobs), the Data Model reads
(worlds, dictionary, rows and records), the graph reads (schema, ingestion
statistics, nodes and neighbours) and the reference reads (ontology,
scenarios and configured models).
The query service reads its world and models from configuration only; it
never reads the truth ledger (ADR-008). Live runs and benchmark jobs share
one graph lease, so a benchmark never re-ingests the graph under a live run.
"""

import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import benchmarks, data_model, graph_model, health, queries, reference
from app.api.errors import INTERRUPTED_BODY, install_handlers
from app.api.graph_world import GraphLease, GraphWorldCheck
from app.api.readiness import ReadinessChecks
from app.api.runs import QueryService, interruption_events, start_lab
from app.api.scoring import interrupted_record
from app.config import GraphConfig, api_from_env, from_env
from app.lab import Lab
from app.observability.logging import configure_logging, run_context
from app.persistence.store import RunStore

API_PREFIX = "/api/v1"
REQUEST_ID_HEADER = "X-Request-ID"
_CLIENT_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{1,64}")
logger = logging.getLogger(__name__)


def default_lab() -> Lab:
    """The lab from environment configuration (world, models, gateway)."""
    return start_lab(from_env())


def create_app(
    lab_factory: Callable[[], Lab] | None = None,
    graph_config: GraphConfig | None = None,
) -> FastAPI:
    """Build the application; tests inject their own lab and graph config.

    The run store opens at start-up (the lifespan), not at import: start-up
    fails every run a stopped server left queued or running, then the query
    service starts on that store and begins building the lab in the
    background. ``lab_factory`` defaults to ``default_lab``, looked up at
    start-up, so tests can replace it even for the import-time ``app``.
    """
    settings = api_from_env()
    configure_logging(settings.log_level)
    graph = graph_config if graph_config is not None else GraphConfig.from_env()
    # One lease on the shared graph: live runs and benchmark jobs exclude each other.
    lease = GraphLease()
    # One cache of which world the graph holds, for every route and readiness;
    # bypassed while a benchmark job holds the lease.
    graph_world = GraphWorldCheck(lease=lease)
    jobs = benchmarks.BenchmarkJobs(settings.benchmark_dir, lease)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        store = RunStore(settings.db_path, settings.run_retention)
        try:
            interrupted = store.mark_interrupted(INTERRUPTED_BODY.model_dump(), interruption_events)
            unscored = store.mark_unscored(interrupted_record())
        finally:
            store.close()
        if interrupted:
            logger.warning("runs interrupted by a server stop", extra={"runs": interrupted})
        if unscored:
            logger.warning("scoring interrupted by a server stop", extra={"runs": unscored})
        factory = lab_factory if lab_factory is not None else default_lab
        service = QueryService(store, factory, graph, lease, graph_world=graph_world)
        application.state.query_service = service
        application.state.readiness = ReadinessChecks(service, graph, world=graph_world)
        service.warm_up()
        yield

    application = FastAPI(title="Semantic Context Lab", version=__version__, lifespan=lifespan)
    application.state.benchmark_jobs = jobs
    application.state.graph_lease = lease
    # Before CORS: the unhandled-error middleware must sit inside it.
    install_handlers(application)

    @application.middleware("http")
    async def request_id(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """Echo the client's request id when well formed, else mint one; bind it to the logs."""
        supplied = request.headers.get(REQUEST_ID_HEADER, "")
        rid = supplied if _CLIENT_REQUEST_ID.fullmatch(supplied) else uuid.uuid4().hex
        with run_context(request_id=rid):
            response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = rid
        return response

    # The presentation frontend runs on a different port in development; the
    # demo API is a localhost service, so origins are explicit and configurable.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["content-type", "x-request-id", "last-event-id"],
        expose_headers=["x-request-id"],
    )
    application.include_router(health.router, prefix=API_PREFIX)
    application.include_router(
        queries.build_queries_router(settings.sse_heartbeat_s), prefix=API_PREFIX
    )
    application.include_router(
        benchmarks.build_benchmarks_router(settings.benchmark_dir, jobs), prefix=API_PREFIX
    )
    application.include_router(
        data_model.build_data_model_router(graph, graph_world), prefix=API_PREFIX
    )
    application.include_router(
        graph_model.build_graph_router(graph, graph_world), prefix=API_PREFIX
    )
    application.include_router(reference.build_reference_router(), prefix=API_PREFIX)
    return application


app = create_app()
