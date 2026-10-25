"""Read-only diagnostic of what the shared re-ranker keeps (D-025).

Every pipeline hands its candidates to one shared re-ranker, which picks
what reaches the prompt. This module runs retrieval only, for every bank
instance that has claims, and counts per pipeline how many claims had a
carrier among the graph candidates, among the document candidates and among
the selected evidence. The carrier notion is the scorer's: a claim is found
by a set of ids when one of its carriers is among them, after the question's
anchor is removed (``exclude_anchor``).

Candidates and selections are read from the events each pipeline records,
the same events Live Lab shows. The generator handed to the lab refuses to
generate (:class:`NoGeneration`); the pipelines emit every candidate and
selection event before they call it, so nothing is lost. Nothing here writes
to Neo4j or the vector store, and nothing computed here reaches a pipeline.
Evaluator-only (ADR-008).
"""

from __future__ import annotations

import contextlib
import dataclasses
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from app.config import GraphConfig
from app.evaluation import official
from app.evaluation.claims import exclude_anchor, selection_carrier
from app.evaluation.grounding import BankInstance, FrozenBank, load_frozen_bank
from app.events import (
    GRAPH_CANDIDATE_DISCARDED,
    GRAPH_CANDIDATE_SELECTED,
    GRAPH_NODE_DISCOVERED,
    GRAPH_SEED_SELECTED,
    RAG_CANDIDATE_RETRIEVED,
    RAG_EVIDENCE_SELECTED,
    RetrievalEvent,
)
from app.evidence import EvidenceChunk
from app.graph.fingerprint import graph_world_matches
from app.lab import build_lab, wired_pipelines
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.generation import GenerationOutput

PIPELINES = ("A", "B", "C")
GRAPH_PIPELINES = ("B", "C")
NOT_PRESENTATION_WORLD = (
    "the live graph is not the seed {seed} dev world (its node counts differ from "
    "{path}); run make ingest-graph first. The diagnostic reads the graph and never changes it"
)


class GenerationAttempted(Exception):
    """A pipeline reached its generation step; raised by :class:`NoGeneration`."""


class NoGeneration:
    """The lab's generator for a diagnostic: it refuses, so no model is ever called."""

    model_name = "none (diagnostic)"

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        raise GenerationAttempted(question)


class Retriever(Protocol):
    """What the diagnostic needs of a pipeline: its recorded events and a run."""

    @property
    def events(self) -> list[RetrievalEvent]: ...

    def run(self, question: str) -> object: ...


@dataclass(frozen=True, slots=True)
class Candidates:
    """The carrier ids one pipeline run found and selected, by channel."""

    graph: frozenset[str]
    documents: frozenset[str]
    selected: frozenset[str]


@dataclass(frozen=True, slots=True)
class DroppedClaim:
    """A claim the graph found a carrier of and the re-ranker did not select."""

    instance_id: str
    pipeline: str
    claim_id: str
    graph_carriers: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PipelineCounts:
    """Claim counts of one pipeline over one instance (or a sum of them)."""

    instances: int = 0
    claims: int = 0
    graph_found: int = 0
    document_found: int = 0
    selected: int = 0

    def __add__(self, other: PipelineCounts) -> PipelineCounts:
        return PipelineCounts(
            *(a + b for a, b in zip(self._values(), other._values(), strict=True))
        )

    def _values(self) -> tuple[int, ...]:
        return (self.instances, self.claims, self.graph_found, self.document_found, self.selected)


@dataclass(frozen=True, slots=True)
class SelectionDiagnostic:
    """Per stratum and pipeline counts, and every dropped claim."""

    world_seed: int
    bank_hash: str
    counts: dict[str, dict[str, PipelineCounts]]
    dropped: list[DroppedClaim]

    def totals(self) -> dict[str, PipelineCounts]:
        return {
            tag: sum((by_tag[tag] for by_tag in self.counts.values()), PipelineCounts())
            for tag in PIPELINES
        }

    def to_payload(self) -> dict[str, Any]:
        return {
            "world_seed": self.world_seed,
            "bank_hash": self.bank_hash,
            "strata": {
                stratum: {tag: dataclasses.asdict(c) for tag, c in by_tag.items()}
                for stratum, by_tag in self.counts.items()
            },
            "totals": {tag: dataclasses.asdict(c) for tag, c in self.totals().items()},
            "dropped": [dataclasses.asdict(d) for d in self.dropped],
        }


def read_candidates(
    tag: str, events: Sequence[RetrievalEvent], corpus: Mapping[str, CorpusChunk]
) -> Candidates:
    """Carrier ids from one run's events.

    Graph candidates are the seeds and every node the traversal discovered
    (B and C). Document candidates are the chunk ids of the document channel:
    A's retrieved candidates, and for B and C the selected and discarded
    chunks, which include the record blocks superseded by their nodes.
    Selected evidence is A's selected chunks, or B's and C's selected nodes
    and chunks. A chunk id becomes its carrier through the corpus, as the
    runner's ``selection_carrier`` does for the shown blocks.
    """

    def carrier(chunk_id: str) -> str:
        chunk = corpus[chunk_id]
        return selection_carrier(chunk.kind, chunk.chunk_id, chunk.document_id)

    graph: set[str] = set()
    documents: set[str] = set()
    selected: set[str] = set()
    for event in events:
        payload = event.payload
        kind = event.event_type
        if kind in (GRAPH_SEED_SELECTED, GRAPH_NODE_DISCOVERED):
            graph.add(str(payload["node_id"]))
        elif kind == RAG_CANDIDATE_RETRIEVED:
            documents.add(carrier(str(payload["chunk_id"])))
        elif kind == RAG_EVIDENCE_SELECTED:
            selected.add(carrier(str(payload["chunk_id"])))
        elif kind in (GRAPH_CANDIDATE_SELECTED, GRAPH_CANDIDATE_DISCARDED):
            if "chunk_id" in payload:
                documents.add(carrier(str(payload["chunk_id"])))
                if kind == GRAPH_CANDIDATE_SELECTED:
                    selected.add(carrier(str(payload["chunk_id"])))
            elif kind == GRAPH_CANDIDATE_SELECTED:
                selected.add(str(payload["node_id"]))
    return Candidates(
        graph=frozenset(graph) if tag in GRAPH_PIPELINES else frozenset(),
        documents=frozenset(documents),
        selected=frozenset(selected),
    )


def diagnose(
    bank: FrozenBank,
    pipelines: Mapping[str, Retriever],
    corpus: Mapping[str, CorpusChunk],
) -> SelectionDiagnostic:
    """Run retrieval for every instance with claims and count what is kept.

    A run ends at the generator, which refuses (:class:`GenerationAttempted`);
    any other exception is a real failure and propagates.
    """
    counts: dict[str, dict[str, PipelineCounts]] = {}
    dropped: list[DroppedClaim] = []
    for instance in bank.instances:
        claims = exclude_anchor(instance.claims, instance.anchor_id)
        if not claims:
            continue
        by_tag = counts.setdefault(instance.stratum, {tag: PipelineCounts() for tag in PIPELINES})
        for tag, pipeline in pipelines.items():
            found = _retrieve(tag, pipeline, instance, corpus)
            by_tag[tag] += PipelineCounts(
                instances=1,
                claims=len(claims),
                graph_found=sum(1 for c in claims if not c.carriers.isdisjoint(found.graph)),
                document_found=sum(1 for c in claims if not c.carriers.isdisjoint(found.documents)),
                selected=sum(1 for c in claims if not c.carriers.isdisjoint(found.selected)),
            )
            dropped.extend(
                DroppedClaim(
                    instance.instance_id,
                    tag,
                    claim.claim_id,
                    tuple(sorted(claim.carriers & found.graph)),
                )
                for claim in claims
                if not claim.carriers.isdisjoint(found.graph)
                and claim.carriers.isdisjoint(found.selected)
            )
    return SelectionDiagnostic(bank.world_seed, bank.bank_hash, counts, dropped)


def _retrieve(
    tag: str, pipeline: Retriever, instance: BankInstance, corpus: Mapping[str, CorpusChunk]
) -> Candidates:
    pipeline.events.clear()
    with contextlib.suppress(GenerationAttempted):
        pipeline.run(instance.text)
    return read_candidates(tag, pipeline.events, corpus)


def render_markdown(diagnostic: SelectionDiagnostic) -> str:
    """A table per stratum and pipeline, the totals, and the dropped claims."""
    lines = [
        "# What the shared re-ranker keeps",
        "",
        f"World seed {diagnostic.world_seed}, bank hash `{diagnostic.bank_hash}`.",
        "Counts are claims, after the question's anchor is removed, as the scorer counts them.",
        "A claim is found by a set of records when one of its carriers is in the set.",
        "Graph columns apply to B and C only.",
        "",
    ]
    for stratum, by_tag in [*diagnostic.counts.items(), ("Total", diagnostic.totals())]:
        lines += [f"## {stratum}", "", _HEADER, _RULE]
        lines += [_row(tag, by_tag[tag]) for tag in PIPELINES]
        lines.append("")
    lines += ["## Found by the graph and not selected", ""]
    if not diagnostic.dropped:
        lines += ["None.", ""]
    for drop in diagnostic.dropped:
        carriers = ", ".join(f"`{c}`" for c in drop.graph_carriers)
        lines.append(
            f"- Pipeline {drop.pipeline}, instance `{drop.instance_id}`, "
            f"claim `{drop.claim_id}`: graph found {carriers}."
        )
    return "\n".join(lines).rstrip("\n") + "\n"


_HEADER = (
    "| Pipeline | Instances | Claims expected | Found by the graph "
    "| Found by the documents | Selected |"
)
_RULE = "|---|---|---|---|---|---|"


def _row(tag: str, counts: PipelineCounts) -> str:
    graph = str(counts.graph_found) if tag in GRAPH_PIPELINES else "-"
    return (
        f"| {tag} | {counts.instances} | {counts.claims} | {graph} "
        f"| {counts.document_found} | {counts.selected} |"
    )


def write_diagnostic(diagnostic: SelectionDiagnostic, out_dir: Path) -> Path:
    """``selection.json`` and ``selection.md`` in a new ``out_dir``."""
    out_dir.mkdir(parents=True, exist_ok=False)
    payload = json.dumps(diagnostic.to_payload(), indent=2, ensure_ascii=False) + "\n"
    (out_dir / "selection.json").write_text(payload, encoding="utf-8")
    (out_dir / "selection.md").write_text(render_markdown(diagnostic), encoding="utf-8")
    return out_dir


def diagnostics_dir(now: datetime | None = None) -> Path:
    """``data/evaluation/diagnostics/<UTC time>-selection``."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    return official.DATA_DIR / "evaluation" / "diagnostics" / f"{moment:%Y%m%dT%H%M%SZ}-selection"


def run_selection_diagnostic(out_dir: Path | None = None) -> Path:
    """The diagnostic of the seed 2026 dev world, written to ``out_dir``.

    Refuses (:class:`official.NotDevWorld`) unless the presentation world is
    the dev world with a current bank, and unless the live graph's label
    counts equal that world's ingestion statistics (D-037).
    """
    if not official.on_dev_world() or not official.bank_matches_active_world():
        raise official.NotDevWorld(official.DEV_ONLY_MESSAGE)
    paths = official.world_paths(official.PRESENTATION_SEED)
    bank = load_frozen_bank(paths.bank_path)
    lab = build_lab(official.world_settings(paths), NoGeneration())
    wired = wired_pipelines(lab, GraphConfig.from_env())
    try:
        if graph_world_matches(wired.reader, paths.world_dir) is not True:
            raise official.NotDevWorld(
                NOT_PRESENTATION_WORLD.format(seed=bank.world_seed, path=paths.world_dir)
            )
        pipelines: dict[str, Retriever] = {"A": lab.pipeline_a(), **dict(wired.pipelines)}
        diagnostic = diagnose(bank, pipelines, lab.corpus)
    finally:
        wired.reader.close()
    return write_diagnostic(diagnostic, out_dir or diagnostics_dir())
