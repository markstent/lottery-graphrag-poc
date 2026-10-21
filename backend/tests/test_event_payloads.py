"""Every event the API stores validates against its declared payload model.

Runs A, B and C offline through the real worker (the fake generator, hashing
embedders and the static SCN-007 neighbourhood), plus a cancelled and a failed
run for the lifecycle envelopes, and validates each stored event as the API
serves it. The golden graph streams add the event types the SCN-007 run does
not reach (fallback seed, market scope). An event type with no model fails.
"""

from __future__ import annotations

import dataclasses
import json
import threading
from pathlib import Path
from typing import Any, get_args

import app.api.runs as runs_module
import app.events as events_module
import pytest
from app.api.event_schemas import RecordedEvent
from app.api.runs import QueryService
from app.events.payloads import Payload
from app.lab import Lab
from app.main import create_app
from app.persistence.store import RunStore
from app.retrieval.standard.index import index_corpus
from fastapi.testclient import TestClient

from tests.conftest import build_lab_offline
from tests.test_api_runs import (
    GRAPH,
    FailingGenerator,
    SlowNeighbours,
    offline_wiring,
    pipeline_running,
    request,
    run_to_completion,
    wait_finished,
    wait_idle,
    wait_until,
)
from tests.test_graph_rag import build_corpus, scn007_adjacency

GOLDEN_DIR = Path(__file__).parent / "fixtures"
ENVELOPE = {
    "event_id": "0" * 32,
    "timestamp": "2026-01-01T10:00:00+00:00",
    "run_id": "RUN-GOLDEN",
    "t_ms": 0.0,
    "sequence": 1,
}


@pytest.fixture(scope="module")
def lab() -> Lab:
    built = build_lab_offline()
    index_corpus(built.store, built.embeddings, built.sparse, list(build_corpus().values()))
    return built


def declared_models() -> dict[str, type[Payload]]:
    """Event type to the model class that declares it, read from the union."""
    union = RecordedEvent.model_fields["root"].annotation
    members = get_args(union)
    return {get_args(m.model_fields["event_type"].annotation)[0]: m for m in members}


def validate(stored: list[dict[str, Any]]) -> set[str]:
    """Validate each stored event as the API serves it; return the types seen."""
    for event in stored:
        RecordedEvent.model_validate(event)
    return {event["event_type"] for event in stored}


def golden_events() -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for name in ("graph_events_b.json", "graph_events_c.json"):
        streams = json.loads((GOLDEN_DIR / name).read_text())
        for stream in streams.values():
            for event in stream["events"]:
                # The golden streams drop wall-clock values.
                if event["event_type"].endswith("generation.completed"):
                    event["payload"]["latency_ms"] = 0.0
                events.append({**ENVELOPE, **event})
    return events


def event_type_constants() -> set[str]:
    constants = {
        value
        for name, value in vars(events_module).items()
        if name.isupper() and isinstance(value, str) and "." in value
    }
    assert len(constants) == 36
    return constants


def test_every_event_type_constant_has_a_declared_model() -> None:
    assert set(declared_models()) == event_type_constants()


def test_an_event_type_with_no_model_is_rejected() -> None:
    unknown = {**ENVELOPE, "pipeline": "A", "event_type": "rag.invented.event", "payload": {}}
    with pytest.raises(ValueError, match=r"rag\.invented\.event"):
        RecordedEvent.model_validate(unknown)


def test_a_payload_field_without_a_model_field_is_rejected() -> None:
    drifted = {
        **ENVELOPE,
        "pipeline": "A",
        "event_type": "rag.embedding.started",
        "payload": {"model": "m", "extra_field": 1},
    }
    with pytest.raises(ValueError, match="extra_field"):
        RecordedEvent.model_validate(drifted)


def test_every_stored_event_of_a_real_run_validates_against_its_model(
    lab: Lab, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(runs_module, "wired_pipelines", offline_wiring(scn007_adjacency()))
    seen: set[str] = set()

    # A, B and C completed.
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as client:
        seen |= validate(run_to_completion(client, configurations=["A", "B", "C"])["events"])
        wait_idle(client)

    # One evidence slot: every pipeline discards, so the discard events appear.
    context = dataclasses.replace(lab.settings.context, evidence_slots=1)
    tight = dataclasses.replace(lab, settings=dataclasses.replace(lab.settings, context=context))
    with TestClient(create_app(lab_factory=lambda: tight, graph_config=GRAPH)) as client:
        seen |= validate(run_to_completion(client, configurations=["A", "B", "C"])["events"])
        wait_idle(client)

    # A pipeline failure: pipeline.failed and run.failed carry the envelope.
    failing = dataclasses.replace(lab, generator=FailingGenerator())
    with TestClient(create_app(lab_factory=lambda: failing, graph_config=GRAPH)) as client:
        failed = run_to_completion(client, configurations=["A"])["events"]
        seen |= validate(failed)
        wait_idle(client)
    assert {"pipeline.failed", "run.failed"} <= seen

    # A cancellation mid-pipeline: pipeline.cancelled and run.cancelled.
    release = threading.Event()
    slow = offline_wiring(SlowNeighbours(scn007_adjacency(), release))
    monkeypatch.setattr(runs_module, "wired_pipelines", slow)
    service = QueryService(RunStore(tmp_path / "runs.db", retention=50), lambda: lab, GRAPH)
    try:
        run_id = service.start(request(configurations=["A", "B"]))
        wait_until(lambda: pipeline_running(service, run_id, "B"))
        assert service.cancel(run_id)
        release.set()
        wait_finished(service, run_id)
        wait_until(lambda: not service._active)
        stored = [{**event, "run_id": run_id} for event in service.store.events(run_id)]
        seen |= validate(stored)
    finally:
        release.set()
        service.store.close()
    assert {"pipeline.cancelled", "run.cancelled"} <= seen

    # The golden graph streams reach the events SCN-007 does not.
    seen |= validate(golden_events())
    assert seen == event_type_constants()
