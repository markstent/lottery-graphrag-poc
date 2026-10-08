"""Graph-enhanced retrieval pipeline (docs/08 Phase 9; docs/retrieval/graph-rag.md).

    question -> entity resolution -> seed selection
             -> bounded traversal (+ ontology expansion for pipeline C)
             -> transparent evidence ranking
             -> authoritative source lookup
             -> shared document chunks via graph-reached documents
             -> LLM -> answer + citations

Pipeline differences are configuration only: pipeline B runs the identical
pipeline with `ontology_expansion=False` (MAPS_TO excluded from the
traversal allow-list), isolating the ontology contribution (docs/
retrieval/retrieval-fairness.md). Every candidate and selected node is
recorded with its score components; final quantitative claims come from the
structured layer, not the graph.
"""

from __future__ import annotations

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
from app.retrieval.graph.entities import EntityResolver, ResolvedEntity
from app.retrieval.graph.ranking import (
    STRUCTURED_LABELS,
    ScoredNode,
    score_nodes,
    semantic_scores,
)
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.graph.traversal import (
    NeighbourProvider,
    TraversalResult,
    bounded_traversal,
    expand_ontology,
)
from app.retrieval.standard.context import estimate_tokens, select_context
from app.retrieval.standard.corpus import CorpusChunk
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator
from app.retrieval.standard.reranking import LexicalReranker
from app.retrieval.standard.vector_store import VectorStore

SELECTION_BELOW_SCORE = "below_score_limit"
SELECTION_BUDGET = "context_budget"


class GraphRagPipeline:
    """Pipelines B/C: graph relationships without/with ontology expansion."""

    def __init__(
        self,
        *,
        resolver: EntityResolver,
        neighbours: NeighbourProvider,
        embeddings: EmbeddingFunction,
        store: VectorStore,
        corpus: dict[str, CorpusChunk],
        generator: AnswerGenerator,
        settings: RetrievalSettings,
        source_lookup: SourceLookup | None = None,
        pipeline: str = "C",
        sink: ListEventSink | None = None,
    ) -> None:
        self.resolver = resolver
        self.neighbours = neighbours
        self.embeddings = embeddings
        self.store = store
        self.corpus = corpus
        self.generator = generator
        self.settings = settings
        self.source_lookup = source_lookup
        self.pipeline = pipeline
        self.sink = sink if sink is not None else ListEventSink()
        self.emitter = EventEmitter(pipeline, self.sink)
        # Same reranker wiring as pipeline A (retrieval fairness).
        self.reranker: LexicalReranker | None = (
            LexicalReranker(settings.rerank.lexical_weight) if settings.rerank.enabled else None
        )

    @property
    def events(self) -> list[RetrievalEvent]:
        return self.sink.events

    def run(self, question: str) -> GraphRunResult:
        if not question.strip():
            raise ValueError("Question must not be empty")
        graph_settings = self.settings.graph

        self.emitter.emit(GRAPH_ENTITY_RESOLUTION_STARTED, question=question)
        resolved = self.resolver.resolve(question)
        if not graph_settings.ontology_expansion:
            # Pipeline B never uses the ontology layer: concept mentions do
            # not become seeds.
            resolved = [entity for entity in resolved if entity.node_label != "BusinessConcept"]
        for entity in resolved:
            self.emitter.emit(
                GRAPH_ENTITY_RESOLVED,
                entity_id=entity.entity_id,
                node_label=entity.node_label,
                origin=entity.origin,
                matched_text=entity.matched_text,
                confidence=entity.confidence,
            )
        seeds = [entity.entity_id for entity in resolved]
        if not seeds:
            seeds = self._fallback_seed(question)
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
                self.neighbours, traversal, graph_settings, concept_ids
            )
            for edge in new_edges:
                self.emitter.emit(
                    GRAPH_NODE_DISCOVERED,
                    node_id=edge.to_id,
                    node_label=edge.to_label,
                    hop=traversal.hops.get(edge.to_id, 0),
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

        scored = self._rank(question, resolved, traversal)
        # Seeds are query anchors, not discovered evidence: they are always
        # recorded and selected (docs/07 section 8 keeps seed events
        # separate from candidate events), but they do not consume the
        # evidence-node budget, which goes to traversal discoveries.
        seed_nodes = [node for node in scored if node.hops == 0]
        candidate_nodes = [node for node in scored if node.hops > 0]
        selected_nodes = candidate_nodes[: graph_settings.max_evidence_nodes]
        discarded_nodes = candidate_nodes[graph_settings.max_evidence_nodes :]

        node_evidence: list[GraphEvidence] = []
        for node in seed_nodes:
            node_evidence.append(self._to_graph_evidence(node, selected=True))
            payload: dict[str, str | int | float | None] = {
                "node_id": node.node_id,
                "score": node.score,
                "hops": node.hops,
                "seed": True,
            }
            for key, value in node.components.items():
                payload[f"weight_{key}"] = value
            self.emitter.emit(GRAPH_CANDIDATE_SELECTED, **payload)
        for node in selected_nodes:
            node_evidence.append(self._to_graph_evidence(node, selected=True))
            payload = {
                "node_id": node.node_id,
                "score": node.score,
                "hops": node.hops,
                "seed": False,
            }
            for key, value in node.components.items():
                payload[f"weight_{key}"] = value
            self.emitter.emit(GRAPH_CANDIDATE_SELECTED, **payload)
        for node in discarded_nodes:
            node_evidence.append(self._to_graph_evidence(node, selected=False))
            self.emitter.emit(
                GRAPH_CANDIDATE_DISCARDED,
                node_id=node.node_id,
                score=node.score,
                reason=SELECTION_BELOW_SCORE,
            )

        # Authoritative structured facts for selected structured nodes.
        node_evidence = self._attach_authoritative_facts(node_evidence)

        # Document retrieval: identical channel to pipeline A (fairness).
        document_chunks = self._document_chunks(question)
        selected_chunks, discarded_chunks = select_context(
            document_chunks,
            budget_tokens=self.settings.context.budget_tokens,
            dedupe_threshold=self.settings.context.dedupe_threshold,
        )
        for chunk in selected_chunks:
            self.emitter.emit(GRAPH_CANDIDATE_SELECTED, chunk_id=chunk.chunk_id, rank=chunk.rank)
        for chunk in discarded_chunks:
            self.emitter.emit(
                GRAPH_CANDIDATE_DISCARDED,
                chunk_id=chunk.chunk_id,
                reason=chunk.discard_reason or SELECTION_BUDGET,
            )

        evidence_paths = [evidence.path for evidence in node_evidence if evidence.selected]
        self.emitter.emit(
            GRAPH_EVIDENCE_PATH_COMPLETED,
            paths=len(evidence_paths),
            max_hops=max((len(path) - 1 for path in evidence_paths), default=0),
        )

        structured_blocks = [
            evidence_snippet(evidence) for evidence in node_evidence if evidence.selected
        ]
        context_tokens = sum(estimate_tokens(block) for block in structured_blocks) + sum(
            estimate_tokens(chunk.text) for chunk in selected_chunks
        )
        self.emitter.emit(
            GRAPH_CONTEXT_ASSEMBLED,
            structured_nodes=sum(1 for evidence in node_evidence if evidence.selected),
            document_chunks=len(selected_chunks),
            context_tokens=context_tokens,
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

    def _fallback_seed(self, question: str) -> list[str]:
        """No entity resolved: seed from the shared vector layer's best
        document (same embedding model and corpus as pipeline A)."""
        query_vector = self.embeddings.embed([question])[0]
        hits = self.store.search(query_vector, limit=1)
        if not hits:
            return []
        document_id = str(hits[0][2].get("document_id", ""))
        if not document_id:
            return []
        self.emitter.emit(
            GRAPH_ENTITY_RESOLVED,
            entity_id=document_id,
            node_label="Document",
            origin="vector_fallback",
            matched_text=question[:64],
            confidence=hits[0][1],
        )
        return [document_id]

    def _rank(
        self, question: str, resolved: list[ResolvedEntity], traversal: TraversalResult
    ) -> list[ScoredNode]:

        labels: dict[str, str] = {}
        for entity in resolved:
            labels.setdefault(entity.entity_id, entity.node_label)
        for edge in traversal.edges:
            labels.setdefault(edge.to_id, edge.to_label)
        semantic = semantic_scores(question, self._node_texts(labels), self.embeddings)
        return score_nodes(traversal, labels, semantic, self.settings.graph.ranking)

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

    def _document_chunks(self, question: str) -> list[EvidenceChunk]:
        """Document retrieval stage, identical to pipeline A's retrieval.

        Documents stay in the vector layer for every pipeline (ADR-002,
        retrieval fairness): same corpus, same embedding model, same top_k,
        same reranker. The graph contributes structured records and
        evidence paths, not a second document channel.
        """
        query_vector = self.embeddings.embed([question])[0]
        hits = self.store.search(query_vector, limit=self.settings.top_k)
        candidates = [
            chunk.to_evidence(similarity=similarity, rank=rank)
            for rank, (chunk_id, similarity, _payload) in enumerate(hits, start=1)
            if (chunk := self.corpus.get(chunk_id)) is not None
        ]
        if self.reranker is not None:
            candidates = self.reranker.rerank(question, candidates)
        return candidates

    def _attach_authoritative_facts(
        self, node_evidence: list[GraphEvidence]
    ) -> list[GraphEvidence]:
        if self.source_lookup is None:
            return node_evidence
        attached: list[GraphEvidence] = []
        for evidence in node_evidence:
            if evidence.selected and evidence.node_label in STRUCTURED_LABELS:
                facts = self.source_lookup.fetch(evidence.node_label, evidence.node_id)
                if facts is not None:
                    attached.append(
                        evidence.model_copy(update={"authoritative": facts.to_payload()})
                    )
                    continue
            attached.append(evidence)
        return attached

    @staticmethod
    def _to_graph_evidence(node: ScoredNode, *, selected: bool) -> GraphEvidence:
        return GraphEvidence(
            node_id=node.node_id,
            node_label=node.node_label,
            hops=node.hops,
            path=node.path,
            rel_type=node.rel_type,
            score=node.score,
            components=node.components,
            selected=selected,
            discard_reason=None if selected else SELECTION_BELOW_SCORE,
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
