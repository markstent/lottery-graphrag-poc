"""FastAPI application entry point.

Phase 0 scaffold: only the health endpoint exists. The experiment
orchestrator, retrieval pipelines, evaluation engine and event stream are
implemented in later approved phases.
"""

from fastapi import FastAPI

from app import __version__
from app.api import health

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    """Build the FastAPI application."""
    application = FastAPI(title="Semantic Context Lab", version=__version__)
    application.include_router(health.router, prefix=API_PREFIX)
    return application


app = create_app()
