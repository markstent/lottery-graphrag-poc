"""FastAPI application entry point.

Phase 11 wires the presentation surface: health, live query execution over
pipelines A/B/C with recorded replayable events (docs/07 sections 3-6), the
fixed demo question set, and the latest published benchmark summary. The
query service reads its world and models from configuration only; it never
reads the truth ledger (ADR-008).
"""

import os
from collections.abc import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import health, queries
from app.api.runs import QueryService
from app.config import RetrievalSettings, from_env
from app.graph.config import GraphConfig
from app.graph.config import from_env as from_graph_env

API_PREFIX = "/api/v1"

# The presentation frontend runs on a different port in development; the
# demo API is a localhost service, so origins are explicit and configurable.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]


def default_service() -> QueryService:
    """Service from environment configuration (world, models, gateway)."""
    settings: RetrievalSettings = from_env()
    graph_config: GraphConfig = from_graph_env()
    return QueryService(
        settings=settings,
        graph_config=graph_config,
        generator_name=settings.generation.provider,
    )


def create_app(
    service_factory: Callable[[], QueryService] = default_service,
) -> FastAPI:
    """Build the application; tests inject their own service factory."""
    application = FastAPI(title="Semantic Context Lab", version=__version__)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )
    application.include_router(health.router, prefix=API_PREFIX)
    application.include_router(queries.build_queries_router(service_factory()), prefix=API_PREFIX)
    application.include_router(queries.build_benchmarks_router(), prefix=API_PREFIX)
    return application


app = create_app()
