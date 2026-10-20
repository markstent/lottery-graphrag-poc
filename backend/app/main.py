"""FastAPI application entry point.

Wires the presentation surface: health, persisted query runs over pipelines
A/B/C with recorded replayable events and run history (docs/07 sections 3-6,
ADR-007), the fixed demo question set, the latest published benchmark
summary, the Data Model reads (worlds, dictionary, rows and records) and
the graph reads (schema, ingestion statistics, nodes and neighbours).
The query service reads its world and models from configuration only; it
never reads the truth ledger (ADR-008).
"""

import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import data_model, graph_model, health, queries
from app.api.errors import install_handlers
from app.api.graph_world import GraphWorldCheck
from app.api.readiness import ReadinessChecks
from app.api.runs import QueryService, start_lab
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
    # One cache of which world the graph holds, for every route and readiness.
    graph_world = GraphWorldCheck()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        store = RunStore(settings.db_path, settings.run_retention)
        try:
            interrupted = store.mark_interrupted()
        finally:
            store.close()
        if interrupted:
            logger.warning("runs interrupted by a server stop", extra={"runs": interrupted})
        factory = lab_factory if lab_factory is not None else default_lab
        service = QueryService(store, factory, graph)
        application.state.query_service = service
        application.state.readiness = ReadinessChecks(service, graph, world=graph_world)
        service.warm_up()
        yield

    application = FastAPI(title="Semantic Context Lab", version=__version__, lifespan=lifespan)
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
        queries.build_benchmarks_router(settings.benchmark_dir), prefix=API_PREFIX
    )
    application.include_router(
        data_model.build_data_model_router(graph, graph_world), prefix=API_PREFIX
    )
    application.include_router(
        graph_model.build_graph_router(graph, graph_world), prefix=API_PREFIX
    )
    return application


app = create_app()
