"""Lab fairness tests (docs/reference/08 Phase 12): the B/C contract is structural.

Pipeline B must be exactly pipeline C minus ontology traversal, so any
measured B/C difference is attributable to the ontology layer and not to
divergent configuration. These tests pin that contract offline.
"""

from __future__ import annotations

import dataclasses
import difflib
from collections.abc import Sequence
from pathlib import Path

import pytest
from app.config import PROMPT_EXTRAS, ContextSettings, RetrievalSettings, from_env
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.evaluation.judge import FakeJudge
from app.evaluation.runner import settings_fields
from app.evidence import EvidenceChunk, GraphRunResult, RagRunResult
from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES
from app.lab import Lab, bc_graph_settings, graph_pipelines
from app.ontology.model import Ontology
from app.retrieval.graph import pipeline as pipeline_module
from app.retrieval.graph.neo4j_adapter import build_resolvers
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.graph.resolution import (
    IdEntityResolver,
    QueryExpansion,
    ResolvedEntity,
    StaticEntityResolver,
    TargetTypeMatcher,
    TermEntityResolver,
)
from app.retrieval.graph.source_lookup import SourceLookup
from app.retrieval.graph.traversal import load_static_provider_from_rows
from app.retrieval.standard.context import block_tokens
from app.retrieval.standard.corpus import CorpusChunk, hit_to_evidence
from app.retrieval.standard.generation import (
    SYSTEM_PROMPT,
    FakeAnswerGenerator,
    GenerationOutput,
    LiteLLMAnswerGenerator,
    build_user_prompt,
    context_block,
)
from app.retrieval.standard.index import index_corpus
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.sparse import SparseVector
from app.retrieval.standard.vector_store import InMemoryVectorStore, SearchHit

from tests.conftest import StubLiteLLM, build_lab_offline
from tests.test_graph_rag import (
    PromptCapture,
    RecordingReranker,
    RecordingSparseEmbedder,
    build_corpus,
    graph_channel,
    make_settings,
    record_corpus_chunk,
    resolved,
    scn007_adjacency,
)
from tests.test_graph_stages import GOLDEN_QUESTIONS, tiny_world_lab


def diff_labels(base_settings: object, other: object) -> list[str]:
    """Top-level settings fields whose values differ."""
    return [
        field.name
        for field in dataclasses.fields(base_settings)  # type: ignore[arg-type]
        if getattr(base_settings, field.name) != getattr(other, field.name)
    ]


@pytest.fixture
def base() -> RetrievalSettings:
    return make_settings()


def test_b_and_c_differ_only_in_graph_traversal(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert diff_labels(base, settings_b) == ["graph"]
    assert diff_labels(base, settings_c) in ([], ["graph"])
    assert diff_labels(settings_b, settings_c) == ["graph"]
    # One total token budget for A (base), B and C, with no item limit.
    assert settings_b.context == settings_c.context == base.context


def test_b_excludes_every_ontology_relationship_and_nothing_else(
    base: RetrievalSettings,
) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    removed = set(settings_c.graph.relationship_types) - set(settings_b.graph.relationship_types)
    assert removed == set(ONTOLOGY_RELATIONSHIP_TYPES)
    assert not settings_b.graph.ontology_expansion
    assert settings_c.graph.ontology_expansion


def test_b_preserves_the_c_order_for_non_ontology_types(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert settings_c.graph.relationship_types == base.graph.relationship_types
    expected = tuple(
        rel for rel in settings_c.graph.relationship_types if rel not in ONTOLOGY_RELATIONSHIP_TYPES
    )
    assert settings_b.graph.relationship_types == expected


def test_every_question_traverses_player_instruments(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    for relationship in ("USES", "USES_PAYMENT"):
        assert relationship in base.graph.relationship_types
        assert relationship in settings_b.graph.relationship_types
        assert relationship in settings_c.graph.relationship_types


def test_allow_list_sizes_and_mechanic_path(base: RetrievalSettings) -> None:
    settings_b, settings_c = bc_graph_settings(base)
    assert len(settings_c.graph.relationship_types) == 22
    assert len(settings_b.graph.relationship_types) == 19
    assert "HAS_MECHANIC" in settings_b.graph.relationship_types
    assert "HAS_MECHANIC" in settings_c.graph.relationship_types


@pytest.fixture
def lab() -> Lab:
    return build_lab_offline()


@pytest.fixture
def b_and_c(lab: Lab) -> tuple[GraphRagPipeline, GraphRagPipeline]:
    pipelines = graph_pipelines(
        lab, scn007_adjacency(), StaticEntityResolver([]), StaticEntityResolver([])
    )
    assert [tag for tag, _ in pipelines] == ["B", "C"]
    b, c = (pipeline for _, pipeline in pipelines)
    return b, c


def test_lab_pipeline_a_uses_the_lab_reranker_instance(lab: Lab) -> None:
    assert lab.pipeline_a().reranker is lab.reranker


def test_a_b_c_share_every_retrieval_component(
    lab: Lab, b_and_c: tuple[GraphRagPipeline, GraphRagPipeline]
) -> None:
    a = lab.pipeline_a()
    b, c = b_and_c
    for attr in ("embeddings", "sparse", "reranker", "store", "generator"):
        assert getattr(a, attr) is getattr(b, attr) is getattr(c, attr)
        assert getattr(a, attr) is getattr(lab, attr)
    assert b.source_lookup is c.source_lookup is lab.source_lookup
    assert a.settings.top_k == b.settings.top_k == c.settings.top_k
    assert a.settings.context == b.settings.context == c.settings.context


def test_b_and_c_share_reference_date_and_ranking_weights(
    b_and_c: tuple[GraphRagPipeline, GraphRagPipeline],
) -> None:
    b, c = b_and_c
    assert b.settings.graph.reference_date == c.settings.graph.reference_date
    assert b.settings.graph.ranking == c.settings.graph.ranking


def test_b_has_no_term_resolver_and_c_has_one(lab: Lab) -> None:
    id_resolver, term_resolver = StaticEntityResolver([]), StaticEntityResolver([])
    b, c = (p for _, p in graph_pipelines(lab, scn007_adjacency(), id_resolver, term_resolver))
    assert b.resolver is id_resolver
    assert b.expansion is None
    assert c.resolver is term_resolver
    assert isinstance(c.expansion, QueryExpansion)


class StubReader:
    def lookup_node(self, node_id: str) -> tuple[str, bool] | None:
        return None

    def markets(self) -> dict[str, str]:
        return {}


def test_build_resolvers_gives_b_the_id_resolver_and_c_the_term_resolver(lab: Lab) -> None:
    ids, terms = build_resolvers(StubReader(), lab.ontology, lab.term_matcher)  # type: ignore[arg-type]
    b, c = (p for _, p in graph_pipelines(lab, scn007_adjacency(), ids, terms))
    assert isinstance(b.resolver, IdEntityResolver)
    assert isinstance(c.resolver, TermEntityResolver)
    assert b.ontology is None and c.ontology is lab.ontology
    assert b.expansion is None
    assert c.expansion is not None


def indexed_lab(corpus: Sequence[CorpusChunk], **overrides: object) -> Lab:
    """The offline lab with corpus loaded (record facts included) and indexed."""
    lab = dataclasses.replace(
        build_lab_offline(),
        corpus={chunk.chunk_id: chunk for chunk in corpus},
        **overrides,  # type: ignore[arg-type]
    )
    index_corpus(lab.store, lab.embeddings, lab.sparse, list(corpus))
    return lab


def test_one_shared_judge_sees_the_same_documents_in_a_b_and_c() -> None:
    """A, B and C hand the shared reranker the same document candidates.

    No entity resolves and the static store holds no record, so B and C have
    no seed and no structured candidates: what remains is exactly A's
    document channel, judged by the same instance on the raw question.
    """
    reranker = RecordingReranker()
    lab = dataclasses.replace(build_lab_offline(), reranker=reranker)
    index_corpus(lab.store, lab.embeddings, lab.sparse, list(build_corpus().values()))
    b, c = (
        pipeline
        for _, pipeline in graph_pipelines(
            lab, scn007_adjacency(), StaticEntityResolver([]), StaticEntityResolver([])
        )
    )
    a = lab.pipeline_a()
    assert a.reranker is b.reranker is c.reranker is reranker
    question = "Why did checkout fail in Greece?"
    for pipeline in (a, b, c):
        pipeline.run(question)
    assert len(reranker.calls) == 3
    judged = [
        (asked, [(chunk.chunk_id, chunk.rank) for chunk in candidates if chunk.kind != "node"])
        for asked, candidates in reranker.calls
    ]
    assert judged[0][1], "A must judge document candidates"
    assert judged[0] == judged[1] == judged[2] == (question, judged[0][1])


def test_the_reranker_receives_b_document_channel_only_equal_to_a() -> None:
    """With graph candidates, the shared re-ranker still receives exactly A's
    document channel from B, record blocks of B's own nodes included, in A's
    order and ranks, and no node: nodes are ordered by the graph (D-083)."""
    reranker = RecordingReranker()
    record = record_corpus_chunk(
        "incidents", "INC_S007_GR", "Incident INC_S007_GR in Greece: checkout failed."
    )
    lab = indexed_lab([*build_corpus().values(), record], reranker=reranker)
    (_, b), _c = graph_pipelines(
        lab, scn007_adjacency(), StaticEntityResolver(resolved()), StaticEntityResolver([])
    )
    question = "Why did checkout fail in Greece?"
    lab.pipeline_a().run(question)
    result_b = b.run(question)
    (asked_a, judged_a), (asked_b, judged_b) = reranker.calls
    assert asked_a == asked_b == question
    assert all(chunk.kind != "node" for chunk in judged_b)
    documents_a = [(chunk.chunk_id, chunk.rank) for chunk in judged_a]
    assert record.chunk_id in dict(documents_a), "A must retrieve the record block"
    assert [(chunk.chunk_id, chunk.rank) for chunk in judged_b] == documents_a
    assert any(e.node_id == "INC_S007_GR" for e in result_b.node_evidence)


PATH_LINE = "- reached from "


def two_record_lab() -> tuple[Lab, GraphRagPipeline, GraphRagPipeline]:
    """A lab whose corpus holds the SCN-007 documents and two records, an
    incident (the seed) and the platform version it relates to; B and C
    resolve the incident and walk to the version."""
    incident = record_corpus_chunk(
        "incidents", "INC_S007_GR", "Incident INC_S007_GR in Greece: checkout failed."
    )
    version = record_corpus_chunk(
        "platform_versions",
        "PLV_PAYMENTS_3",
        "Platform version 3 (PLV_PAYMENTS_3) of Payments. Released 2025-05-01.",
        market_id="",
    )
    records = {
        (chunk.record_table or "", chunk.document_id): chunk for chunk in (incident, version)
    }
    lab = indexed_lab(
        [*build_corpus().values(), incident, version],
        source_lookup=SourceLookup(Path("unused"), records),
    )
    neighbours = load_static_provider_from_rows(
        [("INC_S007_GR", "RELATED_TO_VERSION", "PLV_PAYMENTS_3", "PlatformVersion")]
    )
    (_, b), (_, c) = graph_pipelines(
        lab, neighbours, StaticEntityResolver(resolved()), StaticEntityResolver(resolved())
    )
    return lab, b, c


def split_path_line(block: str) -> tuple[str, list[str]]:
    """(the block without its path line, the path lines it had)."""
    lines = block.split("\n")
    paths = [line for line in lines if line.startswith(PATH_LINE)]
    return "\n".join(line for line in lines if not line.startswith(PATH_LINE)), paths


def test_same_row_renders_the_same_in_a_b_and_c(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-085: a row is the same block in A (its record hit) and in B and C
    (its graph node), apart from the declared path line."""
    lab, b, c = two_record_lab()
    question = "Why did checkout fail in Greece?"
    result_a = lab.pipeline_a().run(question)
    blocks_a = {e.document_id: context_block(e) for e in result_a.evidence if e.kind == "record"}
    assert set(blocks_a) == {"INC_S007_GR", "PLV_PAYMENTS_3"}
    assert all(block.startswith("Record ") for block in blocks_a.values())
    for pipeline in (b, c):
        _result, channel = graph_channel(pipeline, question, monkeypatch)
        nodes = {node.document_id: node for node in channel if node.document_id in blocks_a}
        assert set(nodes) == set(blocks_a)
        for row, node in nodes.items():
            block, paths = split_path_line(context_block(node))
            assert block == blocks_a[row], (pipeline.pipeline, row)
            assert len(paths) == (1 if node.graph_path else 0)


def test_path_line_only_for_graph_records_off_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never in A, never for a seed, always for a B or C node with hops > 0."""
    lab, b, c = two_record_lab()
    question = "Why did checkout fail in Greece?"
    result_a = lab.pipeline_a().run(question)
    assert result_a.evidence
    assert all(PATH_LINE not in context_block(chunk) for chunk in result_a.evidence)
    for pipeline in (b, c):
        result, channel = graph_channel(pipeline, question, monkeypatch)
        hops = {node.node_id: node.hops for node in result.node_evidence}
        assert hops["INC_S007_GR"] == 0 and hops["PLV_PAYMENTS_3"] > 0
        assert all(PATH_LINE not in context_block(chunk) for chunk in result.document_evidence)
        for node in channel:
            _block, paths = split_path_line(context_block(node))
            assert len(paths) == (0 if hops[node.document_id] == 0 else 1), node.document_id
        version = next(node for node in channel if node.document_id == "PLV_PAYMENTS_3")
        assert context_block(version).endswith(
            "\n- reached from INC_S007_GR: INC_S007_GR -RELATED_TO_VERSION-> PLV_PAYMENTS_3"
        )
        seed = next(node for node in channel if node.document_id == "INC_S007_GR")
        assert PATH_LINE not in context_block(seed)


EMPTY_SCOPE = ("()", "(, ", ", )", " -)", "(-)")


def test_no_block_shows_an_empty_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every candidate block of A, B and C (records, documents, one without a
    market, and graph nodes without a record block: Game, Market,
    SupportCase and, in C, BusinessConcept) renders without empty
    parentheses or a "-" language."""
    unscoped = dataclasses.replace(
        build_corpus()["CHNK_S007_UK_00"], chunk_id="CHNK_UNSCOPED_00", market_id=""
    )
    lab = indexed_lab([*build_corpus().values(), unscoped])
    b, c = (
        pipeline
        for _, pipeline in graph_pipelines(
            lab,
            scn007_adjacency(),
            StaticEntityResolver(resolved()),
            StaticEntityResolver(resolved()),
        )
    )
    question = "Why did checkout fail in Greece?"
    candidates = list(lab.pipeline_a().run(question).evidence)
    labels: set[str] = set()
    for pipeline in (b, c):
        result, channel = graph_channel(pipeline, question, monkeypatch)
        candidates += [*result.document_evidence, *channel]
        labels |= {chunk.document_type for chunk in channel if chunk.facts_heading is None}
    assert {"Game", "Market", "SupportCase", "BusinessConcept"} <= labels
    assert "CHNK_UNSCOPED_00" in {chunk.chunk_id for chunk in candidates}
    for chunk in candidates:
        block = context_block(chunk)
        assert not any(fragment in block for fragment in EMPTY_SCOPE), block


def test_a_and_b_show_the_same_evidence_as_the_same_blocks_in_alternation() -> None:
    """Same evidence, same blocks (design G1, 5.4); the order is alternation.

    B's two nodes are exactly A's two record hits, so both pipelines show
    the same rows and documents, each row once, and each as the same block
    apart from the declared path line of a node B reached by a walk (D-085).
    A's prompt is its cross-encoder order; B's takes its documents (A's
    order) and its nodes (graph order) in turn, documents first (D-084).
    """
    lab, b, _c = two_record_lab()
    question = "Why did checkout fail in Greece?"
    generator_a, generator_b = PromptCapture(), PromptCapture()
    a = lab.pipeline_a()
    a.generator, b.generator = generator_a, generator_b
    result_a, result_b = a.run(question), b.run(question)

    blocks_a = {chunk.document_id: context_block(chunk) for chunk in generator_a.contexts}
    blocks_b = {
        chunk.document_id: split_path_line(context_block(chunk))[0]
        for chunk in generator_b.contexts
    }
    assert sorted(blocks_a) == ["DOC_S007_GR", "DOC_S007_UK", "INC_S007_GR", "PLV_PAYMENTS_3"]
    assert len(generator_b.contexts) == len(blocks_b) == len(blocks_a)
    assert blocks_b == blocks_a
    assert all(PATH_LINE not in block for block in blocks_a.values())
    assert {"node", "chunk"} <= {c.kind for c in generator_b.contexts}

    documents = [c.document_id for c in generator_b.contexts if c.kind != "node"]
    nodes = [c for c in generator_b.contexts if c.kind == "node"]
    assert [c.rank for c in nodes] == sorted(c.rank for c in nodes)
    a_order = [c.document_id for c in generator_a.contexts]
    assert documents == [d for d in a_order if d in documents]
    expected: list[str] = []
    for index in range(max(len(documents), len(nodes))):
        expected += documents[index : index + 1] + [c.document_id for c in nodes[index : index + 1]]
    assert [c.document_id for c in generator_b.contexts] == expected
    assert generator_b.contexts[0].document_id == a_order[0]

    def citations(result: RagRunResult | GraphRunResult) -> set[tuple[object, ...]]:
        return {
            (c.document_id, c.title, c.source_system, c.source_record_id, c.record_table)
            for c in result.answer.citations
        }

    assert citations(result_b) == citations(result_a)


class RecordingStore(InMemoryVectorStore):
    """The in-memory store, keeping the hits of every document-channel search
    (the graph pipelines' record-only fallback-seed search is left out)."""

    def __init__(self) -> None:
        super().__init__()
        self.searches: list[list[SearchHit]] = []

    def search(
        self,
        dense: list[float],
        sparse: SparseVector,
        limit: int,
        markets: Sequence[str] | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        hits = super().search(dense, sparse, limit, markets=markets, kinds=kinds)
        if not kinds:
            self.searches.append(hits)
        return hits


def test_vector_hits_are_built_from_the_payload_in_every_pipeline() -> None:
    """Spec 6.3: A, B and C turn each vector hit into evidence the same way,
    from the stored payload alone. The lab's corpus holds other text for the
    same chunk ids and misses one of them, so a corpus lookup would show up
    as changed text or a silently dropped hit."""
    reranker = RecordingReranker()
    store = RecordingStore()
    indexed = list(build_corpus().values())
    stale = {
        chunk.chunk_id: dataclasses.replace(chunk, text="stale corpus text")
        for chunk in indexed[1:]
    }
    lab = dataclasses.replace(build_lab_offline(), reranker=reranker, store=store, corpus=stale)
    index_corpus(lab.store, lab.embeddings, lab.sparse, indexed)
    b, c = (
        pipeline
        for _, pipeline in graph_pipelines(
            lab, scn007_adjacency(), StaticEntityResolver([]), StaticEntityResolver([])
        )
    )
    question = "Why did checkout fail in Greece?"
    for pipeline in (lab.pipeline_a(), b, c):
        pipeline.run(question)
    assert len(store.searches) == len(reranker.calls) == 3
    for hits, (_asked, judged) in zip(store.searches, reranker.calls, strict=True):
        assert hits, "every pipeline must retrieve documents"
        documents = [chunk for chunk in judged if chunk.kind != "node"]
        expected = [
            hit_to_evidence(hit, rank, lab.record_facts) for rank, hit in enumerate(hits, start=1)
        ]
        assert documents == expected
        assert all(chunk.text != "stale corpus text" for chunk in documents)


# -- the v0.3 fairness contract (Task 11) -------------------------------------------------


def _scn007_pipelines(
    lab: Lab, term_entities: Sequence[ResolvedEntity] | None = None
) -> tuple[StandardRagPipeline, GraphRagPipeline, GraphRagPipeline]:
    """A, B and C from one lab over the SCN-007 neighbourhood; C gets
    ``term_entities`` (default: B's seed) and the lab's query expansion."""
    (_, b), (_, c) = graph_pipelines(
        lab,
        scn007_adjacency(),
        StaticEntityResolver(resolved()),
        StaticEntityResolver(list(term_entities or resolved())),
    )
    return lab.pipeline_a(), b, c


def test_a_b_c_select_under_the_same_budget() -> None:
    """F20: each pipeline holds its own context settings, built separately,
    and they are equal: one 2,000-token budget, one near-duplicate threshold."""
    a, b, c = _scn007_pipelines(indexed_lab(list(build_corpus().values())))
    contexts = [pipeline.settings.context for pipeline in (a, b, c)]
    assert len({id(context) for context in contexts}) == 3
    expected = ContextSettings(budget_tokens=2000, dedupe_threshold=0.85)
    assert contexts[0] == contexts[1] == contexts[2] == expected
    assert from_env().context == expected


class _QuestionSpy(FakeAnswerGenerator):
    def __init__(self) -> None:
        super().__init__()
        self.questions: list[str] = []

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        self.questions.append(question)
        return super().generate(question, contexts)


def test_a_b_c_hand_the_generator_the_same_question() -> None:
    """C embeds an expanded search text, yet every pipeline hands the
    generator the raw question."""
    spy, sparse = _QuestionSpy(), RecordingSparseEmbedder()
    lab = indexed_lab(list(build_corpus().values()), generator=spy, sparse=sparse)
    concept = ResolvedEntity(
        "CONCEPT_PLATFORM_INCIDENT", "BusinessConcept", "platform incident", "term", 0.8
    )
    question = "Why did checkout fail in Greece?"
    for pipeline in _scn007_pipelines(lab, [*resolved(), concept]):
        pipeline.run(question)
    assert spy.questions == [question] * 3
    assert any(query != question for query in sparse.queries), "C must expand its search text"


def test_a_b_c_share_reranker_answer_model_and_prompt(stub_litellm: StubLiteLLM) -> None:
    generator = LiteLLMAnswerGenerator(model="stub/model")
    a, b, c = _scn007_pipelines(indexed_lab(list(build_corpus().values()), generator=generator))
    assert a.reranker is b.reranker is c.reranker
    assert a.generator is b.generator is c.generator is generator
    for pipeline in (a, b, c):
        pipeline.run("Why did checkout fail in Greece?")
    systems = [
        [m["content"] for m in call["messages"] if m["role"] == "system"]
        for call in stub_litellm.calls
    ]
    assert systems == [[SYSTEM_PROMPT]] * 3
    assert {call["model"] for call in stub_litellm.calls} == {"stub/model"}


# A's selection on the tiny world (RAG_TOP_K 40, lexical re-ranker, 2,000
# tokens): the cross-encoder order cut at the budget, pinned.
A_QUESTION = "Which platform version was INC_024 related to?"
A_SELECTED = [
    "REC_incidents_INC_024",
    "REC_incidents_INC_001",
    "REC_incidents_INC_002",
    "REC_incidents_INC_003",
    "REC_incidents_INC_004",
    "REC_incidents_INC_005",
    "REC_incidents_INC_006",
    "REC_incidents_INC_007",
    "REC_incidents_INC_008",
    "REC_incidents_INC_009",
    "REC_incidents_INC_010",
    "REC_incidents_INC_011",
    "REC_incidents_INC_012",
    "REC_incidents_INC_013",
    "REC_incidents_INC_014",
    "REC_platform_versions_PLV_ANALYTICS_1",
    "REC_platform_versions_PLV_DRAW_1",
]


@pytest.fixture(scope="module")
def tiny_world(
    tmp_path_factory: pytest.TempPathFactory,
) -> tuple[Lab, dict[str, GraphRagPipeline]]:
    dataset_dir = tmp_path_factory.mktemp("tiny-world-fairness")
    write_world(
        dataset_dir, TABLE_SCHEMAS, build_world(GenerationConfig("tiny", world_seed=42)).tables
    )
    lab, pipelines = tiny_world_lab(dataset_dir)
    return dataclasses.replace(lab, settings=dataclasses.replace(lab.settings, top_k=40)), pipelines


def test_a_is_unchanged_by_the_graph_layers(
    tiny_world: tuple[Lab, dict[str, GraphRagPipeline]],
) -> None:
    lab, pipelines = tiny_world
    reranker = RecordingReranker()
    a = lab.pipeline_a()
    a.reranker = reranker
    first = a.run(A_QUESTION)
    selected = [chunk.chunk_id for chunk in first.evidence if chunk.selected]
    assert selected == A_SELECTED
    # The cross-encoder order cut at the budget: every item that fits, in order.
    used, cut = 0, []
    for chunk in reranker.reranked:
        if used + block_tokens(chunk) <= 2000:
            used += block_tokens(chunk)
            cut.append(chunk.chunk_id)
    assert cut == A_SELECTED and len(reranker.reranked) > len(cut)
    for tag in ("B", "C"):
        pipelines[tag].run(A_QUESTION)
    again = a.run(A_QUESTION)
    assert [chunk.chunk_id for chunk in again.evidence if chunk.selected] == A_SELECTED


def test_b_and_c_extras_are_declared_and_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    """For the same evidence, B's and C's prompts differ from A's only by
    "reached from" lines; the extras are recorded as PROMPT_EXTRAS; B ranks
    target types without the ontology and C with it."""
    lab, b, c = two_record_lab()
    question = "Why did checkout fail in Greece?"
    a_blocks = {
        chunk.document_id: context_block(chunk) for chunk in lab.pipeline_a().run(question).evidence
    }
    matchers: list[Ontology | None] = []
    built = pipeline_module.TargetTypeMatcher

    def spy(ontology: Ontology | None) -> TargetTypeMatcher:
        matchers.append(ontology)
        return built(ontology)

    monkeypatch.setattr(pipeline_module, "TargetTypeMatcher", spy)
    for pipeline in (b, c):
        capture = PromptCapture()
        pipeline.generator = capture
        pipeline.run(question)
        assert capture.contexts
        same_evidence = [a_blocks[chunk.document_id] for chunk in capture.contexts]
        prompt_a = build_user_prompt(question, []).replace(
            "(no context retrieved)",
            "\n\n".join(f"[{n}] {block}" for n, block in enumerate(same_evidence, start=1)),
        )
        changed = [
            line[2:]
            for line in difflib.ndiff(prompt_a.splitlines(), capture.prompt.splitlines())
            if line.startswith(("+ ", "- "))
        ]
        assert changed, f"{pipeline.pipeline} must show a path line"
        assert all(line.startswith(PATH_LINE) for line in changed), changed
        assert all(line in capture.prompt for line in changed)
    assert matchers == [None, lab.ontology]
    fields = settings_fields(lab.settings, FakeJudge(), "smoke", 1)
    assert fields["prompt_extras"] == {extra: list(tags) for extra, tags in PROMPT_EXTRAS.items()}
    assert PROMPT_EXTRAS["path_line"] == ("B", "C")


def test_tiny_world_blocks_show_no_empty_scope_and_differ_only_by_the_path_line(
    tiny_world: tuple[Lab, dict[str, GraphRagPipeline]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Across the golden questions, every candidate block of A, B and C has
    no empty "()" or "(, " fragment, and a row B or C shows as a node reads
    exactly as A's record block for it, apart from the path line."""
    lab, pipelines = tiny_world
    a = lab.pipeline_a()
    checked = 0
    for _name, tag, question, markets in GOLDEN_QUESTIONS:
        records = {
            chunk.document_id: context_block(chunk)
            for chunk in a.run(question, markets or None).evidence
        }
        blocks = list(records.values())
        result, channel = graph_channel(pipelines[tag], question, monkeypatch, markets or None)
        blocks += [context_block(chunk) for chunk in [*result.document_evidence, *channel]]
        for block in blocks:
            assert not any(fragment in block for fragment in EMPTY_SCOPE), block
        for node in channel:
            if node.facts_heading is not None and node.document_id in records:
                block, paths = split_path_line(context_block(node))
                assert block == records[node.document_id]
                assert len(paths) == (1 if node.graph_path else 0)
                checked += 1
    assert checked >= 4
