"""The Live Lab's run fixtures, made by the real pipelines on the tiny world.

``frontend/src/run/fixtures/run-abc.json``, ``run-adhoc.json`` and
``run-cancelled.json`` are runs of A, B and C through the API, over the tiny
generated world (seed 42): its indexed corpus, Parquet records and graph
rows, with the hashing embedders, the lexical judge and the fake generator,
so they need no service and every selection, discard and budget in them is
the one the code made. The cancelled run is a real cancel: B is held in its
first graph lookup, the run is cancelled, then the lookup is let go.

Rewrite them from backend/ with
    uv run python -m tests.test_run_fixtures
then run prettier --write on them in frontend/. The test below checks the
committed run-abc.json still matches what the pipelines do, apart from
wall-clock values.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast
from unittest import mock

import app.api.runs as runs_module
from app.api.event_schemas import RecordedEvent
from app.config import GraphConfig
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.events import EventSink
from app.lab import Lab, WiredGraphPipelines, graph_pipelines
from app.main import create_app
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.graph.resolution import IdEntityResolver, TermEntityResolver
from app.retrieval.graph.traversal import NeighbourProvider
from fastapi.testclient import TestClient

from tests.helpers import GRAPH, SlowNeighbours, await_finished, wait_idle, wait_until
from tests.test_graph_stages import tiny_world_parts

FIXTURE_DIR = Path(__file__).parents[2] / "frontend" / "src" / "run" / "fixtures"
CONFIGURATIONS = ["A", "B", "C"]
# Incidents INC_021 (United Kingdom) and INC_022 (Greece) share platform
# version PLV_IDENTITY_2 in the tiny world.
QUESTION = "Which other markets had incidents on the same platform version as incident INC_021?"
# A question typed in Live Lab rather than taken from the bank.
ADHOC_QUESTION = "Which other markets had an incident on platform version PLV_APP_IOS_1?"
# Values that depend on the clock or the run, never on the pipelines.
WALL_CLOCK_EVENT_KEYS = frozenset({"event_id", "timestamp", "run_id", "t_ms"})
WALL_CLOCK_PAYLOAD_KEYS = frozenset({"latency_ms"})


class _NoReader:
    """Stands in for the Neo4j reader the run worker closes."""

    def close(self) -> None:
        pass


@contextmanager
def _api(
    lab: Lab, graph: NeighbourProvider, ids: IdEntityResolver, terms: TermEntityResolver
) -> Iterator[TestClient]:
    """The API with B and C wired over ``graph`` and the tiny world's
    resolvers, and its run store in a scratch directory."""

    def wire(
        wired_lab: Lab, graph_config: GraphConfig, sink: EventSink | None = None
    ) -> WiredGraphPipelines:
        del graph_config
        return WiredGraphPipelines(
            reader=cast(GraphReader, _NoReader()),
            pipelines=graph_pipelines(wired_lab, graph, ids, terms, sink=sink),
        )

    with (
        tempfile.TemporaryDirectory() as scratch,
        mock.patch.dict(os.environ, {"APP_DB_PATH": str(Path(scratch) / "runs.db")}),
        mock.patch.object(runs_module, "wired_pipelines", wire),
        TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as client,
    ):
        yield client
        wait_idle(client)


def capture(dataset_dir: Path, question: str, cancel: bool = False) -> dict[str, Any]:
    """One run of A, B and C as the Live Lab fixtures hold it: the request,
    the stored results and every stored event."""
    lab, provider, ids, terms = tiny_world_parts(dataset_dir)
    release = threading.Event()
    graph: NeighbourProvider = SlowNeighbours(provider, release) if cancel else provider
    if not cancel:
        release.set()
    with _api(lab, graph, ids, terms) as client:
        response = client.post(
            "/api/v1/queries", json={"question": question, "configurations": CONFIGURATIONS}
        )
        assert response.status_code == 202, response.text
        run_id: str = response.json()["run_id"]
        if cancel:
            # B is held in its first graph lookup: cancel there, then let it go.
            wait_until(
                lambda: (
                    client.get(f"/api/v1/queries/{run_id}").json()["pipeline_status"]["B"]
                    == "running"
                )
            )
            assert client.post(f"/api/v1/queries/{run_id}/cancel").status_code == 202
            release.set()
        results = await_finished(client, run_id)
        events = client.get(f"/api/v1/queries/{run_id}/events").json()["events"]
    return {
        "run_id": run_id,
        "question": question,
        "market_scope": [],
        "configurations": CONFIGURATIONS,
        "results": results,
        "events": events,
    }


def _shape(event: dict[str, Any]) -> dict[str, Any]:
    """An event without the values the clock or the run id decide."""
    kept = {key: value for key, value in event.items() if key not in WALL_CLOCK_EVENT_KEYS}
    kept["payload"] = {
        key: value for key, value in event["payload"].items() if key not in WALL_CLOCK_PAYLOAD_KEYS
    }
    return kept


def test_the_committed_live_run_is_what_the_pipelines_do(tiny_dataset: Path) -> None:
    committed = json.loads((FIXTURE_DIR / "run-abc.json").read_text(encoding="utf-8"))
    for event in committed["events"]:
        RecordedEvent.model_validate(event)
    fresh = capture(tiny_dataset, QUESTION)
    assert [_shape(e) for e in committed["events"]] == [_shape(e) for e in fresh["events"]]
    assert committed["results"]["status"] == "completed"


def test_the_committed_cancelled_run_was_cancelled_in_b() -> None:
    committed = json.loads((FIXTURE_DIR / "run-cancelled.json").read_text(encoding="utf-8"))
    types = [(e["pipeline"], e["event_type"]) for e in committed["events"]]
    assert ("A", "pipeline.completed") in types
    assert ("B", "pipeline.cancelled") in types
    assert types[-1] == ("run", "run.cancelled")
    assert not any(pipeline == "C" for pipeline, _type in types)


def _write(name: str, run: dict[str, Any]) -> None:
    (FIXTURE_DIR / name).write_text(json.dumps(run, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as directory:
        world = build_world(GenerationConfig(profile="tiny", world_seed=42))
        write_world(Path(directory), TABLE_SCHEMAS, world.tables)
        _write("run-abc.json", capture(Path(directory), QUESTION))
        _write("run-adhoc.json", capture(Path(directory), ADHOC_QUESTION))
        _write("run-cancelled.json", capture(Path(directory), QUESTION, cancel=True))
