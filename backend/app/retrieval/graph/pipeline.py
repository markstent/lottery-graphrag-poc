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
             -> LLM over the selection in judge order -> answer + citations

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
from dataclasses import dataclass
from datetime import date

from app.config import RetrievalSettings
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
    GRAPH_TRAVERSAL_STARTED,
    EventEmitter,
    EventSink,
    ListEventSink,
    RetrievalEvent,
    new_run_id,
)
from app.evidence import (
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
from app.retrieval.graph.source_lookup import SourceLookup, bare_node_text, label_for_table
from app.retrieval.graph.traversal import (
    NeighbourProvider,
    TraversalResult,
    bounded_traversal,
    expand_ontology,
)
from app.retrieval.standard.context import (
    NODE_KIND,
    SELECTION_EXCLUDED_LABEL,
    ContextAssembly,
    assemble_context,
    supersede_records,
)
from app.retrieval.standard.corpus import CorpusChunk, hit_to_evidence
from app.retrieval.standard.embeddings import EmbeddingFunction
from app.retrieval.standard.generation import AnswerGenerator, citations_for, parse_answer
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

    @property
    def events(self) -> list[RetrievalEvent]:
        """The recorded events, when the sink keeps them in memory (the default)."""
        if not isinstance(self.sink, ListEventSink):
            raise TypeError(f"{type(self.sink).__name__} does not keep events in memory")
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
                    hops=node.hops,
                    seed=node.hops == 0,
                    reason="out_of_scope_market",
                )
        candidates = self._build_candidates(search_text, scope, scored, node_texts)
        self.emitter.emit(
            GRAPH_RERANK_STARTED,
            candidates=len(candidates.judged),
            model=self.reranker.model_name,
        )
        reranked = self.reranker.rerank(question, candidates.judged)
        for candidate in reranked:
            self.emitter.emit(
                GRAPH_CANDIDATE_RERANKED,
                candidate_id=candidate.chunk_id,
                kind=candidate.kind,
                rerank_score=candidate.rerank_score,
                rank=candidate.rank,
            )
        assembly = assemble_context(reranked, self.settings.context)
        node_evidence = self._emit_node_outcomes(candidates, reranked, assembly)

        selected_chunks = assembly.document_selected
        discarded_chunks = sorted(
            (
                chunk
                for chunk in [*candidates.superseded, *assembly.discarded]
                if chunk.kind != NODE_KIND
            ),
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

        context_tokens = assembly.context_tokens
        self.emitter.emit(
            GRAPH_CONTEXT_ASSEMBLED,
            structured_nodes=len(assembly.structured_selected),
            document_chunks=len(selected_chunks),
            context_tokens=context_tokens,
            evidence_slots=self.settings.context.evidence_slots,
        )

        # One list in judge order, exactly as pipeline A hands it over: the
        # same selected evidence gives the same prompt in A, B and C.
        self.emitter.emit(GRAPH_GENERATION_STARTED, model=self.generator.model_name)
        output = self.generator.generate(question, assembly.selected)
        parsed = parse_answer(output.raw_text, block_count=len(assembly.selected))
        answer = RagAnswer(
            text=parsed.answer,
            verdict=parsed.verdict,
            cited_blocks=parsed.cited_blocks,
            raw_text=output.raw_text,
            model=self.generator.model_name,
            latency_ms=round(output.latency_ms, 1),
            context_tokens=context_tokens,
            citations=citations_for(assembly.selected),
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

    def _build_candidates(
        self,
        search_text: str,
        scope: Sequence[str] | None,
        scored: list[ScoredNode],
        node_texts: dict[str, str],
    ) -> _Candidates:
        """The structured channel next to A's document channel, ready to judge.

        The structured channel is every in-scope traversal node (bounded by
        the traversal caps) in graph composite score order, except excluded
        labels: a directly resolved Document may anchor traversal, but its
        text reaches the model through the document channel. The document
        channel is identical to pipeline A's (fairness), minus the record
        blocks of structured candidates, superseded before judging (design
        10a.8).
        """
        excluded_labels = self.settings.graph.excluded_labels
        excluded = [
            self._to_graph_evidence(node).model_copy(
                update={"discard_reason": SELECTION_EXCLUDED_LABEL}
            )
            for node in scored
            if node.node_label in excluded_labels
        ]
        drafts = self._attach_authoritative_facts(
            [
                self._to_graph_evidence(node)
                for node in scored
                if node.node_label not in excluded_labels
            ]
        )
        documents, superseded = supersede_records(
            {evidence.node_id for evidence in drafts},
            self._document_candidates(search_text, scope),
        )
        structured = [
            _structured_chunk(
                evidence,
                node_texts[evidence.node_id],
                rank,
                self.source_lookup.record_block(evidence.node_label, evidence.node_id)
                if self.source_lookup is not None
                else None,
            )
            for rank, evidence in enumerate(drafts, start=1)
        ]
        return _Candidates(
            drafts=drafts,
            excluded=excluded,
            superseded=superseded,
            judged=[*structured, *documents],
        )

    def _emit_node_outcomes(
        self, candidates: _Candidates, reranked: list[EvidenceChunk], assembly: ContextAssembly
    ) -> list[GraphEvidence]:
        """Each node's selection outcome, emitted as a selected or discarded
        event; returns the judged nodes followed by the excluded ones."""
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
            for evidence in candidates.drafts
        ]
        node_evidence.extend(candidates.excluded)
        for evidence in node_evidence:
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
        return node_evidence

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
        # No resolver confidence exists for a vector hit: the fused score is
        # reported under its own key, never as a 0-1 confidence.
        seed = ResolvedEntity(
            entity_id=node_id,
            node_label=label,
            matched_text=search_text[:64],
            origin="vector_fallback",
            confidence=None,
        )
        self.emitter.emit(
            GRAPH_ENTITY_RESOLVED,
            entity_id=seed.entity_id,
            node_label=seed.node_label,
            origin=seed.origin,
            matched_text=seed.matched_text,
            fused_score=hits[0].score,
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
        prompt: a concept's ontology text (pipeline C), else the record
        block A indexes for the node's row, else "<Label> <id>" (D-028).
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
        return bare_node_text(node_label, node_id)

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

        A node's market comes from its authoritative structured record (the
        same column its record block carries as its market, so the vector
        filter and this split agree) or is the node id itself for Market
        nodes. Nodes without a market (platforms, versions, concepts) are
        shared evidence and stay in scope, as market-less blocks do in the
        document channel.
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
        return facts.market_id if facts is not None else None

    def _attach_authoritative_facts(
        self, node_evidence: list[GraphEvidence]
    ) -> list[GraphEvidence]:
        """Authoritative structured facts for every structured candidate.

        Facts are attached before the candidates are built, because a
        node's candidate takes its source table from them; selected nodes
        keep them for citations and the UI. They never enter the judged or
        prompt text (D-028).
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
    evidence: GraphEvidence, text: str, rank: int, record: CorpusChunk | None
) -> EvidenceChunk:
    """A graph node as a context candidate, ranked within its channel.

    A node whose row has a record block in A's corpus takes that block's
    title, market, language and provenance from the source lookup, whether
    or not the search returned the block, so the generator sees the same
    block for the same fact in A, B and C. Any other node is shown as
    "<Label>: <id>" with no market or language: its text is "<Label> <id>"
    only (D-028). Its authoritative facts stay on the node's evidence.
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
        similarity=evidence.score,
        rank=rank,
        discovered_via="graph_traversal",
    )


def _source_system(table: str | None) -> str:
    """The source system owning a table; "graph" for a node without a row."""
    return TABLE_PROVENANCE[table][0] if table in TABLE_PROVENANCE else "graph"


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


@dataclass(frozen=True, slots=True)
class _Candidates:
    """One question's candidates: ``judged`` goes to the judge (structured
    then document channel); the rest is recorded for telemetry."""

    drafts: list[GraphEvidence]  # structured candidates before their outcome
    excluded: list[GraphEvidence]  # excluded labels, never judged
    superseded: list[EvidenceChunk]  # record blocks of structured candidates
    judged: list[EvidenceChunk]
