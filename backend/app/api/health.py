"""Typed API contracts.

Phase 0 scaffold: only the health check endpoint exists. Experiment, query,
scenario, benchmark and model endpoints are added in later approved phases
(see docs/07-api-event-spec.md).
"""

from fastapi import APIRouter

from app import __version__
from app.api.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def read_health() -> HealthResponse:
    """Liveness probe used by CI, Docker and the frontend."""
    return HealthResponse(status="ok", version=__version__)
