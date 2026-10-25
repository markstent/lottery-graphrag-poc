"""Read-only diagnostic of what the shared re-ranker keeps (D-025, D-081).

Every pipeline hands its candidates to one shared re-ranker, which orders
them; the slots and the graph share then pick what reaches the prompt. This
module runs retrieval only, for every bank instance that has claims, and counts
per pipeline how many claims had a carrier among the graph candidates, among the
document candidates and among the selected evidence. The carrier notion is the
scorer's: a claim is found by a set of ids when one of its carriers is among
them, after the question's anchor is removed (``exclude_anchor``).

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
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from app.config import SELECTION_RULE, GraphConfig
from app.evaluation import official
from app.evaluation.bank import STRATA
from app.evaluation.claims import exclude_anchor, selection_carrier
from app.evaluation.grounding import BankInstance, FrozenBank, GroundingError, load_frozen_bank
from app.evaluation.runner import check_bank
from app.events import (
    GRAPH_CANDIDATE_DISCARDED,
    GRAPH_CANDIDATE_RERANKED,
    GRAPH_CANDIDATE_SELECTED,
    GRAPH_NODE_DISCOVERED,
    GRAPH_SEED_SELECTED,
    RAG_CANDIDATE_RETRIEVED,
    RAG_EVIDENCE_SELECTED,
    RetrievalEvent,
)
from app.evidence import EvidenceChunk
from app.graph.fingerprint import graph_world_matches
from app.lab import Lab, build_lab, wired_pipelines
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.generation import GenerationOutput
from app.retrieval.standard.index import collection_exists

PIPELINES = ("A", "B", "C")
GRAPH_PIPELINES = ("B", "C")
PIPELINE_NAMES = {
    "A": "documents only",
    "B": "documents and the graph",
    "C": "documents, the graph and the ontology",
}
EXCLUDED_LABEL = "excluded_label"
NOT_PRESENTATION_WORLD = (
    "the live graph is not the seed {seed} dev world (its node counts differ from "
    "{path}); run make ingest-graph first. The diagnostic reads the graph and never changes it"
)
NO_INDEX = (
    "the vector index {collection} does not exist or is empty; run make index-vector first. "
    "The diagnostic never builds an index"
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
class Fate:
    """What the re-ranker and the context budget did with one graph node."""

    reason: str | None  # the discard reason, or None when it was selected
    rerank_score: float | None
    rank: int | None


@dataclass(frozen=True, slots=True)
class Candidates:
    """The carrier ids one pipeline run found and selected, by channel.

    ``fates`` holds each graph node's outcome (B and C only).
    """

    graph: frozenset[str]
    documents: frozenset[str]
    selected: frozenset[str]
    fates: Mapping[str, Fate] = dataclasses.field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class DroppedCarrier:
    """One record the graph found for a claim, and why it did not reach the prompt."""

    carrier: str
    reason: str | None
    rerank_score: float | None
    rank: int | None


@dataclass(frozen=True, slots=True)
class DroppedClaim:
    """A claim the graph found a carrier of and no selected record states."""

    instance_id: str
    pipeline: str
    claim_id: str
    carriers: tuple[DroppedCarrier, ...]
    selected_count: int

    @property
    def reason(self) -> str:
        """The reason of the best-ranked carrier, the one closest to being kept."""
        best = min(self.carriers, key=lambda c: (c.rank is None, c.rank or 0, c.carrier))
        return best.reason or "not judged"


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
    """Per stratum and pipeline counts, every dropped claim, and the settings used."""

    world_seed: int
    bank_hash: str
    counts: dict[str, dict[str, PipelineCounts]]
    dropped: list[DroppedClaim]
    settings: Mapping[str, Any] = dataclasses.field(default_factory=dict)

    def totals(self) -> dict[str, PipelineCounts]:
        return {
            tag: sum((by_tag[tag] for by_tag in self.counts.values()), PipelineCounts())
            for tag in PIPELINES
        }

    def dropped_by_reason(self) -> dict[str, Counter[str]]:
        """Per graph pipeline, how many dropped claims each reason accounts for."""
        return {
            tag: Counter(d.reason for d in self.dropped if d.pipeline == tag)
            for tag in GRAPH_PIPELINES
        }

    def to_payload(self) -> dict[str, Any]:
        return {
            "world_seed": self.world_seed,
            "bank_hash": self.bank_hash,
            "settings": dict(self.settings),
            "strata": {
                stratum: {tag: dataclasses.asdict(c) for tag, c in by_tag.items()}
                for stratum, by_tag in self.counts.items()
            },
            "totals": {tag: dataclasses.asdict(c) for tag, c in self.totals().items()},
            "dropped_by_reason": {
                tag: dict(counter) for tag, counter in self.dropped_by_reason().items()
            },
            "dropped": [{**dataclasses.asdict(d), "reason": d.reason} for d in self.dropped],
        }


def read_candidates(
    tag: str, events: Sequence[RetrievalEvent], corpus: Mapping[str, CorpusChunk]
) -> Candidates:
    """Carrier ids from one run's events.

    Graph candidates are the seeds and every node the traversal discovered
    (B and C), less the nodes of an excluded label, which are never offered to
    the re-ranker. Document candidates are the chunk ids of the document
    channel: A's retrieved candidates, and for B and C the selected and
    discarded chunks, which include the record blocks superseded by their
    nodes. Selected evidence is A's selected chunks, or B's and C's selected
    nodes and chunks. A chunk id becomes its carrier through the corpus, as
    the runner's ``selection_carrier`` does for the shown blocks.
    """

    def carrier(chunk_id: str) -> str:
        chunk = corpus[chunk_id]
        return selection_carrier(chunk.kind, chunk.chunk_id, chunk.document_id)

    graph: set[str] = set()
    documents: set[str] = set()
    selected: set[str] = set()
    reasons: dict[str, str] = {}
    scores: dict[str, float | None] = {}
    ranks: dict[str, int] = {}
    for event in events:
        payload = event.payload
        kind = event.event_type
        if kind in (GRAPH_SEED_SELECTED, GRAPH_NODE_DISCOVERED):
            graph.add(str(payload["node_id"]))
        elif kind == RAG_CANDIDATE_RETRIEVED:
            documents.add(carrier(str(payload["chunk_id"])))
        elif kind == RAG_EVIDENCE_SELECTED:
            selected.add(carrier(str(payload["chunk_id"])))
        elif kind == GRAPH_CANDIDATE_RERANKED:
            ranks[str(payload["candidate_id"])] = int(str(payload["rank"]))
        elif kind in (GRAPH_CANDIDATE_SELECTED, GRAPH_CANDIDATE_DISCARDED):
            discarded = kind == GRAPH_CANDIDATE_DISCARDED
            if "chunk_id" in payload:
                documents.add(carrier(str(payload["chunk_id"])))
                if not discarded:
                    selected.add(carrier(str(payload["chunk_id"])))
                continue
            node_id = str(payload["node_id"])
            score = payload.get("rerank_score")
            scores[node_id] = None if score is None else float(score)
            if discarded:
                reasons[node_id] = str(payload["reason"])
            else:
                selected.add(node_id)
    graph -= {node for node, reason in reasons.items() if reason == EXCLUDED_LABEL}
    fates = {
        node: Fate(reasons.get(node), scores.get(node), ranks.get(node)) for node in sorted(graph)
    }
    return Candidates(
        graph=frozenset(graph) if tag in GRAPH_PIPELINES else frozenset(),
        documents=frozenset(documents),
        selected=frozenset(selected),
        fates=fates if tag in GRAPH_PIPELINES else {},
    )


def diagnose(
    bank: FrozenBank,
    pipelines: Mapping[str, Retriever],
    corpus: Mapping[str, CorpusChunk],
    settings: Mapping[str, Any] | None = None,
) -> SelectionDiagnostic:
    """Run retrieval for every instance with claims and count what is kept.

    A run ends at the generator, which refuses (:class:`GenerationAttempted`);
    any other exception is a real failure and propagates. ``settings`` is
    recorded in the output as given.
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
                    tuple(
                        DroppedCarrier(node, *dataclasses.astuple(found.fates[node]))
                        for node in sorted(claim.carriers & found.graph)
                    ),
                    len(found.selected),
                )
                for claim in claims
                if not claim.carriers.isdisjoint(found.graph)
                and claim.carriers.isdisjoint(found.selected)
            )
    return SelectionDiagnostic(bank.world_seed, bank.bank_hash, counts, dropped, settings or {})


def _retrieve(
    tag: str, pipeline: Retriever, instance: BankInstance, corpus: Mapping[str, CorpusChunk]
) -> Candidates:
    pipeline.events.clear()
    with contextlib.suppress(GenerationAttempted):
        pipeline.run(instance.text)
    return read_candidates(tag, pipeline.events, corpus)


GLOSSARY = (
    "A claim is one fact a correct answer states.",
    "A claim counts as found when at least one record or passage that states it is in the set.",
    "The record the question itself names is left out, as the scorer leaves it out.",
    "This diagnostic runs the search, the graph walk and the re-ranker, and stops before the "
    "language model writes an answer.",
    "The re-ranker orders every candidate; the slots, with a share of them kept for the graph's "
    "own selection in B and C, decide what reaches the prompt.",
)
COLUMNS = (
    "| Approach | Questions | Claims to find | Found by the graph "
    "| Found by the documents | In the prompt |"
)


def render_markdown(diagnostic: SelectionDiagnostic) -> str:
    """A table per stratum, the totals, why graph finds were dropped, and the settings."""
    lines = [
        "# What the shared re-ranker keeps",
        "",
        f"World seed {diagnostic.world_seed}, bank hash `{diagnostic.bank_hash}`.",
        *GLOSSARY,
        "",
        "Approaches:",
        *(f"- {tag}: {PIPELINE_NAMES[tag]}." for tag in PIPELINES),
        "The graph column is empty for A, which has no graph.",
        "",
    ]
    for stratum, by_tag in [*diagnostic.counts.items(), ("Total", diagnostic.totals())]:
        name = STRATA.get(stratum)
        lines += [f"## {stratum}" + (f": {name}" if name else ""), "", COLUMNS, _RULE]
        lines += [_row(tag, by_tag[tag]) for tag in PIPELINES]
        lines.append("")
    lines += ["## Found by the graph and left out of the prompt", ""]
    if not diagnostic.dropped:
        lines += ["None.", ""]
    else:
        lines += [
            "Reasons: `slot_limit` means the slots for its kind were full,",
            "`context_budget` means the token budget was full,",
            "`duplicate` means a near copy was already kept,",
            "and `not judged` means the record was not offered to the re-ranker.",
            "The score is the re-ranker's relevance score and rank 1 is its best candidate.",
            "",
        ]
        for tag, counter in diagnostic.dropped_by_reason().items():
            summary = ", ".join(f"{reason} {n}" for reason, n in sorted(counter.items()))
            lines.append(f"- Approach {tag}: {sum(counter.values())} claims ({summary or 'none'}).")
        lines.append("")
    for drop in diagnostic.dropped:
        carriers = "; ".join(
            f"`{c.carrier}` (reason {c.reason or 'not judged'}, score {_number(c.rerank_score)}, "
            f"rank {c.rank if c.rank is not None else 'none'})"
            for c in drop.carriers
        )
        lines.append(
            f"- Approach {drop.pipeline}, question `{drop.instance_id}`, claim `{drop.claim_id}`: "
            f"the graph found {carriers}; records in the prompt: {drop.selected_count}."
        )
    if diagnostic.settings:
        lines += ["", "## Settings used", ""]
        lines += [f"- {key}: {value}" for key, value in diagnostic.settings.items()]
    return "\n".join(lines).rstrip("\n") + "\n"


_RULE = "|---|---|---|---|---|---|"


def _number(value: float | None) -> str:
    return "none" if value is None else f"{value:.3f}"


def _row(tag: str, counts: PipelineCounts) -> str:
    graph = str(counts.graph_found) if tag in GRAPH_PIPELINES else "-"
    return (
        f"| {tag}: {PIPELINE_NAMES[tag]} | {counts.instances} | {counts.claims} | {graph} "
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


def settings_record(lab: Lab, node_count: int) -> dict[str, Any]:
    """The retrieval settings the numbers were produced under."""
    settings = lab.settings
    return {
        "reranker": lab.reranker.model_name,
        "embedding_model": lab.embeddings.model_name,
        "sparse_model": lab.sparse.model_name,
        "record_serialiser_version": lab.record_serialiser_version,
        "top_k": settings.top_k,
        "context_budget_tokens": settings.context.budget_tokens,
        "evidence_slots": settings.context.evidence_slots,
        "graph_slots": settings.context.graph_slots,
        "selection_rule": SELECTION_RULE,
        "graph_depth": settings.graph.max_depth,
        "graph_nodes_per_hop": settings.graph.max_nodes_per_hop,
        "graph_edges_per_node_type": settings.graph.max_edges_per_node_type,
        "graph_total_nodes": settings.graph.max_total_nodes,
        "graph_excluded_labels": list(settings.graph.excluded_labels),
        "live_graph_nodes": node_count,
    }


def check_index(bank: FrozenBank, world_dir: Path, lab: Lab) -> None:
    """Refuse what the benchmark runner refuses (:func:`check_bank`), and an
    index that does not hold the whole corpus, which would read as the
    re-ranker's doing."""
    check_bank(bank, world_dir, lab)
    points = lab.store.count()
    if points != len(lab.corpus):
        raise GroundingError(
            f"the vector index holds {points} points but the corpus has {len(lab.corpus)}; "
            "run make index-vector first"
        )


def run_selection_diagnostic(out_dir: Path | None = None) -> Path:
    """The diagnostic of the seed 2026 dev world, written to ``out_dir``.

    Refuses (:class:`official.NotDevWorld`) unless the presentation world is
    the dev world with a current bank, and unless the live graph's label
    counts equal that world's ingestion statistics (D-037). It also refuses,
    before the lab can create one, when the vector collection is missing or
    empty. Settings are the official run's (depth :data:`official.OFFICIAL_DEPTH`).
    """
    if not official.on_dev_world() or not official.bank_matches_active_world():
        raise official.NotDevWorld(official.DEV_ONLY_MESSAGE)
    paths = official.world_paths(official.PRESENTATION_SEED)
    bank = load_frozen_bank(paths.bank_path)
    settings = official.world_settings(paths, official.OFFICIAL_DEPTH)
    if not collection_exists(settings):
        raise GroundingError(NO_INDEX.format(collection=paths.collection))
    lab = build_lab(settings, NoGeneration())
    check_index(bank, paths.world_dir, lab)
    wired = wired_pipelines(lab, GraphConfig.from_env())
    try:
        if graph_world_matches(wired.reader, paths.world_dir) is not True:
            raise official.NotDevWorld(
                NOT_PRESENTATION_WORLD.format(seed=bank.world_seed, path=paths.world_dir)
            )
        nodes = sum(wired.reader.label_counts().values())
        pipelines: dict[str, Retriever] = {"A": lab.pipeline_a(), **dict(wired.pipelines)}
        diagnostic = diagnose(bank, pipelines, lab.corpus, settings_record(lab, nodes))
    finally:
        wired.reader.close()
    return write_diagnostic(diagnostic, out_dir or diagnostics_dir())
