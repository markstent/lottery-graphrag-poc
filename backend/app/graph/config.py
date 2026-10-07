"""Neo4j connection settings.

Values come from the environment (see .env.example); defaults match
docker-compose.yml for local development.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATASET_DIR = REPO_ROOT / "data" / "generated" / "dev-seed2026"

LABEL_VERSION = "v1"


@dataclass(frozen=True, slots=True)
class GraphConfig:
    """Connection settings for one Neo4j instance."""

    uri: str
    user: str
    password: str
    database: str


def from_env() -> GraphConfig:
    """Read settings from the environment with local-development defaults."""
    return GraphConfig(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        user=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASSWORD", "devpassword"),
        database=os.environ.get("NEO4J_DATABASE", "neo4j"),
    )
