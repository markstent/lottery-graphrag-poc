"""Liveness and readiness routes (spec 6.1).

``/health`` says the process is up. ``/health/ready`` runs the checks of
``app.api.readiness`` and answers 200 when every check passes, else 503 with
the same body.
"""

from fastapi import APIRouter, Request, Response

from app import __version__
from app.api.readiness import ReadinessChecks
from app.api.schemas import HealthResponse, Readiness, error_responses

router = APIRouter()


@router.get("/health", response_model=HealthResponse, responses=error_responses())
def read_health() -> HealthResponse:
    """Liveness probe used by CI, Docker and the frontend."""
    return HealthResponse(status="ok", version=__version__)


@router.get(
    "/health/ready",
    response_model=Readiness,
    responses={
        **error_responses(),
        # Not an envelope: a failed check carries the same body as a pass.
        503: {"model": Readiness, "description": "A check failed"},
    },
)
def read_readiness(request: Request, response: Response) -> Readiness:
    """Readiness: the lab, the index, Neo4j and the model provider."""
    checks: ReadinessChecks = request.app.state.readiness
    readiness = checks.run()
    if not readiness.ready:
        response.status_code = 503
    return readiness
