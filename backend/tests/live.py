"""Gating of the opt-in live tests.

Three flags switch live tests on, and CI sets none that needs the machine's
presentation world:

- ``GRAPH_E2E=1``: tests that use Neo4j (several wipe and re-ingest it).
- ``VECTOR_E2E=1``: tests that use Qdrant.
- ``LIVE_WORLD_E2E=1``: tests that need the presentation world (generated,
  ingested, indexed and grounded), its ledger, or Ollama.

A test whose flag is unset is skipped. A test whose flag is set never skips:
a missing prerequisite or an unreachable service is a failure, so a green run
with the flag set means the live test ran.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from app.api.graph_world import graph_world_matches, read_graph_stats
from app.config import GraphConfig, from_env
from app.graph import __main__ as graph_cli
from app.retrieval.graph.neo4j_adapter import GraphReader

# The presentation world's directory (``DATASET_DIR``), read when the tests are
# collected: every test then runs with DATASET_DIR pointing at an empty
# directory (conftest.no_ingested_world), and a live test that needs the real
# world sets it back to this.
PRESENTATION_DATASET_DIR = from_env().dataset_dir
_REAL_EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER")

GRAPH = "GRAPH_E2E"
VECTOR = "VECTOR_E2E"
WORLD = "LIVE_WORLD_E2E"


def use_the_real_world(monkeypatch: pytest.MonkeyPatch) -> None:
    """Undo, for one live test, the isolation every test gets (an empty
    ``DATASET_DIR`` and the hashing embedder): the presentation world and the
    embedding model the developer's environment names."""
    monkeypatch.setenv("DATASET_DIR", PRESENTATION_DATASET_DIR)
    if _REAL_EMBEDDING_PROVIDER is None:
        monkeypatch.delenv("EMBEDDING_PROVIDER", raising=False)
    else:
        monkeypatch.setenv("EMBEDDING_PROVIDER", _REAL_EMBEDDING_PROVIDER)


def enabled(*flags: str) -> bool:
    """Whether every flag is set to ``1``."""
    return all(os.environ.get(flag) == "1" for flag in flags)


def only_with(*flags: str) -> pytest.MarkDecorator:
    """Skip a test, or a whole module (``pytestmark``), unless every flag is set."""
    return pytest.mark.skipif(
        not enabled(*flags), reason=f"set {' and '.join(f'{flag}=1' for flag in flags)}"
    )


def skip_without(*flags: str) -> None:
    """Skip the calling test or fixture unless every flag is set."""
    if not enabled(*flags):
        pytest.skip(f"set {' and '.join(f'{flag}=1' for flag in flags)}")


def neo4j_reachable(config: GraphConfig) -> bool:
    reader = GraphReader(config)
    try:
        reader.ping()
        return True
    except Exception:
        return False
    finally:
        reader.close()


def require_neo4j(config: GraphConfig | None = None) -> GraphConfig:
    """The graph configuration, failing when Neo4j does not answer (the
    caller has checked that ``GRAPH_E2E`` is set)."""
    resolved = config if config is not None else GraphConfig.from_env()
    if not neo4j_reachable(resolved):
        pytest.fail(f"{GRAPH}=1 is set but Neo4j is not reachable; run `make services-up`")
    return resolved


def require_paths(*paths: Path) -> None:
    """Fail when a prerequisite of a live test is missing."""
    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        pytest.fail(
            f"{WORLD}=1 is set but {', '.join(missing)} is missing; prepare the "
            "presentation world (make generate-dev-data ingest-graph index-vector ground-bank)"
        )


def restore_presentation_graph() -> bool:
    """Ingest the presentation world (``PRESENTATION_DATASET_DIR``) again when Neo4j holds
    another one; True when it did. Nothing happens for a world that was never
    ingested (it has no statistics file to compare with)."""
    dataset_dir = Path(PRESENTATION_DATASET_DIR)
    if read_graph_stats(dataset_dir) is None:
        return False
    reader = GraphReader(require_neo4j())
    try:
        if graph_world_matches(reader, dataset_dir):
            return False
    finally:
        reader.close()
    if graph_cli.main(["--dataset", str(dataset_dir), "--wipe"]) != 0:
        pytest.fail(f"restoring the presentation graph from {dataset_dir} failed")
    return True


def graph_restored_after() -> Iterator[None]:
    """A fixture body: let the tests run, then leave Neo4j holding the
    presentation world, which tests that wipe it do not."""
    yield
    if enabled(GRAPH):
        restore_presentation_graph()
