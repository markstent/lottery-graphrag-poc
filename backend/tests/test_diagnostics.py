"""The D-025 selection diagnostic: counts, the dropped list, the refusals and
the output files. Everything runs on fakes; no graph, store or model is used."""

from __future__ import annotations

import dataclasses
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import pytest
from app.evaluation import diagnostics, official
from app.evaluation.checks import TokenCheck
from app.evaluation.claims import Claim
from app.evaluation.diagnostics import (
    GenerationAttempted,
    NoGeneration,
    Retriever,
    SelectionDiagnostic,
    diagnose,
    diagnostics_dir,
    read_candidates,
    render_markdown,
    write_diagnostic,
)
from app.evaluation.grounding import BankInstance, FrozenBank
from app.events import (
    GRAPH_CANDIDATE_DISCARDED,
    GRAPH_CANDIDATE_SELECTED,
    GRAPH_NODE_DISCOVERED,
    GRAPH_SEED_SELECTED,
    RAG_CANDIDATE_RETRIEVED,
    RAG_EVIDENCE_SELECTED,
    RetrievalEvent,
)
from app.lab import graph_pipelines
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.graph.resolution import StaticEntityResolver
from app.retrieval.standard.corpus import CorpusChunk

from tests.test_benchmark_runner import INCIDENT, indexed_lab
from tests.test_graph_rag import build_corpus, resolved, scn007_adjacency

ANCHOR = "INC_S007_GR"


def event(event_type: str, **payload: object) -> RetrievalEvent:
    return RetrievalEvent(event_type, "X", 0.0, "e", "t", payload)  # type: ignore[arg-type]


def chunk(chunk_id: str, document_id: str, kind: str = "chunk") -> CorpusChunk:
    return dataclasses.replace(
        next(iter(build_corpus().values())), chunk_id=chunk_id, document_id=document_id, kind=kind
    )


CORPUS = {
    "CH1": chunk("CH1", "DOC1"),
    "BLK_INC9": chunk("BLK_INC9", "INC_9", kind="record"),
}


class FakePipeline:
    """Records the scripted events, then reaches the refusing generator."""

    def __init__(self, scripted: list[RetrievalEvent]) -> None:
        self.events: list[RetrievalEvent] = []
        self.scripted = scripted
        self.runs = 0

    def run(self, question: str) -> object:
        self.runs += 1
        self.events.extend(self.scripted)
        raise GenerationAttempted(question)


def instance(claims: tuple[Claim, ...], stratum: str = "H2") -> BankInstance:
    return BankInstance(
        instance_id="L05-2026-X",
        question_id="L05",
        stratum=stratum,
        sub_stratum=None,
        ontology_dependent=False,
        world_seed=2026,
        anchor_id=ANCHOR,
        text="a question",
        expected_answer="an answer",
        checks=(TokenCheck("x"),),
        claims=claims,
    )


def bank_of(*instances: BankInstance) -> FrozenBank:
    return FrozenBank(
        bank_version="2.0.0",
        world_seed=2026,
        world_manifest_hash="m",
        record_serialiser_version="s",
        ledger_hash="l",
        instances=instances,
        unavailable=(),
        bank_hash="bank-hash",
    )


GRAPH_EVENTS = [
    event(GRAPH_SEED_SELECTED, node_id=ANCHOR),
    event(GRAPH_NODE_DISCOVERED, node_id="CLM_1", node_label="Claim", hop=1),
    event(GRAPH_NODE_DISCOVERED, node_id="CLM_2", node_label="Claim", hop=1),
    event(GRAPH_CANDIDATE_SELECTED, node_id="CLM_2", score=1.0),
    event(GRAPH_CANDIDATE_DISCARDED, node_id="CLM_1", score=0.5, reason="below_threshold"),
    event(GRAPH_CANDIDATE_DISCARDED, chunk_id="CH1", rerank_score=0.1, reason="budget"),
]
A_EVENTS = [
    event(RAG_CANDIDATE_RETRIEVED, chunk_id="BLK_INC9", document_id="INC_9", rank=1),
    event(RAG_EVIDENCE_SELECTED, chunk_id="BLK_INC9", rank=1),
]


def run_diagnose(claims: tuple[Claim, ...]) -> SelectionDiagnostic:
    pipelines = {
        "A": FakePipeline(A_EVENTS),
        "B": FakePipeline(GRAPH_EVENTS),
        "C": FakePipeline(GRAPH_EVENTS),
    }
    return diagnose(bank_of(instance(claims)), cast(dict[str, Retriever], pipelines), CORPUS)


def test_counts_carriers_found_and_selected() -> None:
    claims = (
        Claim("c1", "s", frozenset({"CLM_2", "CH1"})),  # found by graph and documents, selected
        Claim("c2", "s", frozenset({"INC_9"})),  # a record block carried by the documents
        Claim("c3", "s", frozenset({ANCHOR})),  # only the anchor: excluded like the scorer does
    )
    counts = run_diagnose(claims).counts["H2"]
    assert (counts["A"].claims, counts["A"].graph_found) == (2, 0)
    assert (counts["A"].document_found, counts["A"].selected) == (1, 1)
    assert (counts["B"].claims, counts["B"].graph_found) == (2, 1)
    assert (counts["B"].document_found, counts["B"].selected) == (1, 1)
    assert counts["C"] == counts["B"]


def test_a_chunk_is_read_as_its_carrier() -> None:
    found = read_candidates("A", A_EVENTS, CORPUS)
    assert found.documents == {"INC_9"}
    assert found.selected == {"INC_9"}
    assert read_candidates("B", GRAPH_EVENTS, CORPUS).documents == {"CH1"}


def test_dropped_list_names_instance_and_carrier() -> None:
    claims = (Claim("c1", "s", frozenset({"CLM_1"})), Claim("c2", "s", frozenset({"CLM_2"})))
    diagnostic = run_diagnose(claims)
    assert [
        (d.instance_id, d.pipeline, d.claim_id, d.graph_carriers) for d in diagnostic.dropped
    ] == [
        ("L05-2026-X", "B", "c1", ("CLM_1",)),
        ("L05-2026-X", "C", "c1", ("CLM_1",)),
    ]
    markdown = render_markdown(diagnostic)
    assert "Pipeline B, instance `L05-2026-X`, claim `c1`: graph found `CLM_1`." in markdown
    assert "| B | 1 | 2 | 2 | 0 | 1 |" in markdown
    assert "| A | 1 | 2 | - | 0 | 0 |" in markdown


def test_instances_without_claims_are_skipped() -> None:
    diagnostic = diagnose(bank_of(instance(())), {"A": cast(Retriever, FakePipeline([]))}, CORPUS)
    assert diagnostic.counts == {}
    assert render_markdown(diagnostic).count("None.") == 1


def test_never_calls_the_generator() -> None:
    with pytest.raises(GenerationAttempted):
        NoGeneration().generate("q", [])
    claims = (Claim("c1", "s", frozenset({"CLM_2"})),)
    pipeline = FakePipeline(GRAPH_EVENTS)
    diagnose(bank_of(instance(claims)), {"B": cast(Retriever, pipeline)}, CORPUS)
    assert pipeline.runs == 1  # the refusal ends the run and is contained


def test_real_pipelines_end_at_the_refusing_generator(tmp_path: Path) -> None:
    (tmp_path / "_manifest.json").write_text("{}", encoding="utf-8")
    lab = indexed_lab(
        tmp_path, generator=NoGeneration(), corpus={**build_corpus(), INCIDENT.chunk_id: INCIDENT}
    )
    graph = graph_pipelines(
        lab, scn007_adjacency(), StaticEntityResolver(resolved()), StaticEntityResolver(resolved())
    )
    pipelines = {"A": lab.pipeline_a(), **dict(graph)}
    claims = (Claim("c1", "s", frozenset({"MKT_GR"})),)
    counts = diagnose(
        bank_of(instance(claims)), cast(dict[str, Retriever], pipelines), lab.corpus
    ).counts["H2"]
    assert counts["A"].graph_found == 0
    assert counts["B"].graph_found == counts["C"].graph_found == 1


def test_other_errors_are_not_swallowed() -> None:
    class Broken:
        def __init__(self) -> None:
            self.events: list[RetrievalEvent] = []

        def run(self, question: str) -> object:
            raise RuntimeError("neo4j down")

    claims = (Claim("c1", "s", frozenset({"CLM_2"})),)
    with pytest.raises(RuntimeError, match="neo4j down"):
        diagnose(bank_of(instance(claims)), {"B": cast(Retriever, Broken())}, CORPUS)


def test_writes_json_and_markdown(tmp_path: Path) -> None:
    claims = (Claim("c1", "s", frozenset({"CLM_1"})),)
    out = write_diagnostic(run_diagnose(claims), tmp_path / "x-selection")
    payload = json.loads((out / "selection.json").read_text("utf-8"))
    assert payload["totals"]["B"]["graph_found"] == 1
    assert payload["dropped"][0]["claim_id"] == "c1"
    assert (out / "selection.md").read_text("utf-8").startswith("# What the shared re-ranker keeps")
    assert diagnostics_dir(datetime(2026, 10, 25, 9, 8, 7, tzinfo=UTC)).name == (
        "20261025T090807Z-selection"
    )


class Counts:
    def __init__(self, counts: dict[str, int]) -> None:
        self.counts = counts
        self.closed = False

    def label_counts(self) -> dict[str, int]:
        return self.counts

    def close(self) -> None:
        self.closed = True


def test_refuses_when_graph_is_not_the_presentation_world(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "_graph_stats.json").write_text(json.dumps({"nodes": {"Player": 3}}), "utf-8")
    reader = Counts({"Player": 4})
    paths = official.WorldPaths(
        2026, tmp_path, tmp_path / "ledger.json", tmp_path / "bank.json", "c"
    )
    monkeypatch.setattr(official, "on_dev_world", lambda: True)
    monkeypatch.setattr(official, "bank_matches_active_world", lambda: True)
    monkeypatch.setattr(official, "world_paths", lambda seed: paths)
    monkeypatch.setattr(official, "world_settings", lambda p: None)
    monkeypatch.setattr(diagnostics, "load_frozen_bank", lambda p: bank_of())
    monkeypatch.setattr(diagnostics, "build_lab", lambda settings, generator: None)
    monkeypatch.setattr(
        diagnostics,
        "wired_pipelines",
        lambda lab, config: type("W", (), {"reader": cast(GraphReader, reader), "pipelines": []})(),
    )
    with pytest.raises(official.NotDevWorld, match="not the seed 2026 dev world"):
        diagnostics.run_selection_diagnostic(tmp_path / "out")
    assert reader.closed
    assert not (tmp_path / "out").exists()


def test_refuses_off_the_dev_world(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(official, "on_dev_world", lambda: False)
    with pytest.raises(official.NotDevWorld):
        diagnostics.run_selection_diagnostic()
