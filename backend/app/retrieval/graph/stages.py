"""The stages of the graph pipeline (docs/reference/retrieval/graph-rag.md).

``GraphRagPipeline.run`` composes them in this order:

    resolve               entity resolution, target types, query expansion
                          (C), the record-anchored vector fallback seed,
                          seed events
    traverse              bounded traversal, ontology expansion (C), the
                          stated links among reached nodes (when the
                          question names a target type)
    rank_and_scope        transparent composite score, market scope
    select_and_attach     graph relevance order (D-083), excluded labels
                          out, authoritative facts on, one structured
                          candidate per remaining node with its graph rank
                          and path
    document_channel      pipeline A's document channel, identical to A
    assemble_and_generate the shared cross-encoder over the documents only,
                          the two ranked channels interleaved into one
                          token budget (D-084), generation over the
                          selection in prompt order

Each stage takes only what it needs, emits its own events through the
pipeline's ``EventEmitter`` (``select_and_attach`` and ``document_channel``
emit none) and returns a frozen result for the next stage.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from app.config import ContextSettings, GraphRagSettings
from app.datasets.schema import TABLE_PROVENANCE
from app.events import (
    GRAPH_CANDIDATE_DISCARDED,
    GRAPH_CANDIDATE_RERANKED,
    GRAPH_CANDIDATE_SELECTED,
    GRAPH_CONTEXT_ASSEMBLED,
    GRAPH_ENTITY_RESOLUTION_STARTED,
    GRAPH_ENTITY_RESOLVED,
    GRAPH_EVIDENCE_PATH_COMPLETED,
    GRAPH_GENERATION_COMPLETED,
    GRAPH_GENERATION_STARTED,
    GRAPH_NODE_DISCOVERED,
    GRAPH_ONTOLOGY_EXPANDED,
    GRAPH_QUERY_EXPANDED,
    GRAPH_RELATIONSHIP_TRAVERSED,
    GRAPH_RERANK_STARTED,
    GRAPH_SEED_SELECTED,
    GRAPH_TARGET_TYPES_RESOLVED,
    GRAPH_TRAVERSAL_STARTED,
    EventEmitter,
)
from app.evidence import EvidenceChunk, GraphEvidence, RagAnswer
from app.ontology.model import Ontology
from app.retrieval.graph.ranking import (
    STRUCTURED_LABELS,
    ScoredNode,
    graph_relevance_order,
    score_nodes,
    semantic_scores,
)
from app.retrieval.graph.resolution import (
    CONCEPT_LABEL,
    EntityResolver,
    QueryExpansion,
    ResolvedEntity,
    TargetTypeMatcher,
    concept_text,
)
from app.retrieval.graph.source_lookup import SourceLookup, bare_node_text, label_for_table
from app.retrieval.graph.traversal import (
    NeighbourProvider,
    PathStep,
    TraversalResult,
    bounded_traversal,
    expand_ontology,
    render_path,
    with_stated_links,
)
from app.retrieval.standard.context import (
    NODE_KIND,
    SELECTION_EXCLUDED_LABEL,
    ContextAssembly,
    assemble_context,
)
from app.retrieval.standard.corpus import CorpusChunk, RecordFacts, hit_to_evidence
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator, answer_from
from app.retrieval.standard.reranking import Reranker
from app.retrieval.standard.sparse import SparseEmbedder
from app.retrieval.standard.vector_store import SearchHit, VectorStore


@dataclass(frozen=True, slots=True)
class VectorLayer:
    """The vector layer shared with pipeline A: same corpus, same dense and
    sparse models, same hybrid search, same record facts (retrieval fairness)."""

    store: VectorStore
    embeddings: EmbeddingFunction
    sparse: SparseEmbedder
    facts: RecordFacts

    def search(
        self,
        text: str,
        limit: int,
        markets: Sequence[str] | None,
        kinds: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        return self.store.search(
            self.embeddings.embed([text])[0],
            self.sparse.embed_query(text),
            limit=limit,
            markets=markets,
            kinds=kinds,
        )


@dataclass(frozen=True, slots=True)
class NodeReader:
    """What the pipeline reads about a graph node: its text, its
    validity end and its market, from the source lookup and the ontology."""

    source_lookup: SourceLookup | None
    ontology: Ontology | None  # concept texts (pipeline C); B never meets a concept
    embeddings: EmbeddingFunction

    def texts_and_validity(
        self, labels: dict[str, str]
    ) -> tuple[dict[str, str], dict[str, date | None]]:
        """Each node's text and validity end, from one fetch per node.

        One text per node serves semantic scoring and the
        prompt: a concept's ontology text (pipeline C), else the record
        block A indexes for the node's row, else "<Label> <id>" (D-028).
        """
        texts: dict[str, str] = {}
        validity: dict[str, date | None] = {}
        for node_id, node_label in labels.items():
            texts[node_id] = self._text(node_label, node_id)
            if self.source_lookup is not None and node_label in STRUCTURED_LABELS:
                facts = self.source_lookup.fetch(node_label, node_id)
                if facts is not None:
                    validity[node_id] = facts.valid_to
        return texts, validity

    def relevance(self, search_text: str, candidates: list[tuple[str, str]]) -> list[float]:
        """Semantic relevance of ontology-bound candidates, for expansion ranking."""
        texts, _validity = self.texts_and_validity(dict(candidates))
        scores = semantic_scores(search_text, texts, self.embeddings)
        return [scores[node_id] for node_id, _label in candidates]

    def market(self, node_label: str, node_id: str) -> str | None:
        if node_label == "Market":
            return node_id
        if self.source_lookup is None:
            return None
        facts = self.source_lookup.fetch(node_label, node_id)
        return facts.market_id if facts is not None else None

    def _text(self, node_label: str, node_id: str) -> str:
        if node_label == CONCEPT_LABEL and self.ontology is not None:
            # The graph's concepts are ingested from this ontology: an
            # unknown id is a graph/ontology mismatch and raises KeyError.
            return concept_text(self.ontology.concept(node_id))
        if self.source_lookup is not None:
            return self.source_lookup.node_text(node_label, node_id)
        return bare_node_text(node_label, node_id)


@dataclass(frozen=True, slots=True)
class Resolution:
    """The seeds and the text the pipeline searches and ranks with."""

    entities: list[ResolvedEntity]  # resolved, or the vector fallback seed
    search_text: str  # the question; plus concept terms in pipeline C
    target_types: frozenset[str]  # graph labels the question asks about (D-083)


@dataclass(frozen=True, slots=True)
class Traversal:
    result: TraversalResult
    concepts: list[str]  # BusinessConcept ids reached (pipeline C), sorted


@dataclass(frozen=True, slots=True)
class Ranked:
    scored: list[ScoredNode]  # in-scope nodes by composite score
    node_texts: dict[str, str]
    labels: dict[str, str]  # every reached node's label, in scope or not


@dataclass(frozen=True, slots=True)
class Selection:
    """The structured channel in graph relevance order, and the excluded nodes."""

    drafts: list[GraphEvidence]  # structured candidates before their outcome
    excluded: list[GraphEvidence]  # excluded labels, never candidates
    structured: list[EvidenceChunk]  # one candidate per draft, same order
    stated_links: int | None  # stated links read for the target tier; None when not read


@dataclass(frozen=True, slots=True)
class DocumentCandidates:
    documents: list[EvidenceChunk]  # A's document channel, ready to re-rank


@dataclass(frozen=True, slots=True)
class Answer:
    answer: RagAnswer
    node_evidence: list[GraphEvidence]
    document_evidence: list[EvidenceChunk]


def resolve(
    question: str,
    scope: Sequence[str] | None,
    resolver: EntityResolver,
    expansion: QueryExpansion | None,
    targets: TargetTypeMatcher,
    vectors: VectorLayer,
    emitter: EventEmitter,
) -> Resolution:
    """Resolve question mentions to seeds; with none, seed the vector
    layer's best record. The target types are the graph labels the raw
    question names (schema words; in C also ontology terms). Pipeline C
    searches and ranks with the question plus the resolved concepts' labels
    and synonyms; A and B use the raw question."""
    emitter.emit(GRAPH_ENTITY_RESOLUTION_STARTED, question=question, markets=",".join(scope or []))
    resolved = resolver.resolve(question)
    for entity in resolved:
        emitter.emit(
            GRAPH_ENTITY_RESOLVED,
            entity_id=entity.entity_id,
            node_label=entity.node_label,
            origin=entity.origin,
            matched_text=entity.matched_text,
            confidence=entity.confidence,
            via_concept=entity.via_concept,
        )
    target_types = targets.match(question)
    emitter.emit(GRAPH_TARGET_TYPES_RESOLVED, labels=",".join(sorted(target_types)))
    search_text = question
    if expansion is not None:
        expanded = expansion.expand(question, resolved)
        search_text = expanded.text
        emitter.emit(
            GRAPH_QUERY_EXPANDED,
            added_terms=len(expanded.added_terms),
            expanded_length=len(search_text),
        )
    if not resolved:
        resolved = _fallback_seed(search_text, scope, vectors, emitter)
    for entity in resolved:
        emitter.emit(GRAPH_SEED_SELECTED, node_id=entity.entity_id)
    return Resolution(entities=resolved, search_text=search_text, target_types=target_types)


def _fallback_seed(
    search_text: str, scope: Sequence[str] | None, vectors: VectorLayer, emitter: EventEmitter
) -> list[ResolvedEntity]:
    """No entity resolved: seed the graph node of the shared vector
    layer's best record block (same embedding models and corpus as
    pipeline A). The record's id is its node id and its table gives the
    label, so the seed is a real, traversable structured node. No
    record hit (or a table without a graph label) means no seed.
    ``search_text`` is the expanded question in pipeline C."""
    hits = vectors.search(search_text, limit=1, markets=scope, kinds=["record"])
    if not hits:
        return []
    node_id = str(hits[0].payload.get("document_id", ""))
    label = label_for_table(str(hits[0].payload.get("record_table", "")))
    if not node_id or label is None:
        return []
    # No resolver confidence exists for a vector hit: the fused score is
    # reported under its own key, never as a 0-1 confidence.
    seed = ResolvedEntity(
        entity_id=node_id,
        node_label=label,
        matched_text=search_text[:64],
        origin="vector_fallback",
        confidence=None,
    )
    emitter.emit(
        GRAPH_ENTITY_RESOLVED,
        entity_id=seed.entity_id,
        node_label=seed.node_label,
        origin=seed.origin,
        matched_text=seed.matched_text,
        fused_score=hits[0].score,
        via_concept=None,
    )
    return [seed]


def traverse(
    resolution: Resolution,
    neighbours: NeighbourProvider,
    settings: GraphRagSettings,
    nodes: NodeReader,
    emitter: EventEmitter,
) -> Traversal:
    """The bounded walk from the seeds, then (pipeline C) the ontology
    expansion from every concept reached, ranked by relevance to the
    search text. When the question names a target type, the schema-stated
    links among every reached node are read last, after any expansion, for
    the graph relevance order; a refused read raises StatedLinksError."""
    emitter.emit(
        GRAPH_TRAVERSAL_STARTED,
        max_depth=settings.max_depth,
        max_nodes_per_hop=settings.max_nodes_per_hop,
        max_edges_per_node_type=settings.max_edges_per_node_type,
        max_total_nodes=settings.max_total_nodes,
        relationship_types=len(settings.relationship_types),
        ontology_expansion=settings.ontology_expansion,
    )
    seeds = [entity.entity_id for entity in resolution.entities]
    traversal = bounded_traversal(neighbours, seeds, settings)
    for edge in traversal.edges:
        hop = traversal.hops.get(edge.to_id, 0)
        emitter.emit(GRAPH_NODE_DISCOVERED, node_id=edge.to_id, node_label=edge.to_label, hop=hop)
        emitter.emit(
            GRAPH_RELATIONSHIP_TRAVERSED,
            from_id=edge.from_id,
            relationship_type=edge.rel_type,
            to_id=edge.to_id,
            to_label=edge.to_label,
            hop=hop,
        )
    if not settings.ontology_expansion:
        return Traversal(result=_stated(traversal, resolution, neighbours, settings), concepts=[])
    traversal, expansion_counts, new_edges = expand_ontology(
        neighbours,
        traversal,
        settings,
        sorted(_concept_ids(resolution.entities, traversal)),
        lambda candidates: nodes.relevance(resolution.search_text, candidates),
    )
    for edge in new_edges:
        hop = traversal.hops.get(edge.to_id, 0)
        emitter.emit(
            GRAPH_NODE_DISCOVERED,
            node_id=edge.to_id,
            node_label=edge.to_label,
            hop=hop,
            via_concept=edge.from_id,
        )
        emitter.emit(
            GRAPH_RELATIONSHIP_TRAVERSED,
            from_id=edge.from_id,
            relationship_type=edge.rel_type,
            to_id=edge.to_id,
            to_label=edge.to_label,
            hop=hop,
        )
    for concept_id, added in sorted(expansion_counts.items()):
        emitter.emit(GRAPH_ONTOLOGY_EXPANDED, concept_id=concept_id, bound_entities=added)
    return Traversal(
        result=_stated(traversal, resolution, neighbours, settings),
        concepts=sorted(_concept_ids(resolution.entities, traversal)),
    )


def _stated(
    traversal: TraversalResult,
    resolution: Resolution,
    neighbours: NeighbourProvider,
    settings: GraphRagSettings,
) -> TraversalResult:
    """The traversal with its stated links read when the question names a
    target type; without one the order needs no links and none are read."""
    if not resolution.target_types:
        return traversal
    return with_stated_links(neighbours, traversal, settings)


def _concept_ids(resolved: list[ResolvedEntity], traversal: TraversalResult) -> set[str]:
    """BusinessConcept nodes reached as seeds or through traversal."""
    concepts: set[str] = set()
    for entity in resolved:
        if entity.node_label == CONCEPT_LABEL:
            concepts.add(entity.entity_id)
    for edge in traversal.edges:
        if edge.to_label == CONCEPT_LABEL:
            concepts.add(edge.to_id)
    return concepts


def rank_and_scope(
    resolution: Resolution,
    traversal: Traversal,
    scope: Sequence[str] | None,
    settings: GraphRagSettings,
    nodes: NodeReader,
    emitter: EventEmitter,
) -> Ranked:
    """Every reached node by composite score, and each node's text.

    With a market scope, scored nodes whose authoritative record carries a
    market outside it are discarded with ``out_of_scope_market``. A node's
    market comes from its record (the same column its record block carries
    as its market, so the vector filter and this split agree) or is the
    node id itself for Market nodes. Nodes without a market (platforms,
    versions, concepts) are shared evidence and stay in scope, as
    market-less blocks do in the document channel.
    """
    labels: dict[str, str] = {}
    for entity in resolution.entities:
        labels.setdefault(entity.entity_id, entity.node_label)
    for edge in traversal.result.edges:
        labels.setdefault(edge.to_id, edge.to_label)
    texts, validity = nodes.texts_and_validity(labels)
    semantic = semantic_scores(resolution.search_text, texts, nodes.embeddings)
    scored = score_nodes(
        traversal.result, labels, semantic, settings.ranking, validity, settings.reference_date
    )
    if not scope:
        return Ranked(scored=scored, node_texts=texts, labels=labels)
    in_scope: list[ScoredNode] = []
    for node in scored:
        market = nodes.market(node.node_label, node.node_id)
        if market is None or market in scope:
            in_scope.append(node)
            continue
        emitter.emit(
            GRAPH_CANDIDATE_DISCARDED,
            node_id=node.node_id,
            score=node.score,
            hops=node.hops,
            seed=node.hops == 0,
            reason="out_of_scope_market",
            tier=None,
            graph_rank=None,
        )
    return Ranked(scored=in_scope, node_texts=texts, labels=labels)


def select_and_attach(
    ranked: Ranked,
    traversal: Traversal,
    targets: frozenset[str],
    excluded_labels: tuple[str, ...],
    source_lookup: SourceLookup | None,
) -> Selection:
    """The graph channel: every in-scope traversal node (bounded by the
    traversal caps) except excluded labels, in graph relevance order (seeds,
    then target-type holders, then the rest; composite score, then id,
    within a tier; D-083). A directly resolved Document may anchor
    traversal, but its text reaches the model through the document channel.

    Each candidate's ``rank`` is its 1-based graph rank, and its
    ``graph_path`` the walked path from its seed. Authoritative structured
    facts are attached to every structured candidate before its candidate is
    built, because the candidate takes its source table from them; selected
    nodes keep them for citations and the UI. They never enter the prompt
    text (D-028): the prompt shows the record block's compact facts (D-085).
    """
    excluded = [
        _to_graph_evidence(node).model_copy(update={"discard_reason": SELECTION_EXCLUDED_LABEL})
        for node in ranked.scored
        if node.node_label in excluded_labels
    ]
    ordered = graph_relevance_order(ranked.scored, ranked.labels, traversal.result, targets)
    drafts = [
        _with_facts(_to_graph_evidence(node, graph_rank), source_lookup)
        for graph_rank, node in enumerate(
            (node for node in ordered if node.node_label not in excluded_labels), start=1
        )
    ]
    structured = [
        _structured_chunk(
            evidence,
            ranked.node_texts[evidence.node_id],
            graph_rank,
            source_lookup.record_block(evidence.node_label, evidence.node_id)
            if source_lookup is not None
            else None,
            traversal.result.steps_to(evidence.node_id, ranked.labels),
        )
        for graph_rank, evidence in enumerate(drafts, start=1)
    ]
    links = traversal.result.stated_links
    return Selection(
        drafts=drafts,
        excluded=excluded,
        structured=structured,
        stated_links=None if links is None else len(links),
    )


def _to_graph_evidence(node: ScoredNode, graph_rank: int | None = None) -> GraphEvidence:
    """A node's evidence; ``graph_rank`` (and with it the tier) only for a
    node in the graph channel."""
    return GraphEvidence(
        node_id=node.node_id,
        node_label=node.node_label,
        hops=node.hops,
        path=node.path,
        rel_type=node.rel_type,
        score=node.score,
        components=node.components,
        tier=node.tier if graph_rank is not None else None,
        graph_rank=graph_rank,
    )


def _with_facts(evidence: GraphEvidence, source_lookup: SourceLookup | None) -> GraphEvidence:
    if source_lookup is None or evidence.node_label not in STRUCTURED_LABELS:
        return evidence
    facts = source_lookup.fetch(evidence.node_label, evidence.node_id)
    if facts is None:
        return evidence
    return evidence.model_copy(update={"authoritative": facts.to_payload()})


def _structured_chunk(
    evidence: GraphEvidence,
    text: str,
    graph_rank: int,
    record: CorpusChunk | None,
    steps: list[PathStep],
) -> EvidenceChunk:
    """A graph node as a context candidate, ranked within its channel by
    its graph rank.

    A node whose row has a record block in A's corpus takes that block's
    title, market, language, provenance and compact facts from the source
    lookup, whether or not the search returned the block, so the generator
    sees the same block for the same row in A, B and C, apart from the
    declared path line (D-085). Any other node carries the title
    "<Label>: <id>" for citations and the UI only, with no market or
    language; the prompt never renders that title, only "<Label> <id>" and,
    for a concept in C, its ontology text (D-028). steps is the walked path
    from the node's seed (none for a seed). Its authoritative facts stay on
    the node's evidence.
    """
    authoritative = evidence.authoritative or {}
    source_table = authoritative.get("source_table")
    return EvidenceChunk(
        kind=NODE_KIND,
        chunk_id=evidence.node_id,
        document_id=evidence.node_id,
        chunk_index=0,
        text=text,
        title=record.title if record else f"{evidence.node_label}: {evidence.node_id}",
        document_type=evidence.node_label,
        market_id=record.market_id if record else "",
        language_code=record.language_code if record else "-",
        source_system=record.source_system if record else _source_system(source_table),
        record_table=record.record_table if record else source_table,
        valid_from=record.valid_from if record else None,
        valid_to=record.valid_to if record else None,
        facts_heading=record.facts_heading if record else None,
        facts=list(record.facts) if record else [],
        similarity=evidence.score,
        rank=graph_rank,
        graph_path=render_path(steps) or None,
        graph_seed=steps[0].from_id if steps else None,
        discovered_via="graph_traversal",
    )


def _source_system(table: str | None) -> str:
    """The source system owning a table; "graph" for a node without a row."""
    return TABLE_PROVENANCE[table][0] if table in TABLE_PROVENANCE else "graph"


def document_channel(
    search_text: str,
    scope: Sequence[str] | None,
    vectors: VectorLayer,
    top_k: int,
) -> DocumentCandidates:
    """Document channel, identical to pipeline A's retrieval.

    Documents stay in the vector layer for every pipeline (ADR-002,
    retrieval fairness): same corpus (document chunks and record blocks),
    same dense and sparse models, same hybrid search and top_k, same
    market scope. Pipeline C embeds the expanded ``search_text`` (dense
    and sparse); re-ranking always uses the raw question. Record blocks of
    graph candidates stay in this channel too; selection takes a row once,
    at its first appearance in either channel.
    """
    hits = vectors.search(search_text, limit=top_k, markets=scope)
    return DocumentCandidates(
        documents=[
            hit_to_evidence(hit, rank, vectors.facts) for rank, hit in enumerate(hits, start=1)
        ]
    )


def assemble_and_generate(
    question: str,
    selection: Selection,
    documents: DocumentCandidates,
    reranker: Reranker,
    generator: AnswerGenerator,
    context: ContextSettings,
    emitter: EventEmitter,
) -> Answer:
    """The shared cross-encoder re-ranks the document channel only (raw
    question, exactly as in A); the documents and the graph channel are
    interleaved into the one token budget (D-084); then the LLM answers
    over the selection in prompt order."""
    emitter.emit(
        GRAPH_RERANK_STARTED, candidates=len(documents.documents), model=reranker.model_name
    )
    reranked = reranker.rerank(question, documents.documents)
    for candidate in reranked:
        emitter.emit(
            GRAPH_CANDIDATE_RERANKED,
            candidate_id=candidate.chunk_id,
            kind=candidate.kind,
            rerank_score=candidate.rerank_score,
            rank=candidate.rank,
        )
    assembly = assemble_context(reranked, selection.structured, context)
    node_evidence = _node_outcomes(selection, assembly, emitter)
    selected_chunks, discarded_chunks = _document_outcomes(assembly, emitter)

    evidence_paths = [evidence.path for evidence in node_evidence if evidence.selected]
    emitter.emit(
        GRAPH_EVIDENCE_PATH_COMPLETED,
        paths=len(evidence_paths),
        max_hops=max((len(path) - 1 for path in evidence_paths), default=0),
    )
    emitter.emit(
        GRAPH_CONTEXT_ASSEMBLED,
        structured_nodes=len(assembly.structured_selected),
        document_chunks=len(selected_chunks),
        context_tokens=assembly.context_tokens,
        budget_tokens=context.budget_tokens,
        stated_links=selection.stated_links,
    )
    return Answer(
        answer=_generate(question, assembly, generator, emitter),
        node_evidence=node_evidence,
        document_evidence=[*selected_chunks, *discarded_chunks],
    )


def _node_outcomes(
    selection: Selection, assembly: ContextAssembly, emitter: EventEmitter
) -> list[GraphEvidence]:
    """Each node's selection outcome, emitted as a selected or discarded
    event; returns the graph channel in graph order, then the excluded nodes."""
    node_reasons = {
        chunk.chunk_id: chunk.discard_reason
        for chunk in assembly.discarded
        if chunk.kind == NODE_KIND
    }
    node_evidence = [
        _with_outcome(evidence, node_reasons.get(evidence.node_id)) for evidence in selection.drafts
    ]
    node_evidence.extend(selection.excluded)
    for evidence in node_evidence:
        if evidence.selected:
            payload: dict[str, str | int | float | None] = {
                "node_id": evidence.node_id,
                "score": evidence.score,
                "hops": evidence.hops,
                "seed": evidence.hops == 0,
                "tier": evidence.tier,
                "graph_rank": evidence.graph_rank,
            }
            for key, value in evidence.components.items():
                payload[f"weight_{key}"] = value
            emitter.emit(GRAPH_CANDIDATE_SELECTED, **payload)
        else:
            emitter.emit(
                GRAPH_CANDIDATE_DISCARDED,
                node_id=evidence.node_id,
                score=evidence.score,
                hops=evidence.hops,
                seed=evidence.hops == 0,
                reason=evidence.discard_reason,
                tier=evidence.tier,
                graph_rank=evidence.graph_rank,
            )
    return node_evidence


def _with_outcome(evidence: GraphEvidence, discard_reason: str | None) -> GraphEvidence:
    """Selection outcome on a node; only selected nodes keep their facts."""
    if discard_reason is None:
        return evidence.model_copy(update={"selected": True})
    return evidence.model_copy(
        update={"selected": False, "discard_reason": discard_reason, "authoritative": None}
    )


def _document_outcomes(
    assembly: ContextAssembly, emitter: EventEmitter
) -> tuple[list[EvidenceChunk], list[EvidenceChunk]]:
    """The selected and the discarded document candidates (record blocks
    refused as ``same_record`` included, in cross-encoder order), each
    emitted as an event."""
    selected = assembly.document_selected
    discarded = sorted(
        (chunk for chunk in assembly.discarded if chunk.kind != NODE_KIND),
        key=lambda chunk: (chunk.rerank_score is None, chunk.rank),
    )
    for chunk in selected:
        emitter.emit(
            GRAPH_CANDIDATE_SELECTED,
            chunk_id=chunk.chunk_id,
            rerank_score=chunk.rerank_score,
            rank=chunk.rank,
        )
    for chunk in discarded:
        emitter.emit(
            GRAPH_CANDIDATE_DISCARDED,
            chunk_id=chunk.chunk_id,
            rerank_score=chunk.rerank_score,
            reason=chunk.discard_reason,
        )
    return selected, discarded


def _generate(
    question: str, assembly: ContextAssembly, generator: AnswerGenerator, emitter: EventEmitter
) -> RagAnswer:
    """The answer over the selection in prompt order, exactly as pipeline A
    hands it over: the same selected evidence gives the same prompt in A, B
    and C."""
    emitter.emit(GRAPH_GENERATION_STARTED, model=generator.model_name)
    output = generator.generate(question, assembly.selected)
    answer = answer_from(output, assembly.selected, generator.model_name, assembly.context_tokens)
    emitter.emit(
        GRAPH_GENERATION_COMPLETED,
        model=generator.model_name,
        latency_ms=answer.latency_ms,
        context_tokens=assembly.context_tokens,
        verdict=answer.verdict,
        cited_blocks=len(answer.cited_blocks),
    )
    return answer
