"""Graph-enhanced retrieval pipeline (docs/08 Phase 9; docs/retrieval/graph-rag.md).

    question -> entity resolution (+ query expansion for pipeline C)
             -> seed selection
             -> bounded traversal (+ ontology expansion for pipeline C)
             -> transparent evidence ranking
             -> authoritative source lookup
             -> shared document chunks
             -> one context assembly (budget and slots shared with A;
                record blocks of selected nodes superseded)
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

from app.config import RetrievalSettings
from app.events import (
    GRAPH_CANDIDATE_DISCARDED,
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
from app.retrieval.graph.ranking import (
    STRUCTURED_LABELS,
    ScoredNode,
    score_nodes,
    semantic_scores,
)
from app.retrieval.graph.resolution import EntityResolver, QueryExpansion, ResolvedEntity
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.graph.traversal import (
    NeighbourProvider,
    TraversalResult,
    bounded_traversal,
    expand_ontology,
)
from app.retrieval.standard.context import assemble_context
from app.retrieval.standard.corpus import hit_to_evidence
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator
from app.retrieval.standard.reranking import Reranker
from app.retrieval.standard.sparse import SparseEmbedder
from app.retrieval.standard.vector_store import VectorStore

# EvidenceChunk.kind of a structured graph block in context assembly.
NODE_KIND = "node"


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
    ) -> None:
        self.resolver = resolver
        self.expansion = expansion
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
            search_text = self.expansion.expand(question, resolved)
            added_terms = (
                search_text[len(question) + 1 :].split("; ") if search_text != question else []
            )
            self.emitter.emit(
                GRAPH_QUERY_EXPANDED, added_terms=len(added_terms), expanded_length=len(search_text)
            )
        seeds = [entity.entity_id for entity in resolved]
        if not seeds:
            seeds = self._fallback_seed(search_text, scope)
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

        scored = self._rank(search_text, resolved, traversal)
        if scope:
            scored, out_of_scope = self._apply_market_scope(scored, scope)
            for node in out_of_scope:
                self.emitter.emit(
                    GRAPH_CANDIDATE_DISCARDED,
                    node_id=node.node_id,
                    score=node.score,
                    reason="out_of_scope_market",
                )
        # Seeds are query anchors: they enter the context first, then
        # discovered candidates in score order. Structured blocks and
        # document chunks share one token budget and one evidence-slot count
        # with pipeline A (retrieval fairness).
        ordered = [
            *(node for node in scored if node.hops == 0),
            *(node for node in scored if node.hops > 0),
        ]
        drafts = self._attach_authoritative_facts([self._to_graph_evidence(n) for n in ordered])
        structured = [
            _structured_chunk(evidence, rank) for rank, evidence in enumerate(drafts, start=1)
        ]

        # Document retrieval: identical channel to pipeline A (fairness).
        # Record blocks of selected structured nodes are superseded inside
        # the assembly (design 10a.8).
        document_chunks = self._document_chunks(search_text, question, scope)
        assembly = assemble_context(structured, document_chunks, self.settings.context)
        node_reasons = {
            chunk.chunk_id: chunk.discard_reason
            for chunk in assembly.discarded
            if chunk.kind == NODE_KIND
        }
        node_evidence = [
            _with_outcome(evidence, node_reasons.get(evidence.node_id)) for evidence in drafts
        ]
        for evidence in node_evidence:
            if evidence.selected:
                payload: dict[str, str | int | float | None] = {
                    "node_id": evidence.node_id,
                    "score": evidence.score,
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
                    hops=evidence.hops,
                    seed=evidence.hops == 0,
                    reason=evidence.discard_reason,
                )

        selected_chunks = assembly.document_selected
        discarded_chunks = sorted(
            (chunk for chunk in assembly.discarded if chunk.kind != NODE_KIND),
            key=lambda chunk: chunk.rank,
        )
        for chunk in selected_chunks:
            self.emitter.emit(GRAPH_CANDIDATE_SELECTED, chunk_id=chunk.chunk_id, rank=chunk.rank)
        for chunk in discarded_chunks:
            self.emitter.emit(
                GRAPH_CANDIDATE_DISCARDED, chunk_id=chunk.chunk_id, reason=chunk.discard_reason
            )

        evidence_paths = [evidence.path for evidence in node_evidence if evidence.selected]
        self.emitter.emit(
            GRAPH_EVIDENCE_PATH_COMPLETED,
            paths=len(evidence_paths),
            max_hops=max((len(path) - 1 for path in evidence_paths), default=0),
        )

        structured_blocks = [chunk.text for chunk in assembly.structured_selected]
        context_tokens = assembly.context_tokens
        self.emitter.emit(
            GRAPH_CONTEXT_ASSEMBLED,
            structured_nodes=len(assembly.structured_selected),
            document_chunks=len(selected_chunks),
            context_tokens=context_tokens,
            evidence_slots=self.settings.context.evidence_slots,
        )

        self.emitter.emit(GRAPH_GENERATION_STARTED, model=self.generator.model_name)
        answer_text, latency_ms = self.generator.generate(
            question, selected_chunks, structured_blocks
        )
        answer = RagAnswer(
            text=answer_text,
            model=self.generator.model_name,
            latency_ms=round(latency_ms, 1),
            context_tokens=context_tokens,
            citations=[
                *_chunk_citations(selected_chunks),
                *_node_citations(node_evidence),
            ],
        )
        self.emitter.emit(
            GRAPH_GENERATION_COMPLETED,
            model=self.generator.model_name,
            latency_ms=answer.latency_ms,
            context_tokens=context_tokens,
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

    def _fallback_seed(self, search_text: str, markets: Sequence[str] | None = None) -> list[str]:
        """No entity resolved: seed from the shared vector layer's best
        document (same embedding models and corpus as pipeline A; record
        blocks are excluded so the seed is always a Document node).
        ``search_text`` is the expanded question in pipeline C."""
        hits = self.store.search(
            self.embeddings.embed([search_text])[0],
            self.sparse.embed_query(search_text),
            limit=1,
            markets=markets,
            kinds=["chunk"],
        )
        if not hits:
            return []
        document_id = str(hits[0].payload.get("document_id", ""))
        if not document_id:
            return []
        self.emitter.emit(
            GRAPH_ENTITY_RESOLVED,
            entity_id=document_id,
            node_label="Document",
            origin="vector_fallback",
            matched_text=search_text[:64],
            confidence=hits[0].score,
            via_concept=None,
        )
        return [document_id]

    def _rank(
        self, search_text: str, resolved: list[ResolvedEntity], traversal: TraversalResult
    ) -> list[ScoredNode]:
        labels: dict[str, str] = {}
        for entity in resolved:
            labels.setdefault(entity.entity_id, entity.node_label)
        for edge in traversal.edges:
            labels.setdefault(edge.to_id, edge.to_label)
        semantic = semantic_scores(search_text, self._node_texts(labels), self.embeddings)
        return score_nodes(traversal, labels, semantic, self.settings.graph.ranking)

    def _bound_relevance(self, search_text: str, candidates: list[tuple[str, str]]) -> list[float]:
        """Semantic relevance of ontology-bound candidates, for expansion ranking."""
        scores = semantic_scores(search_text, self._node_texts(dict(candidates)), self.embeddings)
        return [scores[node_id] for node_id, _label in candidates]

    def _node_texts(self, labels: dict[str, str]) -> dict[str, str]:
        texts: dict[str, str] = {}
        for node_id, node_label in labels.items():
            parts = [node_label, node_id]
            if self.source_lookup is not None and node_label in STRUCTURED_LABELS:
                facts = self.source_lookup.fetch(node_label, node_id)
                if facts is not None:
                    parts.append(facts.snippet())
            texts[node_id] = " ".join(parts)
        return texts

    def _document_chunks(
        self, search_text: str, question: str, markets: Sequence[str] | None = None
    ) -> list[EvidenceChunk]:
        """Document retrieval stage, identical to pipeline A's retrieval.

        Documents stay in the vector layer for every pipeline (ADR-002,
        retrieval fairness): same corpus (document chunks and record blocks),
        same dense and sparse models, same hybrid search and top_k, same
        reranker, same market scope. The graph contributes structured
        records and evidence paths, not a second document channel.
        Pipeline C embeds the expanded ``search_text`` (dense and sparse);
        the reranker scores against the raw question for every pipeline.
        """
        hits = self.store.search(
            self.embeddings.embed([search_text])[0],
            self.sparse.embed_query(search_text),
            limit=self.settings.top_k,
            markets=markets,
        )
        candidates = [hit_to_evidence(hit, rank) for rank, hit in enumerate(hits, start=1)]
        return self.reranker.rerank(question, candidates)

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


def _structured_chunk(evidence: GraphEvidence, rank: int) -> EvidenceChunk:
    """A graph node as a context candidate competing for the shared budget."""
    authoritative = evidence.authoritative or {}
    return EvidenceChunk(
        kind=NODE_KIND,
        chunk_id=evidence.node_id,
        document_id=evidence.node_id,
        chunk_index=0,
        text=evidence_snippet(evidence),
        title=f"{evidence.node_label}: {evidence.node_id}",
        document_type=evidence.node_label,
        market_id=authoritative.get("market_id", ""),
        language_code="-",
        source_system=authoritative.get("source_table", "graph"),
        similarity=evidence.score,
        rank=rank,
    )


def _with_outcome(evidence: GraphEvidence, discard_reason: str | None) -> GraphEvidence:
    """Assembly outcome on a node; only selected nodes keep their facts."""
    if discard_reason is None:
        return evidence.model_copy(update={"selected": True})
    return evidence.model_copy(
        update={"selected": False, "discard_reason": discard_reason, "authoritative": None}
    )


def evidence_snippet(evidence: GraphEvidence) -> str:
    """Structured-node context block; authoritative facts lead."""
    parts = [f"{evidence.node_label}:{evidence.node_id}"]
    if evidence.authoritative:
        pairs = ", ".join(f"{key}={value}" for key, value in evidence.authoritative.items())
        parts.append(f"authoritative record: {pairs}")
    parts.append(f"reached via {evidence.rel_type} at {evidence.hops} hop(s)")
    return "; ".join(parts)


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
    citations: list[Citation] = []
    for evidence in nodes:
        if not evidence.selected:
            continue
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
