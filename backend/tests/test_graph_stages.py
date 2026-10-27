"""The graph pipeline's stages: their order, and golden event streams.

The golden streams pin the pipelines' observable behaviour over the tiny
generated world (seed 42): every event's type, pipeline and payload in
order, and every result field. They were captured from the pre-stage
implementation of ``GraphRagPipeline.run``; regenerate them only for an
intended, reviewed behaviour change (``python -m tests.test_graph_stages``
from backend/). Event ids, timestamps, ``t_ms``, run ids and generation
latency are wall-clock values and are left out.
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq
import pytest
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS, primary_key
from app.datasets.world import build_world
from app.graph.node_rows import build_node_rows
from app.graph.reader import load_dataset
from app.graph.relationship_rows import build_relationship_rows
from app.lab import Lab, graph_pipelines
from app.retrieval.graph import resolution, stages
from app.retrieval.graph.neo4j_adapter import build_resolvers
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.resolution import _SEED_PREFIXES, IdEntityResolver, TermEntityResolver
from app.retrieval.graph.source_lookup import (
    RECORD_LABELS,
    SEED_ID_PREFIXES,
    SourceLookup,
    record_blocks_of,
)
from app.retrieval.graph.traversal import NeighbourEdge, StaticNeighbourProvider
from app.retrieval.standard.index import index_corpus, load_indexed_corpus

from tests.conftest import build_lab_offline
from tests.test_graph_rag import build_pipeline, make_settings

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_FILES = {"B": FIXTURES / "graph_events_b.json", "C": FIXTURES / "graph_events_c.json"}
WALL_CLOCK_PAYLOAD_KEYS = frozenset({"latency_ms"})

# (stream name, pipeline, question, market scope). B's last question names
# no id and no market, so it takes the vector fallback seed.
GOLDEN_QUESTIONS: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    (
        "ids_and_terms",
        "B",
        "Which games did INC_025 affect, and was there a payment failure in Greece?",
        (),
    ),
    ("fallback_seed", "B", "Why was the draw result publication delayed?", ()),
    (
        "ids_and_terms",
        "C",
        "Which games did INC_025 affect, and was there a payment failure in Greece?",
        (),
    ),
    (
        "market_scope",
        "C",
        "Which games did INC_025 affect, and was there a payment failure in Greece?",
        ("MKT_GR",),
    ),
)


class _TinyWorldReader:
    """Node lookup and market aliases over the tiny world's node rows,
    standing in for the Neo4j reader the resolvers are built from."""

    def __init__(self, labels: dict[str, str], markets: list[dict[str, Any]]) -> None:
        self._labels = labels
        self._markets = markets

    def lookup_node(self, node_id: str) -> tuple[str, bool] | None:
        label = self._labels.get(node_id)
        return (label, True) if label is not None else None

    def markets(self) -> dict[str, str]:
        aliases: dict[str, str] = {}
        for row in self._markets:
            for name in (row["name"], row["market_code"]):
                aliases[str(name)] = str(row["id"])
        return aliases


def _provider(
    relationships: dict[tuple[str, str, str], list[dict[str, Any]]],
) -> StaticNeighbourProvider:
    """Every relationship row, indexed both ways by the provider with both
    end labels, as the undirected Neo4j match sees it."""
    adjacency: dict[str, list[NeighbourEdge]] = {}
    labels: dict[str, str] = {}
    for (rel_type, label_a, label_b), rows in relationships.items():
        for row in rows:
            a_id, b_id = str(row["a_id"]), str(row["b_id"])
            adjacency.setdefault(a_id, []).append(NeighbourEdge(a_id, rel_type, b_id, label_b))
            labels[a_id], labels[b_id] = label_a, label_b
    return StaticNeighbourProvider(adjacency, labels)


def tiny_world_pipelines(dataset_dir: Path) -> dict[str, GraphRagPipeline]:
    """B and C over the tiny world (see :func:`tiny_world_lab`)."""
    return tiny_world_lab(dataset_dir)[1]


def tiny_world_lab(
    dataset_dir: Path, **settings: object
) -> tuple[Lab, dict[str, GraphRagPipeline]]:
    """The lab (pipeline A) and B and C over the tiny world: its indexed
    corpus, Parquet source lookup, graph rows and resolvers; hashing
    embedders, the lexical judge and the fake generator, so every run is
    deterministic and offline. settings overrides the test retrieval
    settings for all three."""
    lab, provider, ids, terms = tiny_world_parts(dataset_dir, **settings)
    return lab, dict(graph_pipelines(lab, provider, ids, terms))


def tiny_world_parts(
    dataset_dir: Path, **settings: object
) -> tuple[Lab, StaticNeighbourProvider, IdEntityResolver, TermEntityResolver]:
    """What :func:`tiny_world_lab` wires B and C from: the lab, the graph
    as a neighbour provider, and the id and term resolvers."""
    tables = load_dataset(dataset_dir)
    base = build_lab_offline()
    nodes = build_node_rows(tables, base.ontology)
    labels = {str(row["id"]): label for label, rows in nodes.items() for row in rows}
    corpus = load_indexed_corpus(dataset_dir)
    lab: Lab = dataclasses.replace(
        base,
        settings=make_settings(dataset_dir=str(dataset_dir), **settings),
        corpus=corpus,
        source_lookup=SourceLookup(dataset_dir, record_blocks_of(corpus.values())),
    )
    index_corpus(lab.store, lab.embeddings, lab.sparse, list(corpus.values()))
    reader = _TinyWorldReader(labels, nodes["Market"])
    ids, terms = build_resolvers(reader, lab.ontology, lab.term_matcher)  # type: ignore[arg-type]
    return lab, _provider(build_relationship_rows(tables, lab.ontology)), ids, terms


def _plain(value: dict[str, Any]) -> dict[str, Any]:
    """``value`` as JSON would give it back, so fixtures and runs compare alike."""
    plain: dict[str, Any] = json.loads(json.dumps(value))
    return plain


def run_stream(pipeline: GraphRagPipeline, question: str, markets: Sequence[str]) -> dict[str, Any]:
    """One question's events and result, without wall-clock values."""
    start = len(pipeline.events)
    result = pipeline.run(question, list(markets) or None)
    events = [
        {
            "event_type": event.event_type,
            "pipeline": event.pipeline,
            "payload": {
                key: value
                for key, value in event.payload.items()
                if key not in WALL_CLOCK_PAYLOAD_KEYS
            },
        }
        for event in pipeline.events[start:]
    ]
    return _plain(
        {
            "question": question,
            "markets": list(markets),
            "events": events,
            "result": result.model_dump(
                mode="json", exclude={"run_id": True, "answer": {"latency_ms"}}
            ),
        }
    )


def capture(dataset_dir: Path) -> dict[str, dict[str, Any]]:
    """Every golden stream, keyed by pipeline then stream name."""
    pipelines = tiny_world_pipelines(dataset_dir)
    streams: dict[str, dict[str, Any]] = {"B": {}, "C": {}}
    for name, tag, question, markets in GOLDEN_QUESTIONS:
        streams[tag][name] = run_stream(pipelines[tag], question, markets)
    return streams


@pytest.fixture(scope="module")
def tiny_world_runs(tiny_dataset: Path) -> dict[str, dict[str, Any]]:
    return capture(tiny_dataset)


@pytest.mark.parametrize(("name", "tag"), [(name, tag) for name, tag, _q, _m in GOLDEN_QUESTIONS])
def test_event_stream_and_result_are_unchanged(
    tiny_world_runs: dict[str, dict[str, Any]], name: str, tag: str
) -> None:
    golden = json.loads(GOLDEN_FILES[tag].read_text())[name]
    actual = tiny_world_runs[tag][name]
    assert [e["event_type"] for e in actual["events"]] == [
        e["event_type"] for e in golden["events"]
    ]
    assert actual["events"] == golden["events"]
    assert actual["result"] == golden["result"]


def test_golden_streams_cover_every_path(tiny_world_runs: dict[str, dict[str, Any]]) -> None:
    """The fixtures exercise resolution by id, market and term, query and
    ontology expansion, the fallback seed, the market scope, supersession
    and both selection outcomes; a fixture that lost one would pin less."""
    events = [
        event
        for streams in tiny_world_runs.values()
        for stream in streams.values()
        for event in stream["events"]
    ]
    origins = {
        e["payload"].get("origin") for e in events if e["event_type"] == "graph.entity.resolved"
    }
    assert {"id", "market_alias", "term", "vector_fallback"} <= origins
    types = {e["event_type"] for e in events}
    assert {"graph.query.expanded", "graph.ontology.expanded"} <= types
    reasons = {
        e["payload"].get("reason") for e in events if e["event_type"] == "graph.candidate.discarded"
    }
    assert "out_of_scope_market" in reasons
    assert any(
        e["event_type"] == "graph.candidate.selected" and "node_id" in e["payload"] for e in events
    )


STAGE_ORDER = (
    "resolve",
    "traverse",
    "rank_and_scope",
    "select_and_attach",
    "document_channel",
    "assemble_and_generate",
)


def test_run_composes_the_stages_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    """``run`` is the ordered composition of the typed stages, each called once."""
    calls: list[str] = []
    for name in STAGE_ORDER:
        original = getattr(stages, name)

        def recording(*args: Any, _name: str = name, _stage: Any = original, **kwargs: Any) -> Any:
            calls.append(_name)
            return _stage(*args, **kwargs)

        monkeypatch.setattr(stages, name, recording)
    build_pipeline().run("Why did checkout fail in Greece?")
    assert calls == list(STAGE_ORDER)


def test_reverse_edge_labels_come_from_labels_then_pointing_edges() -> None:
    """A reverse edge is labelled from ``labels`` when given, else from the
    first edge pointing at its target, else ""."""
    adjacency = {
        "INC_1": [NeighbourEdge("INC_1", "AFFECTS", "GAME_1", "Game")],
        "GAME_1": [NeighbourEdge("GAME_1", "AVAILABLE_IN", "MKT_1", "Market")],
        "DOC_1": [NeighbourEdge("DOC_1", "REFERENCES", "INC_1", "Incident")],
    }

    def reverse_labels(provider: StaticNeighbourProvider) -> dict[str, str]:
        edges = provider.neighbours(
            ["GAME_1", "MKT_1", "INC_1"], ("AFFECTS", "AVAILABLE_IN", "REFERENCES"), 9, ()
        )
        return {f"{e.from_id}>{e.to_id}": e.to_label for e in edges}

    assert reverse_labels(StaticNeighbourProvider(adjacency)) == {
        "GAME_1>INC_1": "Incident",
        "GAME_1>MKT_1": "Market",
        "MKT_1>GAME_1": "Game",
        "INC_1>GAME_1": "Game",
        "INC_1>DOC_1": "",
    }
    labelled = StaticNeighbourProvider(adjacency, {"DOC_1": "Document"})
    assert reverse_labels(labelled)["INC_1>DOC_1"] == "Document"


TODAYS_SEED_PREFIXES = frozenset(
    {"INC_", "MKT_", "PLV_", "PLT_", "GAME_", "APPV_", "CMP_", "FAM_", "PLAYER_", "PAY_"}
)


def test_each_seed_prefix_is_the_prefix_of_its_tables_primary_keys(tiny_dataset: Path) -> None:
    """The seedable-table registry is the id resolver's allow-list. It holds
    exactly the approved seed prefixes, over record tables only, and each
    prefix is the one every primary key of its table carries."""
    assert set(_SEED_PREFIXES) == set(SEED_ID_PREFIXES.values()) == TODAYS_SEED_PREFIXES
    assert set(SEED_ID_PREFIXES) <= set(RECORD_LABELS)
    for table, prefix in SEED_ID_PREFIXES.items():
        ids = (
            pq.read_table(tiny_dataset / f"{table}.parquet").column(primary_key(table)).to_pylist()
        )
        assert ids and all(str(value).startswith(prefix) for value in ids), table


def test_the_registry_drives_id_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    """A token resolves when its prefix is a registry prefix and only then:
    record ids of tables outside the registry never seed."""
    seedable = {f"{prefix}X1": RECORD_LABELS[table] for table, prefix in SEED_ID_PREFIXES.items()}
    others = {"ITYPE_X1": "IncidentType", "SUP_X1": "SupportCase", "DEV_X1": "Device"}
    known = {**seedable, **others}
    resolver = IdEntityResolver(
        lookup_node=lambda node_id: (known[node_id], True) if node_id in known else None,
        market_aliases={},
    )
    question = " ".join(known)
    assert [entity.entity_id for entity in resolver.resolve(question)] == list(seedable)
    monkeypatch.setattr(resolution, "_SEED_PREFIXES", ("ITYPE_",))
    assert [entity.entity_id for entity in resolver.resolve(question)] == ["ITYPE_X1"]


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        world = build_world(GenerationConfig(profile="tiny", world_seed=42))
        write_world(Path(directory), TABLE_SCHEMAS, world.tables)
        captured = capture(Path(directory))
    for tag, path in GOLDEN_FILES.items():
        path.write_text(
            json.dumps(captured[tag], indent=1, sort_keys=True, ensure_ascii=False) + "\n"
        )
