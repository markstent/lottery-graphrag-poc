"""One error model for the API: codes, retryability and the response envelope.

Every failure the API reports, whether an HTTP error or a failed run, carries
``{error_code, message, retryable}``. ``classify`` is the single mapping from
an exception to a code. Technical detail is logged, never put in a body.
"""

from __future__ import annotations

import logging
from enum import StrEnum

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from neo4j.exceptions import (
    ConnectionPoolError,
    GqlError,
    ServiceUnavailable,
    SessionExpired,
    TransientError,
)
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.models.gateway import GatewayError
from app.retrieval.standard.embeddings import EmbeddingError
from app.retrieval.standard.generation import GenerationError
from app.retrieval.standard.reranking import RerankError
from app.retrieval.standard.sparse import SparseEmbeddingError
from app.retrieval.standard.vector_store import VectorStoreError

logger = logging.getLogger(__name__)

UNEXPECTED_MESSAGE = "The request failed unexpectedly. The details are in the server log."


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    MODEL_ERROR = "MODEL_ERROR"
    EMBEDDING_ERROR = "EMBEDDING_ERROR"
    VECTOR_RETRIEVAL_ERROR = "VECTOR_RETRIEVAL_ERROR"
    GRAPH_QUERY_ERROR = "GRAPH_QUERY_ERROR"
    CONTEXT_BUILD_ERROR = "CONTEXT_BUILD_ERROR"
    INTERRUPTED = "INTERRUPTED"
    CANCELLED = "CANCELLED"
    RUN_ERROR = "RUN_ERROR"


class ApiErrorBody(BaseModel):
    """The error object every failure carries (docs/07 section 11)."""

    error_code: str
    message: str
    retryable: bool


# Retryable failures are the transient ones: the database is unreachable or
# busy, the connection pool timed out, or the transaction hit its timeout
# (the server reports that as a TransientError). Other Neo4j errors are
# defects in the query or the data, so retrying cannot help.
_TRANSIENT_GRAPH_ERRORS = (ServiceUnavailable, SessionExpired, TransientError, ConnectionPoolError)

# First match wins. The reranker is the judge of context selection, so its
# failures are context build errors.
_CLASSIFICATION: tuple[tuple[type[BaseException], ErrorCode, bool], ...] = (
    (GenerationError, ErrorCode.MODEL_ERROR, True),
    (GatewayError, ErrorCode.MODEL_ERROR, True),
    (EmbeddingError, ErrorCode.EMBEDDING_ERROR, True),
    (SparseEmbeddingError, ErrorCode.EMBEDDING_ERROR, True),
    (VectorStoreError, ErrorCode.VECTOR_RETRIEVAL_ERROR, True),
    (RerankError, ErrorCode.CONTEXT_BUILD_ERROR, False),
)


def classify(exc: BaseException) -> tuple[ErrorCode, bool]:
    """The error code of an exception and whether retrying may succeed."""
    if isinstance(exc, _TRANSIENT_GRAPH_ERRORS):
        return ErrorCode.GRAPH_QUERY_ERROR, True
    if isinstance(exc, GqlError):
        return ErrorCode.GRAPH_QUERY_ERROR, False
    for error_type, code, retryable in _CLASSIFICATION:
        if isinstance(exc, error_type):
            return code, retryable
    return ErrorCode.RUN_ERROR, False


def _respond(status: int, code: ErrorCode, message: str, retryable: bool = False) -> JSONResponse:
    body = ApiErrorBody(error_code=code, message=message, retryable=retryable)
    return JSONResponse(status_code=status, content={"error": body.model_dump()})


def _validation_message(exc: RequestValidationError) -> str:
    issues = [
        f"{'.'.join(str(part) for part in error['loc'] if part != 'body')}: {error['msg']}"
        for error in exc.errors()
    ]
    return "; ".join(issues) or "invalid request"


def install_handlers(app: FastAPI) -> None:
    """Make every HTTP error use the envelope."""

    @app.exception_handler(RequestValidationError)
    async def validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _respond(422, ErrorCode.VALIDATION_ERROR, _validation_message(exc))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = ErrorCode.NOT_FOUND if exc.status_code == 404 else ErrorCode.RUN_ERROR
        return _respond(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "unhandled error",
            exc_info=exc,
            extra={"method": request.method, "path": request.url.path},
        )
        return _respond(500, ErrorCode.RUN_ERROR, UNEXPECTED_MESSAGE)
