"""FastAPI application entry point.

Phase 11 wires the presentation surface: health, live query execution over
pipelines A/B/C with recorded replayable events (docs/07 sections 3-6), the
fixed demo question set, and the latest published benchmark summary. The
query service reads its world and models from configuration only; it never
reads the truth ledger (ADR-008).
"""

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import health, queries
from app.api.runs import QueryService
from app.config import GraphConfig, RetrievalSettings, api_from_env, from_env

API_PREFIX = "/api/v1"


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
    application = FastAPI(title="Semantic Context Lab", version=__version__)
    # The presentation frontend runs on a different port in development; the
    # demo API is a localhost service, so origins are explicit and configurable.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )
    application.include_router(health.router, prefix=API_PREFIX)
    application.include_router(queries.build_queries_router(service_factory()), prefix=API_PREFIX)
    application.include_router(
        queries.build_benchmarks_router(settings.benchmark_dir), prefix=API_PREFIX
    )
    return application


app = create_app()
