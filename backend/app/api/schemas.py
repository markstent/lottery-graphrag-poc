"""Request and response models for the versioned public API."""

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Response for GET /api/v1/health."""

    status: Literal["ok"]
    version: str
