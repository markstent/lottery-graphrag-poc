"""FastAPI application entry point.

Phase 11 wires the presentation surface: health, live query execution over
pipelines A/B/C with recorded replayable events (docs/07 sections 3-6), the
fixed demo question set, and the latest published benchmark summary. The
query service reads its world and models from configuration only; it never
reads the truth ledger (ADR-008).
"""

import re
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import health, queries
from app.api.runs import QueryService
from app.config import GraphConfig, RetrievalSettings, api_from_env, from_env
from app.observability.logging import configure_logging, run_context

API_PREFIX = "/api/v1"
REQUEST_ID_HEADER = "X-Request-ID"
_CLIENT_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{1,64}")


def default_service() -> QueryService:
    """Service from environment configuration (world, models, gateway)."""
    settings: RetrievalSettings = from_env()
    graph_config: GraphConfig = GraphConfig.from_env()
    return QueryService(
        settings=settings,
        graph_config=graph_config,
        generator_name=settings.generation.provider,
    )


def create_app(
    service_factory: Callable[[], QueryService] = default_service,
) -> FastAPI:
    """Build the application; tests inject their own service factory."""
    settings = api_from_env()
    configure_logging(settings.log_level)
    application = FastAPI(title="Semantic Context Lab", version=__version__)

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
        allow_headers=["content-type", "x-request-id"],
        expose_headers=["x-request-id"],
    )
    application.include_router(health.router, prefix=API_PREFIX)
    application.include_router(queries.build_queries_router(service_factory()), prefix=API_PREFIX)
    application.include_router(
        queries.build_benchmarks_router(settings.benchmark_dir), prefix=API_PREFIX
    )
    return application


app = create_app()
