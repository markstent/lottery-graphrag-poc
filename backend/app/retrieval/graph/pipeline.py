"""Graph-enhanced retrieval pipeline (docs/08 Phase 9; docs/retrieval/graph-rag.md).

    question -> entity resolution (+ query expansion for pipeline C)
             -> seed selection (record-anchored vector fallback)
             -> bounded traversal (+ ontology expansion for pipeline C)
             -> transparent evidence ranking -> structured candidates
             -> authoritative source lookup
             -> pipeline A's document channel (record blocks of structured
                candidates superseded)
             -> one judge (the shared reranker, raw question) over both
             -> one selection (budget and slots shared with A)
             -> LLM -> answer + citations

Pipeline B runs the identical pipeline with `ontology_expansion=False`
(MAPS_TO excluded from the traversal allow-list), an id-and-market resolver
and no query expansion; pipeline C adds the ontology term resolver and the
expanded query text. Everything else is shared, isolating the ontology
contribution (docs/retrieval/retrieval-fairness.md). Every candidate and
selected node is recorded with its score components; final quantitative
claims come from the structured layer, not the graph.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from app.config import RetrievalSettings
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
    GRAPH_TRAVERSAL_STARTED,
    EventEmitter,
    ListEventSink,
    RetrievalEvent,
    new_run_id,
)
from app.evidence import (
    Citation,
    EvidenceChunk,
    GraphEvidence,
    GraphRunResult,
    RagAnswer,
)
from app.ontology.model import Ontology
from app.retrieval.graph.ranking import (
    STRUCTURED_LABELS,
    ScoredNode,
    score_nodes,
    semantic_scores,
)
from app.retrieval.graph.resolution import (
    CONCEPT_LABEL,
    EntityResolver,
    QueryExpansion,
    ResolvedEntity,
    concept_text,
)
from app.retrieval.graph.source_lookup import SourceLookup, describe, label_for_table
from app.retrieval.graph.traversal import (
    NeighbourProvider,
    TraversalResult,
    bounded_traversal,
    expand_ontology,
)
from app.retrieval.standard.context import (
    NODE_KIND,
    SELECTION_EXCLUDED_LABEL,
    assemble_context,
    supersede_records,
)
from app.retrieval.standard.corpus import hit_to_evidence
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator, context_block, parse_answer
from app.retrieval.standard.reranking import Reranker
from app.retrieval.standard.sparse import SparseEmbedder
from app.retrieval.standard.vector_store import VectorStore


class GraphRagPipeline:
    """Pipelines B/C: graph relationships without/with ontology expansion."""

    def __init__(
        self,
        *,
        resolver: EntityResolver,
        neighbours: NeighbourProvider,
        embeddings: EmbeddingFunction,
        sparse: SparseEmbedder,
        store: VectorStore,
        generator: AnswerGenerator,
        settings: RetrievalSettings,
        reranker: Reranker,
        source_lookup: SourceLookup | None = None,
        pipeline: str = "C",
        sink: ListEventSink | None = None,
        expansion: QueryExpansion | None = None,
        ontology: Ontology | None = None,
    ) -> None:
        self.resolver = resolver
        self.expansion = expansion
        # Concept node texts (pipeline C); B has none and never meets a concept.
        self.ontology = ontology
        self.neighbours = neighbours
        self.embeddings = embeddings
        self.sparse = sparse
        self.store = store
        self.generator = generator
        self.settings = settings
        self.source_lookup = source_lookup
        self.pipeline = pipeline
        self.sink = sink if sink is not None else ListEventSink()
        self.emitter = EventEmitter(pipeline, self.sink)
        # The same reranker instance as pipeline A (retrieval fairness).
        self.reranker = reranker

    @property
    def events(self) -> list[RetrievalEvent]:
        return self.sink.events

    def run(self, question: str, markets: Sequence[str] | None = None) -> GraphRunResult:
        """Run one question; ``markets`` (full market ids) scopes evidence.

        The scope applies to the document channel (same filtered vector
        search as pipeline A: fairness) and to structured evidence: scored
        nodes whose authoritative record carries a market outside the scope
        are discarded with ``out_of_scope_market``. Shared infrastructure
        (platforms, versions, concepts, documents) has no market and stays.
        """
        if not question.strip():
            raise ValueError("Question must not be empty")
        scope = list(markets) if markets else None
        graph_settings = self.settings.graph

        self.emitter.emit(
            GRAPH_ENTITY_RESOLUTION_STARTED, question=question, markets=",".join(scope or [])
        )
        resolved = self.resolver.resolve(question)
        for entity in resolved:
            self.emitter.emit(
                GRAPH_ENTITY_RESOLVED,
                entity_id=entity.entity_id,
                node_label=entity.node_label,
                origin=entity.origin,
                matched_text=entity.matched_text,
                confidence=entity.confidence,
                via_concept=entity.via_concept,
            )
        # Pipeline C searches and ranks with the question plus the resolved
        # concepts' labels and synonyms; A and B use the raw question.
        search_text = question
        if self.expansion is not None:
            expansion = self.expansion.expand(question, resolved)
            search_text = expansion.text
            self.emitter.emit(
                GRAPH_QUERY_EXPANDED,
                added_terms=len(expansion.added_terms),
                expanded_length=len(search_text),
            )
        if not resolved:
            resolved = self._fallback_seed(search_text, scope)
        seeds = [entity.entity_id for entity in resolved]
        for seed in seeds:
            self.emitter.emit(GRAPH_SEED_SELECTED, node_id=seed)

        self.emitter.emit(
            GRAPH_TRAVERSAL_STARTED,
            max_depth=graph_settings.max_depth,
            max_nodes_per_hop=graph_settings.max_nodes_per_hop,
            max_edges_per_node_type=graph_settings.max_edges_per_node_type,
            max_total_nodes=graph_settings.max_total_nodes,
            relationship_types=len(graph_settings.relationship_types),
            ontology_expansion=graph_settings.ontology_expansion,
        )
        traversal = bounded_traversal(self.neighbours, seeds, graph_settings)
        for edge in traversal.edges:
            hop = traversal.hops.get(edge.to_id, 0)
            self.emitter.emit(
                GRAPH_NODE_DISCOVERED,
                node_id=edge.to_id,
                node_label=edge.to_label,
                hop=hop,
            )
            self.emitter.emit(
                GRAPH_RELATIONSHIP_TRAVERSED,
                from_id=edge.from_id,
                relationship_type=edge.rel_type,
                to_id=edge.to_id,
                to_label=edge.to_label,
                hop=hop,
            )
        if graph_settings.ontology_expansion:
            concept_ids = sorted(self._concept_ids(resolved, traversal))
            traversal, expansion_counts, new_edges = expand_ontology(
                self.neighbours,
                traversal,
                graph_settings,
                concept_ids,
                lambda candidates: self._bound_relevance(search_text, candidates),
            )
            for edge in new_edges:
                self.emitter.emit(
                    GRAPH_NODE_DISCOVERED,
                    node_id=edge.to_id,
                    node_label=edge.to_label,
                    hop=traversal.hops.get(edge.to_id, 0),
                    via_concept=edge.from_id,
                )
                self.emitter.emit(
                    GRAPH_RELATIONSHIP_TRAVERSED,
                    from_id=edge.from_id,
                    relationship_type=edge.rel_type,
                    to_id=edge.to_id,
                    to_label=edge.to_label,
                    hop=traversal.hops.get(edge.to_id, 0),
                )
            for concept_id, added in sorted(expansion_counts.items()):
                self.emitter.emit(
                    GRAPH_ONTOLOGY_EXPANDED,
                    concept_id=concept_id,
                    bound_entities=added,
                )

        scored, node_texts = self._rank(search_text, resolved, traversal)
        if scope:
            scored, out_of_scope = self._apply_market_scope(scored, scope)
            for node in out_of_scope:
                self.emitter.emit(
                    GRAPH_CANDIDATE_DISCARDED,
                    node_id=node.node_id,
                    score=node.score,
                    rerank_score=None,
                    reason="out_of_scope_market",
                )
        # The structured channel: every traversal node (bounded by the
        # traversal caps) in graph composite score order, except excluded
        # labels: a directly resolved Document may anchor traversal, but
        # its text reaches the model through the document channel.
        excluded = [
            self._to_graph_evidence(node).model_copy(
                update={"discard_reason": SELECTION_EXCLUDED_LABEL}
            )
            for node in scored
            if node.node_label in graph_settings.excluded_labels
        ]
        drafts = self._attach_authoritative_facts(
            [
                self._to_graph_evidence(node)
                for node in scored
                if node.node_label not in graph_settings.excluded_labels
            ]
        )
        # The document channel is identical to pipeline A's (fairness).
        # Record blocks of structured candidates are superseded before
        # judging (design 10a.8); then one judge scores both channels on
        # the raw question and one selection fills the shared budget.
        documents, superseded = supersede_records(
            {evidence.node_id for evidence in drafts},
            self._document_candidates(search_text, scope),
        )
        records = {chunk.document_id: chunk for chunk in superseded}
        structured = [
            _structured_chunk(
                evidence, node_texts[evidence.node_id], rank, records.get(evidence.node_id)
            )
            for rank, evidence in enumerate(drafts, start=1)
        ]
        candidates = [*structured, *documents]
        self.emitter.emit(
            GRAPH_RERANK_STARTED, candidates=len(candidates), model=self.reranker.model_name
        )
        reranked = self.reranker.rerank(question, candidates)
        for candidate in reranked:
            self.emitter.emit(
                GRAPH_CANDIDATE_RERANKED,
                candidate_id=candidate.chunk_id,
                kind=candidate.kind,
                rerank_score=candidate.rerank_score,
                rank=candidate.rank,
            )
        assembly = assemble_context(reranked, self.settings.context)
        judged = {chunk.chunk_id: chunk for chunk in reranked}
        node_reasons = {
            chunk.chunk_id: chunk.discard_reason
            for chunk in assembly.discarded
            if chunk.kind == NODE_KIND
        }
        node_evidence = [
            _with_outcome(
                evidence,
                node_reasons.get(evidence.node_id),
                judged[evidence.node_id].rerank_score,
            )
            for evidence in drafts
        ]
        for evidence in [*node_evidence, *excluded]:
            if evidence.selected:
                payload: dict[str, str | int | float | None] = {
                    "node_id": evidence.node_id,
                    "score": evidence.score,
                    "rerank_score": evidence.rerank_score,
                    "hops": evidence.hops,
                    "seed": evidence.hops == 0,
                }
                for key, value in evidence.components.items():
                    payload[f"weight_{key}"] = value
                self.emitter.emit(GRAPH_CANDIDATE_SELECTED, **payload)
            else:
                self.emitter.emit(
                    GRAPH_CANDIDATE_DISCARDED,
                    node_id=evidence.node_id,
                    score=evidence.score,
                    rerank_score=evidence.rerank_score,
                    hops=evidence.hops,
                    seed=evidence.hops == 0,
                    reason=evidence.discard_reason,
                )
        node_evidence.extend(excluded)

        selected_chunks = assembly.document_selected
        discarded_chunks = sorted(
            (chunk for chunk in [*superseded, *assembly.discarded] if chunk.kind != NODE_KIND),
            key=lambda chunk: (chunk.rerank_score is None, chunk.rank),
        )
        for chunk in selected_chunks:
            self.emitter.emit(
                GRAPH_CANDIDATE_SELECTED,
                chunk_id=chunk.chunk_id,
                rerank_score=chunk.rerank_score,
                rank=chunk.rank,
            )
        for chunk in discarded_chunks:
            self.emitter.emit(
                GRAPH_CANDIDATE_DISCARDED,
                chunk_id=chunk.chunk_id,
                rerank_score=chunk.rerank_score,
                reason=chunk.discard_reason,
            )

        evidence_paths = [evidence.path for evidence in node_evidence if evidence.selected]
        self.emitter.emit(
            GRAPH_EVIDENCE_PATH_COMPLETED,
            paths=len(evidence_paths),
            max_hops=max((len(path) - 1 for path in evidence_paths), default=0),
        )

        evidence_by_id = {evidence.node_id: evidence for evidence in node_evidence}
        # A structured block is formatted exactly like a document block.
        structured_blocks = [context_block(chunk) for chunk in assembly.structured_selected]
        context_tokens = assembly.context_tokens
        self.emitter.emit(
            GRAPH_CONTEXT_ASSEMBLED,
            structured_nodes=len(assembly.structured_selected),
            document_chunks=len(selected_chunks),
            context_tokens=context_tokens,
            evidence_slots=self.settings.context.evidence_slots,
        )

        self.emitter.emit(GRAPH_GENERATION_STARTED, model=self.generator.model_name)
        output = self.generator.generate(question, selected_chunks, structured_blocks)
        parsed = parse_answer(
            output.raw_text, block_count=len(selected_chunks) + len(structured_blocks)
        )
        # Citations follow prompt order (documents, then structured blocks)
        # so cited block n is citations[n - 1].
        answer = RagAnswer(
            text=parsed.answer,
            verdict=parsed.verdict,
            cited_blocks=parsed.cited_blocks,
            raw_text=output.raw_text,
            model=self.generator.model_name,
            latency_ms=round(output.latency_ms, 1),
            context_tokens=context_tokens,
            citations=[
                *_chunk_citations(selected_chunks),
                *_node_citations(
                    [evidence_by_id[chunk.chunk_id] for chunk in assembly.structured_selected]
                ),
            ],
            usage=output.usage,
        )
        self.emitter.emit(
            GRAPH_GENERATION_COMPLETED,
            model=self.generator.model_name,
            latency_ms=answer.latency_ms,
            context_tokens=context_tokens,
            verdict=answer.verdict,
            cited_blocks=len(answer.cited_blocks),
        )

        concepts = (
            sorted(self._concept_ids(resolved, traversal))
            if graph_settings.ontology_expansion
            else []
        )
        return GraphRunResult(
            run_id=new_run_id(),
            question=question,
            answer=answer,
            node_evidence=node_evidence,
            document_evidence=[*selected_chunks, *discarded_chunks],
            ontology_concepts=concepts,
            embedding_model=self.embeddings.model_name,
            generation_model=self.generator.model_name,
        )

    def _concept_ids(self, resolved: list[ResolvedEntity], traversal: TraversalResult) -> set[str]:
        """BusinessConcept nodes reached as seeds or through traversal."""
        concepts: set[str] = set()
        for entity in resolved:
            if entity.node_label == "BusinessConcept":
                concepts.add(entity.entity_id)
        for edge in traversal.edges:
            if edge.to_label == "BusinessConcept":
                concepts.add(edge.to_id)
        return concepts

    def _fallback_seed(
        self, search_text: str, markets: Sequence[str] | None = None
    ) -> list[ResolvedEntity]:
        """No entity resolved: seed the graph node of the shared vector
        layer's best record block (same embedding models and corpus as
        pipeline A). The record's id is its node id and its table gives the
        label, so the seed is a real, traversable structured node. No
        record hit (or a table without a graph label) means no seed.
        ``search_text`` is the expanded question in pipeline C."""
        hits = self.store.search(
            self.embeddings.embed([search_text])[0],
            self.sparse.embed_query(search_text),
            limit=1,
            markets=markets,
            kinds=["record"],
        )
        if not hits:
            return []
        node_id = str(hits[0].payload.get("document_id", ""))
        label = label_for_table(str(hits[0].payload.get("record_table", "")))
        if not node_id or label is None:
            return []
        seed = ResolvedEntity(
            entity_id=node_id,
            node_label=label,
            matched_text=search_text[:64],
            origin="vector_fallback",
            confidence=hits[0].score,
        )
        self.emitter.emit(
            GRAPH_ENTITY_RESOLVED,
            entity_id=seed.entity_id,
            node_label=seed.node_label,
            origin=seed.origin,
            matched_text=seed.matched_text,
            confidence=seed.confidence,
            via_concept=None,
        )
        return [seed]

    def _rank(
        self, search_text: str, resolved: list[ResolvedEntity], traversal: TraversalResult
    ) -> tuple[list[ScoredNode], dict[str, str]]:
        """Scored nodes by composite score, and each node's text."""
        labels: dict[str, str] = {}
        for entity in resolved:
            labels.setdefault(entity.entity_id, entity.node_label)
        for edge in traversal.edges:
            labels.setdefault(edge.to_id, edge.to_label)
        texts, validity = self._node_texts_and_validity(labels)
        semantic = semantic_scores(search_text, texts, self.embeddings)
        graph = self.settings.graph
        scored = score_nodes(
            traversal, labels, semantic, graph.ranking, validity, graph.reference_date
        )
        return scored, texts

    def _bound_relevance(self, search_text: str, candidates: list[tuple[str, str]]) -> list[float]:
        """Semantic relevance of ontology-bound candidates, for expansion ranking."""
        texts, _validity = self._node_texts_and_validity(dict(candidates))
        scores = semantic_scores(search_text, texts, self.embeddings)
        return [scores[node_id] for node_id, _label in candidates]

    def _node_texts_and_validity(
        self, labels: dict[str, str]
    ) -> tuple[dict[str, str], dict[str, date | None]]:
        """Each node's text and validity end, from one fetch per node.

        One text per node serves semantic scoring, the judge and the
        prompt: a concept's ontology text (pipeline C), else the source
        lookup's text (the record block A indexes, else one humanised
        sentence), else "<Label> <id>".
        """
        texts: dict[str, str] = {}
        validity: dict[str, date | None] = {}
        for node_id, node_label in labels.items():
            texts[node_id] = self._node_text(node_label, node_id)
            if self.source_lookup is not None and node_label in STRUCTURED_LABELS:
                facts = self.source_lookup.fetch(node_label, node_id)
                if facts is not None:
                    validity[node_id] = facts.valid_to
        return texts, validity

    def _node_text(self, node_label: str, node_id: str) -> str:
        if node_label == CONCEPT_LABEL and self.ontology is not None:
            # The graph's concepts are ingested from this ontology: an
            # unknown id is a graph/ontology mismatch and raises KeyError.
            return concept_text(self.ontology.concept(node_id))
        if self.source_lookup is not None:
            return self.source_lookup.node_text(node_label, node_id)
        return describe(node_label, node_id, {})

    def _document_candidates(
        self, search_text: str, markets: Sequence[str] | None = None
    ) -> list[EvidenceChunk]:
        """Document channel, identical to pipeline A's retrieval.

        Documents stay in the vector layer for every pipeline (ADR-002,
        retrieval fairness): same corpus (document chunks and record blocks),
        same dense and sparse models, same hybrid search and top_k, same
        market scope. Pipeline C embeds the expanded ``search_text`` (dense
        and sparse); judging always uses the raw question.
        """
        hits = self.store.search(
            self.embeddings.embed([search_text])[0],
            self.sparse.embed_query(search_text),
            limit=self.settings.top_k,
            markets=markets,
        )
        return [hit_to_evidence(hit, rank) for rank, hit in enumerate(hits, start=1)]

    def _apply_market_scope(
        self, scored: list[ScoredNode], markets: list[str]
    ) -> tuple[list[ScoredNode], list[ScoredNode]]:
        """Split scored nodes into in-scope and out-of-scope evidence.

        A node's market comes from its authoritative structured record
        (Incident, Game, AppVersion, Player) or is the node id itself for
        Market nodes. Nodes without a market (platforms, versions,
        concepts, documents) are shared evidence and stay in scope.
        """
        in_scope: list[ScoredNode] = []
        excluded: list[ScoredNode] = []
        for node in scored:
            market = self._node_market(node.node_label, node.node_id)
            if market is None or market in markets:
                in_scope.append(node)
            else:
                excluded.append(node)
        return in_scope, excluded

    def _node_market(self, node_label: str, node_id: str) -> str | None:
        if node_label == "Market":
            return node_id
        if self.source_lookup is None:
            return None
        facts = self.source_lookup.fetch(node_label, node_id)
        if facts is None:
            return None
        market = facts.columns.get("market_id")
        return market or None

    def _attach_authoritative_facts(
        self, node_evidence: list[GraphEvidence]
    ) -> list[GraphEvidence]:
        """Authoritative structured facts for every structured candidate.

        Facts are attached before assembly because they are part of the
        block whose tokens count against the shared budget.
        """
        if self.source_lookup is None:
            return node_evidence
        attached: list[GraphEvidence] = []
        for evidence in node_evidence:
            if evidence.node_label in STRUCTURED_LABELS:
                facts = self.source_lookup.fetch(evidence.node_label, evidence.node_id)
                if facts is not None:
                    attached.append(
                        evidence.model_copy(update={"authoritative": facts.to_payload()})
                    )
                    continue
            attached.append(evidence)
        return attached

    @staticmethod
    def _to_graph_evidence(node: ScoredNode) -> GraphEvidence:
        return GraphEvidence(
            node_id=node.node_id,
            node_label=node.node_label,
            hops=node.hops,
            path=node.path,
            rel_type=node.rel_type,
            score=node.score,
            components=node.components,
        )


def _structured_chunk(
    evidence: GraphEvidence, text: str, rank: int, record: EvidenceChunk | None
) -> EvidenceChunk:
    """A graph node as a context candidate, ranked within its channel.

    A node that supersedes a record block reuses that block's title and
    language, so the generator sees the same block for the same fact in A,
    B and C; other nodes get a "<Label>: <id>" title.
    """
    authoritative = evidence.authoritative or {}
    return EvidenceChunk(
        kind=NODE_KIND,
        chunk_id=evidence.node_id,
        document_id=evidence.node_id,
        chunk_index=0,
        text=text,
        title=record.title if record else f"{evidence.node_label}: {evidence.node_id}",
        document_type=evidence.node_label,
        market_id=authoritative.get("market_id", ""),
        language_code=record.language_code if record else "-",
        source_system=authoritative.get("source_table", "graph"),
        similarity=evidence.score,
        rank=rank,
    )


def _with_outcome(
    evidence: GraphEvidence, discard_reason: str | None, rerank_score: float | None
) -> GraphEvidence:
    """Selection outcome on a node; only selected nodes keep their facts."""
    if discard_reason is None:
        return evidence.model_copy(update={"selected": True, "rerank_score": rerank_score})
    return evidence.model_copy(
        update={
            "selected": False,
            "discard_reason": discard_reason,
            "rerank_score": rerank_score,
            "authoritative": None,
        }
    )


def _chunk_citations(chunks: list[EvidenceChunk]) -> list[Citation]:
    return [
        Citation(
            chunk_id=chunk.chunk_id,
            document_id=chunk.document_id,
            title=chunk.title,
            source_system=chunk.source_system,
            source_record_id=chunk.document_id,
            market_id=chunk.market_id,
            language_code=chunk.language_code,
        )
        for chunk in chunks
    ]


def _node_citations(nodes: list[GraphEvidence]) -> list[Citation]:
    """Citations for the selected structured nodes, in the order given."""
    citations: list[Citation] = []
    for evidence in nodes:
        authoritative = evidence.authoritative or {}
        citations.append(
            Citation(
                chunk_id=evidence.node_id,
                document_id=evidence.node_id,
                title=f"{evidence.node_label}: {evidence.node_id}",
                source_system=str(authoritative.get("source_table", "graph")),
                source_record_id=str(authoritative.get("source_record_id", evidence.node_id)),
                market_id=str(authoritative.get("market_id", "-")),
                language_code="-",
            )
        )
    return citations
