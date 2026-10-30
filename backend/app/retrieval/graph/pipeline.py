"""Graph-enhanced retrieval pipeline.

Specified in docs/reference/08 (Phase 9) and docs/reference/retrieval/graph-rag.md.

    question -> entity resolution and target types (+ query expansion for C)
             -> seed selection (record-anchored vector fallback)
             -> bounded traversal (+ ontology expansion for pipeline C)
             -> stated links among reached nodes (when there are targets)
             -> composite score -> graph relevance order (seeds, target-type
                holders, the rest; D-083) -> structured candidates
             -> authoritative source lookup
             -> pipeline A's document channel, re-ranked by the shared
                cross-encoder on the raw question, exactly as in A
             -> the two ranked channels taken in turn, documents first, into
                A's token budget with no item limit; a row reaches the prompt
                once, at its first appearance (D-084)
             -> LLM over the selection in prompt order -> answer + citations

History: method v0.2 re-ranked nodes with the documents and gave the graph
a share of 12 slots (D-025, D-081); see DECISIONS.md.

Pipeline B runs the identical pipeline with `ontology_expansion=False`
(MAPS_TO excluded from the traversal allow-list), an id-and-market resolver
and no query expansion; pipeline C adds the ontology term resolver and the
expanded query text. Everything else is shared, isolating the ontology
contribution (docs/reference/retrieval/retrieval-fairness.md). C's target types
may also come from ontology terms. Every candidate and
selected node is recorded with its score components, tier and graph rank; final quantitative
claims come from the structured layer, not the graph. The stages and
their typed results live in ``stages.py``; ``run`` composes them in order.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.config import RetrievalSettings
from app.events import EventEmitter, EventSink, ListEventSink, RetrievalEvent, new_run_id
from app.evidence import GraphRunResult
from app.ontology.model import Ontology
from app.retrieval.graph import stages
from app.retrieval.graph.resolution import EntityResolver, QueryExpansion, TargetTypeMatcher
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.graph.traversal import NeighbourProvider
from app.retrieval.standard.corpus import RecordFacts
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator
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
        record_facts: RecordFacts,
        source_lookup: SourceLookup | None = None,
        pipeline: str = "C",
        sink: EventSink | None = None,
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
        self.sink: EventSink = sink if sink is not None else ListEventSink()
        self.emitter = EventEmitter(pipeline, self.sink)
        # The same reranker instance as pipeline A (retrieval fairness).
        self.reranker = reranker
        # The same record facts as pipeline A (D-085).
        self.record_facts = record_facts

    @property
    def events(self) -> list[RetrievalEvent]:
        """The recorded events, when the sink keeps them in memory (the default)."""
        if not isinstance(self.sink, ListEventSink):
            raise TypeError(f"{type(self.sink).__name__} does not keep events in memory")
        return self.sink.events

    def run(self, question: str, markets: Sequence[str] | None = None) -> GraphRunResult:
        """Run one question through the stages; ``markets`` (full market ids)
        scopes the document channel and the structured evidence alike."""
        if not question.strip():
            raise ValueError("Question must not be empty")
        scope = list(markets) if markets else None
        graph, emitter = self.settings.graph, self.emitter
        vectors = stages.VectorLayer(self.store, self.embeddings, self.sparse, self.record_facts)
        nodes = stages.NodeReader(self.source_lookup, self.ontology, self.embeddings)
        # Target types from the schema words, and in C the ontology's terms:
        # built from the ontology in use for this run (about a millisecond).
        targets = TargetTypeMatcher(self.ontology)
        resolution = stages.resolve(
            question, scope, self.resolver, self.expansion, targets, vectors, emitter
        )
        traversal = stages.traverse(resolution, self.neighbours, graph, nodes, emitter)
        ranked = stages.rank_and_scope(resolution, traversal, scope, graph, nodes, emitter)
        selection = stages.select_and_attach(
            ranked, traversal, resolution.target_types, graph.excluded_labels, self.source_lookup
        )
        documents = stages.document_channel(
            resolution.search_text, scope, vectors, self.settings.top_k
        )
        answer = stages.assemble_and_generate(
            question,
            selection,
            documents,
            self.reranker,
            self.generator,
            self.settings.context,
            emitter,
        )
        return GraphRunResult(
            run_id=new_run_id(),
            question=question,
            answer=answer.answer,
            node_evidence=answer.node_evidence,
            document_evidence=answer.document_evidence,
            ontology_concepts=traversal.concepts,
            embedding_model=self.embeddings.model_name,
            generation_model=self.generator.model_name,
        )
