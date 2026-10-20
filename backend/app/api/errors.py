"""One error model for the API: codes, retryability and the response envelope.

Every failure the API reports, whether an HTTP error or a failed run, carries
``{error_code, message, retryable}``. ``classify`` is the single mapping from
an exception to a code, and ``RUN_ERROR_MESSAGES`` the single mapping from a
code to the sentence a body carries. Technical detail (wrapped library errors
can name service URLs or quote provider responses) is logged, never put in a
body.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from enum import StrEnum

from fastapi import FastAPI, Request, Response
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
    # The request is valid but the state it needs is not there: a busy graph,
    # another world, a run that already finished, an id that is not unique.
    CONFLICT = "CONFLICT"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    MODEL_ERROR = "MODEL_ERROR"
    EMBEDDING_ERROR = "EMBEDDING_ERROR"
    VECTOR_RETRIEVAL_ERROR = "VECTOR_RETRIEVAL_ERROR"
    GRAPH_QUERY_ERROR = "GRAPH_QUERY_ERROR"
    CONTEXT_BUILD_ERROR = "CONTEXT_BUILD_ERROR"
    INTERRUPTED = "INTERRUPTED"
    CANCELLED = "CANCELLED"
    RUN_ERROR = "RUN_ERROR"
    # The server is missing a prepared artefact (such as the grounded bank).
    CONFIGURATION_ERROR = "CONFIGURATION_ERROR"


class ApiErrorBody(BaseModel):
    """The error object every failure carries (docs/07 section 11)."""

    error_code: str
    message: str
    retryable: bool


class ApiError(Exception):
    """An HTTP failure with its own status and code, rendered as the envelope."""

    def __init__(self, status: int, code: ErrorCode, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable


# The one sentence each run failure shows; the exception text goes to the log.
RUN_ERROR_MESSAGES: dict[str, str] = {
    ErrorCode.MODEL_ERROR: "The language model could not produce an answer.",
    ErrorCode.EMBEDDING_ERROR: "The embedding model could not encode the question.",
    ErrorCode.VECTOR_RETRIEVAL_ERROR: "The vector index could not be searched.",
    ErrorCode.GRAPH_QUERY_ERROR: "The graph database could not answer the query.",
    ErrorCode.CONTEXT_BUILD_ERROR: "The evidence could not be ranked for the answer.",
    ErrorCode.CANCELLED: "The run was cancelled.",
    ErrorCode.RUN_ERROR: UNEXPECTED_MESSAGE,
}
CANCELLED_BODY = ApiErrorBody(
    error_code=ErrorCode.CANCELLED,
    message=RUN_ERROR_MESSAGES[ErrorCode.CANCELLED],
    retryable=True,
)


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


def run_error_body(exc: BaseException) -> ApiErrorBody:
    """The envelope of a failed run: the exception's code, retryability and curated message."""
    code, retryable = classify(exc)
    return ApiErrorBody(error_code=code, message=RUN_ERROR_MESSAGES[code], retryable=retryable)


def _respond(status: int, code: ErrorCode, message: str, retryable: bool = False) -> JSONResponse:
    body = ApiErrorBody(error_code=code, message=message, retryable=retryable)
    return JSONResponse(status_code=status, content={"error": body.model_dump()})


def _validation_message(exc: RequestValidationError) -> str:
    issues = [
        f"{'.'.join(str(part) for part in error['loc'] if part != 'body')}: {error['msg']}"
        for error in exc.errors()
    ]
    return "; ".join(issues) or "invalid request"


def _http_code(status: int) -> ErrorCode:
    """The code of a framework-raised HTTP error: the client's own mistake
    (any other 4xx) is a validation error, never a run error."""
    if status == 404:
        return ErrorCode.NOT_FOUND
    if status == 405:
        return ErrorCode.METHOD_NOT_ALLOWED
    return ErrorCode.VALIDATION_ERROR if 400 <= status < 500 else ErrorCode.RUN_ERROR


def install_handlers(app: FastAPI) -> None:
    """Make every HTTP error use the envelope.

    Call it before adding the CORS middleware: unhandled errors are caught by
    an HTTP middleware rather than an ``Exception`` handler, because Starlette
    runs that handler outside every middleware, so a 500 would lose its CORS
    headers and the browser could not read the envelope.
    """

    @app.exception_handler(ApiError)
    async def api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return _respond(exc.status, exc.code, exc.message, exc.retryable)

    @app.exception_handler(RequestValidationError)
    async def validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _respond(422, ErrorCode.VALIDATION_ERROR, _validation_message(exc))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _respond(exc.status_code, _http_code(exc.status_code), str(exc.detail))

    @app.middleware("http")
    async def unhandled(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            logger.error(
                "unhandled error",
                exc_info=exc,
                extra={"method": request.method, "path": request.url.path},
            )
            return _respond(500, ErrorCode.RUN_ERROR, UNEXPECTED_MESSAGE)
