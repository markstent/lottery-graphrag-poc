# Phase 2: Pipelines v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three retrieval pipelines a fair experiment: pipeline A gets the same warehouse access as B and C through serialised records, every pipeline shares hybrid retrieval, a cross-encoder reranker and one total context budget, pipeline C resolves local-language terms through the ontology term table, and every pipeline records a structured answer with parsed citations.

**Architecture:** The shared vector collection holds document chunks and serialised structured records with dense (bge-m3) and sparse (BM25) vectors; `VectorStore.search` fuses both by reciprocal rank fusion. A `Reranker` protocol has a cross-encoder implementation for runs and the lexical blend for CI. `select_context` is applied once per run over structured blocks then document candidates under one budget, with record blocks deduplicated against graph-reached nodes. Entity resolution splits into `IdEntityResolver` (A and B have no resolver; B uses ids and market aliases) and `TermEntityResolver` (C adds ontology terms and query expansion). Temporal validity reads real validity windows. Generation asks for a verdict, an answer and `[n]` citations and parses them.

**Tech Stack:** Python 3.13, uv, Qdrant 1.14 named vectors with sparse support, `fastembed` (new: BM25 sparse embeddings and ONNX cross-encoders), Ollama bge-m3, LiteLLM, pytest, ruff, mypy strict.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md` sections 5.4 and 10a (items 2, 3, 8); AGENTS.md "Experimental Integrity", "Standard RAG Rules", "GraphRAG Rules".

## Global Constraints

- All three pipelines are built from one lab object; A is B minus the graph layer and B is C minus the ontology layer, pinned by tests on the constructed objects.
- Same embedder, same sparse model, same reranker, same `top_k`, same total context budget in tokens, same evidence-slot count, same generator, prompt, temperature and maximum answer length for A, B and C.
- The serialiser for structured records is one fixed function per table; its wording is frozen once bank 2.0.0 is written (Phase 3) and never edited afterwards.
- Pipeline B resolves entities by exact id and market alias only; pipeline C adds the ontology term table; no pipeline splits description words into keywords.
- Retrieval code never imports `app.evaluation`; the term table is built from the ontology and master data only (`app/ontology/terms.py`, `taxonomies.local_name_variants()`).
- CI uses deterministic fakes: `HashingEmbedder`, a deterministic sparse fake, the lexical reranker, `FakeAnswerGenerator`; no live model in CI.
- Dependencies: `fastembed` is the only new runtime dependency (sparse BM25 and cross-encoder in one maintained ONNX library, no torch); recorded as D-021.
- Every new configuration value has an environment variable in `.env.example` and a documented default.
- Run before every commit from `backend/`: `uv run ruff format . && uv run ruff check . && uv run mypy && uv run pytest -q`; all green; commit messages carry no co-author line.
- Markdown edits: one sentence per line, plain dashes, British spelling.

## Review Focus

1. A question in Greek or German that names a product by its local display name must resolve a concept in pipeline C and must still retrieve documents in pipeline A through the sparse channel; test in Task 7 (resolver) and Task 3 (hybrid search with a Greek query against a Greek chunk).
2. A record block and a graph node for the same record must occupy one context slot, with the structured fact winning; test in Task 6.
3. When structured blocks alone exceed the total budget, document context must be empty and the budget never exceeded; test in Task 6.
4. A model answer that is not valid JSON must still produce an answer record with an empty verdict and citations parsed from `[n]` markers, never an exception or a fabricated verdict; test in Task 9.
5. A Qdrant collection built with only dense vectors must fail loudly at index-manifest check time rather than silently returning dense-only results; test in Task 4.

---

## File structure

Created:

- `backend/app/retrieval/standard/records.py`: record serialiser (`RecordBlock`, `serialise_records`).
- `backend/app/retrieval/standard/sparse.py`: `SparseVector`, `SparseEmbedder` protocol, `FastembedBm25Embedder`, `HashingSparseEmbedder`.
- `backend/app/retrieval/standard/fusion.py`: `reciprocal_rank_fusion`.
- `backend/app/retrieval/graph/resolution.py`: `IdEntityResolver`, `TermEntityResolver`, `QueryExpansion` (replaces `entities.py`, which is deleted).
- `backend/tests/test_records.py`, `test_sparse_and_fusion.py`, `test_rerank_cross_encoder.py`, `test_context_budget_v2.py`, `test_resolution.py`, `test_generation_v2.py`.

Modified:

- `backend/app/retrieval/standard/{vector_store,embeddings,reranking,context,generation,index,corpus,pipeline}.py`
- `backend/app/retrieval/graph/{pipeline,ranking,traversal,neo4j_adapter,source_lookup,lab,traces}.py`
- `backend/app/config/__init__.py`, `backend/app/evidence/__init__.py`, `backend/app/events/__init__.py`
- `backend/app/datasets/operations.py` (deferred defect), `backend/app/evaluation/runner.py` (record fields only)
- `backend/pyproject.toml`, `.env.example`, `Makefile`, `docs/retrieval/*.md`, `DECISIONS.md`, `HITL_STATUS.md`

---

### Task 1: Deferred generator defect: incidents reference released, same-market app versions

**Files:**

- Modify: `backend/app/datasets/operations.py:generate_incidents`
- Modify: `backend/app/datasets/validation.py:_time_errors`
- Modify: `backend/tests/fixtures/golden/tiny-seed7.json` (regenerated)
- Test: `backend/tests/test_validation.py`

**Interfaces:**

- Rule: an incident on an app platform gets `app_version_id` drawn from the versions of its own market (corporate incidents with `market_id None` draw from the version's market and record nothing further) released on or before `started_at`; if none qualifies, `app_version_id` is `None`.
- Validation: `incidents.app_version_id` must belong to the incident's market when the incident has one, and must be released on or before `started_at`.

- [ ] **Step 1: Write the failing tests**

```python
def test_incident_app_versions_are_released_and_same_market(tiny_world: World) -> None:
    versions = {v.app_version_id: v for v in tiny_world.tables["app_versions"]}
    for incident in tiny_world.tables["incidents"]:
        if incident.app_version_id is None:
            continue
        version = versions[incident.app_version_id]
        assert version.released_at <= incident.started_at
        if incident.market_id is not None:
            assert version.market_id == incident.market_id
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_validation.py -k incident_app_versions -v`
Expected: FAIL

- [ ] **Step 3: Implement the rule and the validation check; regenerate the golden fixture with `uv run python -m scripts.golden --profile tiny --world-seed 7 --scenario-seed 7 --out tests/fixtures/golden/tiny-seed7.json`**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_validation.py tests/test_golden_world.py tests/test_scenarios_v2.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/datasets/operations.py backend/app/datasets/validation.py backend/tests/test_validation.py backend/tests/fixtures/golden/tiny-seed7.json
git commit -m "fix(datasets): incidents reference released app versions of their own market"
```

---

### Task 2: Record serialiser

**Files:**

- Create: `backend/app/retrieval/standard/records.py`
- Modify: `backend/app/retrieval/standard/corpus.py` (`CorpusChunk` gains `kind: str = "chunk"` and `record_table: str | None = None`; `load_corpus` unchanged)
- Modify: `backend/app/evidence/__init__.py` (`EvidenceChunk` gains `kind: str = "chunk"`, `record_table: str | None = None`)
- Test: `backend/tests/test_records.py`

**Interfaces:**

- `RecordBlock(record_id: str, table: str, market_id: str | None, text: str, source_system: str, valid_from: str | None, valid_to: str | None)` frozen dataclass with `to_corpus_chunk() -> CorpusChunk` (`chunk_id = f"REC_{table}_{record_id}"`, `document_id = record_id`, `chunk_index = 0`, `title = f"{table}: {record_id}"`, `document_type = table.upper()`, `language_code = "en"`, `kind = "record"`, `record_table = table`).
- `serialise_records(dataset_dir: Path) -> list[RecordBlock]`: one block per row of `games`, `platform_versions`, `incidents`, `campaigns`, `player_segments`, `payment_providers`, `app_versions`, `game_families`, `game_mechanics`, `incident_types`, `support_categories`; plus the planted-pattern carriers from design 10a.2: every `devices` row used by more than one player (with its player ids), every `payment_methods` row used by more than one player (with its player ids), and every `players` row that takes part in such a share. Read with DuckDB, deterministic order by table then id.
- Serialisation template per table is one f-string in a `SERIALISERS: dict[str, Callable[[dict], str]]` registry; the game template reads: `"{game_name} ({game_id}) is a {family_name} game in {market_name}. Ticket price {ticket_price} {currency_code}. Category {category_name}. Mechanics: {mechanic_names}. Channels: {channels}. Launched {launch_date}. Status {status}."` with local names joined from the taxonomy tables; the other templates follow the same shape (name, id, market, the record's facts, dates). Shared device: `"Device {device_id} ({device_family}) is used by {n} player accounts: {player_ids}."`; shared payment method likewise.
- `records_manifest(blocks) -> dict` with counts per table.

- [ ] **Step 1: Write the failing tests** (fixture: tiny world written to `tmp_path` with `write_world`)

```python
def test_serialises_every_catalogue_record_once(world_dir: Path) -> None:
    blocks = serialise_records(world_dir)
    by_table = Counter(block.table for block in blocks)
    assert by_table["games"] == 20 and by_table["payment_providers"] == 6
    assert len({b.record_id for b in blocks if b.table == "games"}) == 20

def test_game_block_names_local_family_and_price(world_dir: Path) -> None:
    block = next(b for b in serialise_records(world_dir) if b.record_id == "GAME_AT_01")
    assert "Zahlenziehung" in block.text and "2.50 EUR" in block.text and "GAME_AT_01" in block.text

def test_shared_devices_and_instruments_become_blocks_with_their_players(world_dir: Path) -> None:
    blocks = [b for b in serialise_records(world_dir) if b.table in ("devices", "payment_methods")]
    assert blocks and all("player accounts" in b.text for b in blocks)

def test_record_block_to_corpus_chunk_is_marked_as_record(world_dir: Path) -> None:
    chunk = serialise_records(world_dir)[0].to_corpus_chunk()
    assert chunk.kind == "record" and chunk.chunk_id.startswith("REC_")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_records.py -v`
Expected: FAIL (`ModuleNotFoundError`)

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_records.py tests/test_standard_rag.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/standard/records.py backend/app/retrieval/standard/corpus.py backend/app/evidence/__init__.py backend/tests/test_records.py
git commit -m "feat(retrieval): serialised structured records for the shared vector collection"
```

---

### Task 3: Sparse embeddings and reciprocal rank fusion

**Files:**

- Create: `backend/app/retrieval/standard/sparse.py`, `backend/app/retrieval/standard/fusion.py`
- Modify: `backend/pyproject.toml` (add `fastembed>=0.9.0`), `backend/app/config/__init__.py` (`EmbeddingSettings` gains `sparse_provider: str` ("fastembed" | "hashing") and `sparse_model: str` default `"Qdrant/bm25"`; env `SPARSE_PROVIDER`, `SPARSE_MODEL`), `.env.example`
- Test: `backend/tests/test_sparse_and_fusion.py`

**Interfaces:**

- `SparseVector(indices: tuple[int, ...], values: tuple[float, ...])` frozen dataclass.
- `SparseEmbedder` protocol: `model_name: str`; `embed_documents(texts: list[str]) -> list[SparseVector]`; `embed_query(text: str) -> SparseVector`.
- `FastembedBm25Embedder(model: str = "Qdrant/bm25")` wrapping `fastembed.SparseTextEmbedding` (lazy import; `cache_dir` from env `FASTEMBED_CACHE` default `~/.cache/fastembed`).
- `HashingSparseEmbedder(dimensions: int = 2**20)`: deterministic BM25-style term weights over the Unicode `\w+` tokeniser with IDF fixed at 1 (CI fake; monotone in term frequency).
- `reciprocal_rank_fusion(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]` sorted by fused score desc then id.
- `RRF_K = 60` in `fusion.py` with a comment.

- [ ] **Step 1: Write the failing tests**

```python
def test_hashing_sparse_is_deterministic_and_term_weighted() -> None:
    e = HashingSparseEmbedder()
    a, b = e.embed_documents(["draw draw game", "draw game"])
    assert a == e.embed_documents(["draw draw game"])[0]
    assert max(a.values) > max(b.values)

def test_greek_query_matches_greek_document_sparsely() -> None:
    e = HashingSparseEmbedder()
    q = e.embed_query("Στιγμιαίο Λαχείο")
    d = e.embed_documents(["Το Στιγμιαίο Λαχείο πωλείται στα πρακτορεία."])[0]
    assert set(q.indices) & set(d.indices)

def test_rrf_prefers_items_high_in_both_rankings() -> None:
    fused = reciprocal_rank_fusion([["a", "b", "c"], ["b", "a", "d"]])
    assert [i for i, _ in fused][:2] == ["a", "b"] or [i for i, _ in fused][:2] == ["b", "a"]
    assert fused[0][1] > fused[-1][1]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_sparse_and_fusion.py -v`
Expected: FAIL

- [ ] **Step 3: Implement; `uv add fastembed`; commit `uv.lock`**

- [ ] **Step 4: Run tests and mypy**

Run: `cd backend && uv run pytest tests/test_sparse_and_fusion.py -v && uv run mypy`
Expected: PASS (add a `[[tool.mypy.overrides]]` for `fastembed.*` if it ships no types)

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/standard/sparse.py backend/app/retrieval/standard/fusion.py backend/app/config/__init__.py backend/pyproject.toml backend/uv.lock .env.example backend/tests/test_sparse_and_fusion.py
git commit -m "feat(retrieval): sparse BM25 embeddings and reciprocal rank fusion"
```

---

### Task 4: Hybrid vector store and index builder v2

**Files:**

- Modify: `backend/app/retrieval/standard/vector_store.py`, `backend/app/retrieval/standard/index.py`, `backend/app/retrieval/standard/__main__.py`
- Modify: `backend/app/config/__init__.py` (`top_k` default 40; env `RAG_TOP_K`)
- Test: `backend/tests/test_standard_rag.py` (store tests), `backend/tests/test_vector_store_qdrant.py` (live)

**Interfaces:**

- `VectorStore.upsert(ids, dense: list[list[float]], sparse: list[SparseVector], payloads)`.
- `VectorStore.search(dense: list[float], sparse: SparseVector, limit: int, markets: Sequence[str] | None = None, kinds: Sequence[str] | None = None) -> list[SearchHit]` with `SearchHit(id: str, score: float, dense_rank: int | None, sparse_rank: int | None, payload: dict)`; the store runs a dense top-`limit` and a sparse top-`limit` within the same filter and fuses with `reciprocal_rank_fusion`; `score` is the fused score.
- `QdrantVectorStore` uses named vectors `dense` (cosine, `dimensions`) and `sparse` (Qdrant `SparseVectorParams`); `ensure_collection` creates both; `search` uses `query_points` with two `Prefetch` entries and `FusionQuery(fusion=Fusion.RRF)`; `collection_info() -> dict` reports vector names, so `build_index` can refuse a dense-only collection.
- `InMemoryVectorStore` keeps dense cosine plus sparse dot product and fuses in Python.
- `build_index(settings)` indexes `load_corpus()` chunks plus `serialise_records()` blocks as corpus chunks (`kind="record"`), dense and sparse; `vector-index.json` gains `record_count`, `sparse_model`, `vector_names`; `build_index` raises `RuntimeError("collection lacks a sparse vector; rebuild")` when `collection_info()` lacks `sparse`.
- `IndexedCorpus = dict[str, CorpusChunk]` loaded by the lab from chunks plus records so every hit resolves to a chunk (removes the silent-drop difference between A and B/C).

- [ ] **Step 1: Write the failing tests**

```python
def test_in_memory_hybrid_search_fuses_dense_and_sparse() -> None:
    store = InMemoryVectorStore()
    dense = HashingEmbedder(64); sparse = HashingSparseEmbedder()
    texts = ["payment checkout failure in Greece", "retail terminal outage in Prague", "Στιγμιαίο Λαχείο κανόνες"]
    store.upsert([f"c{i}" for i in range(3)], dense.embed(texts), sparse.embed_documents(texts), [{"market_id": "MKT_GR", "kind": "chunk"}] * 3)
    hits = store.search(dense.embed(["Στιγμιαίο Λαχείο"])[0], sparse.embed_query("Στιγμιαίο Λαχείο"), limit=3)
    assert hits[0].id == "c2" and hits[0].sparse_rank == 1

def test_kind_filter_restricts_to_records() -> None: ...

def test_build_index_refuses_dense_only_collection(monkeypatch) -> None: ...
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_standard_rag.py -k "hybrid or kind_filter or dense_only" -v`
Expected: FAIL

- [ ] **Step 3: Implement; update the live Qdrant test for named vectors**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_standard_rag.py tests/test_records.py -q`
Run (live, services up): `cd backend && VECTOR_E2E=1 uv run pytest tests/test_vector_store_qdrant.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/standard backend/app/config/__init__.py backend/tests
git commit -m "feat(retrieval): hybrid dense plus sparse vector store and index with record blocks"
```

---

### Task 5: Cross-encoder reranker

**Files:**

- Modify: `backend/app/retrieval/standard/reranking.py`
- Modify: `backend/app/config/__init__.py` (`RerankSettings` becomes `provider: str` ("lexical" | "cross_encoder"), `model: str` default `"jinaai/jina-reranker-v2-base-multilingual"`, `lexical_weight: float`, `candidates: int` default 40; env `RERANK_PROVIDER`, `RERANK_MODEL`, `RERANK_CANDIDATES`), `.env.example`
- Modify: `backend/app/retrieval/standard/index.py:build_reranker(settings) -> Reranker`
- Test: `backend/tests/test_rerank_cross_encoder.py`

**Interfaces:**

- `Reranker` protocol moves to `reranking.py`: `model_name: str`; `rerank(question: str, candidates: list[EvidenceChunk]) -> list[EvidenceChunk]` setting `rerank_score` and `rank`.
- `CrossEncoderReranker(model: str)` wrapping `fastembed.TextCrossEncoder` (lazy import); scores all candidates in one call; ties broken by `chunk_id`; `model_name = model`.
- `LexicalReranker` keeps its behaviour and gains `model_name = f"lexical(w={weight})"`.
- The builder verifies the model name is in `fastembed.TextCrossEncoder.list_supported_models()` and raises `ValueError` naming the supported multilingual options otherwise.
- The reproducibility record's `reranker` field becomes `reranker.model_name`.

- [ ] **Step 1: Write the failing tests**

```python
def test_cross_encoder_builder_rejects_unknown_model() -> None:
    with pytest.raises(ValueError, match="supported"):
        build_reranker(make_settings(rerank=RerankSettings(provider="cross_encoder", model="nope", lexical_weight=0.3, candidates=40)))

@pytest.mark.skipif(os.environ.get("RERANK_E2E") != "1", reason="downloads a model")
def test_cross_encoder_ranks_relevant_passage_first() -> None:
    r = CrossEncoderReranker("jinaai/jina-reranker-v2-base-multilingual")
    out = r.rerank("payment checkout failure", [chunk("a", "retail terminal outage"), chunk("b", "payment checkout failures on the app")])
    assert out[0].chunk_id == "b" and out[0].rank == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_rerank_cross_encoder.py -v`
Expected: FAIL

- [ ] **Step 3: Implement; run the `RERANK_E2E=1` test once locally and record the model download size in the report**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_rerank_cross_encoder.py tests/test_standard_rag.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/standard/reranking.py backend/app/retrieval/standard/index.py backend/app/config/__init__.py .env.example backend/tests/test_rerank_cross_encoder.py
git commit -m "feat(retrieval): cross-encoder reranker shared by every pipeline"
```

---

### Task 6: One total context budget and record deduplication

**Files:**

- Modify: `backend/app/retrieval/standard/context.py`, `backend/app/retrieval/standard/pipeline.py`, `backend/app/retrieval/graph/pipeline.py`
- Modify: `backend/app/config/__init__.py` (`ContextSettings` gains `evidence_slots: int` default 12, env `RAG_EVIDENCE_SLOTS`; `GraphRagSettings.max_evidence_nodes` is removed in favour of it)
- Test: `backend/tests/test_context_budget_v2.py`

**Interfaces:**

- `select_context(candidates, budget_tokens, dedupe_threshold, max_items) -> (selected, discarded)` gains `max_items` (the evidence-slot cap) and a discard reason `"slot_limit"`.
- `assemble_context(structured: list[EvidenceChunk], documents: list[EvidenceChunk], settings: ContextSettings) -> ContextAssembly` in `context.py`: runs `select_context` over `structured` first, then over `documents` with the remaining budget and slots; `ContextAssembly(structured_selected, document_selected, discarded, context_tokens)`.
- Deduplication (design 10a.8): before assembly the graph pipeline drops any document candidate with `kind == "record"` whose `document_id` equals a selected structured node id, recording `discard_reason = "superseded_by_structured_fact"`.
- Pipeline A calls `assemble_context([], candidates, settings.context)`; B and C call it with their structured blocks as `EvidenceChunk(kind="node", chunk_id=node_id, document_id=node_id, text=evidence_snippet(...), rank=position)`; `context_tokens` is the single reported figure for every pipeline.

- [ ] **Step 1: Write the failing tests**

```python
def test_structured_blocks_count_against_the_same_budget() -> None:
    structured = [node_chunk(f"n{i}", words=200) for i in range(3)]
    docs = [doc_chunk(f"d{i}", words=200) for i in range(3)]
    result = assemble_context(structured, docs, ContextSettings(budget_tokens=300, dedupe_threshold=0.85, evidence_slots=12))
    assert result.context_tokens <= 300 and not result.document_selected

def test_slot_limit_applies_across_structured_and_documents() -> None: ...

def test_record_block_for_a_selected_node_is_superseded(graph_pipeline) -> None:
    run = graph_pipeline.run("What is the price of GAME_GR_01?")
    reasons = {c.chunk_id: c.discard_reason for c in run.document_evidence}
    assert reasons.get("REC_games_GAME_GR_01") == "superseded_by_structured_fact"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_context_budget_v2.py -v`
Expected: FAIL

- [ ] **Step 3: Implement; update `test_graph_rag.py` and `test_standard_rag.py` expectations (`max_evidence_nodes` references, context token sums)**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_context_budget_v2.py tests/test_graph_rag.py tests/test_standard_rag.py tests/test_lab_fairness.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval backend/app/config/__init__.py backend/tests
git commit -m "feat(retrieval): one total context budget and evidence-slot cap for every pipeline"
```

---

### Task 7: Entity resolution v2 and query expansion

**Files:**

- Create: `backend/app/retrieval/graph/resolution.py`
- Delete: `backend/app/retrieval/graph/entities.py`
- Modify: `backend/app/retrieval/graph/neo4j_adapter.py` (`build_resolvers(reader, ontology) -> tuple[IdEntityResolver, TermEntityResolver]`), `backend/app/retrieval/graph/lab.py`, `backend/app/retrieval/graph/pipeline.py`
- Test: `backend/tests/test_resolution.py`, `backend/tests/test_graph_rag.py`

**Interfaces:**

- `ResolvedEntity(entity_id, node_label, matched_text, origin, confidence, via_concept: str | None = None)`.
- `IdEntityResolver(lookup_node, market_aliases)`: ids by the existing regex and prefixes, market aliases whole-word; no concepts.
- `TermEntityResolver(inner: IdEntityResolver, matcher: TermMatcher, bindings: Ontology, market_hint: Callable[[str], str | None])`: runs `inner`, then `matcher.match(question)`; each `TermMatch` yields the concept (`origin="term"`, `confidence=0.8`) and, when the term is a `local_name` term or the question resolves a market, the bound local code node of that market via `ontology.codes_for(concept_id)` (`origin="concept_binding"`, `via_concept=concept_id`, `confidence=0.7`); duplicates removed, order stable.
- `QueryExpansion(ontology)`: `expand(question, resolved) -> str` returning the question followed by the canonical names and the four-language labels and synonyms of resolved concepts, each once, so the document channel of pipeline C embeds the expanded text for both dense and sparse queries; B and A embed the raw question.
- Pipelines: A has no resolver; B uses `IdEntityResolver`; C uses `TermEntityResolver` and `QueryExpansion`; the lab builds both resolvers once from the reader plus `load_ontology()` and `taxonomies.local_name_variants()`; `pipeline.py` no longer filters `BusinessConcept` seeds for B (B never produces them).
- Telemetry: `graph.entity.resolved` payload gains `via_concept`; a new `graph.query.expanded` event carries `added_terms` count and the expanded text length; `graph.node.discovered` gains `via_concept` for nodes injected by ontology expansion.
- Ontology expansion ranking: `expand_ontology` takes `semantic: Callable[[list[str]], list[float]]` and keeps at most `max_edges_per_node_type` bound entities per concept ordered by semantic relevance to the (expanded) question, ties by id.

- [ ] **Step 1: Write the failing tests**

```python
def test_b_resolver_resolves_ids_and_markets_only() -> None:
    r = IdEntityResolver(lookup_node=lambda i: ("Incident", True) if i == "INC_026" else None, market_aliases={"greece": "MKT_GR"})
    out = r.resolve("Did INC_026 in Greece involve Zahlenziehung?")
    assert [e.entity_id for e in out] == ["INC_026", "MKT_GR"]

def test_c_resolver_maps_local_term_to_concept_and_bound_code() -> None:
    out = c_resolver().resolve("Wie läuft die Zahlenziehung in Österreich?")
    ids = {e.entity_id for e in out}
    assert {"CONCEPT_NATIONAL_DRAW", "FAM_AT_ZAHLENZIEHUNG", "MKT_AT"} <= ids
    assert next(e for e in out if e.entity_id == "FAM_AT_ZAHLENZIEHUNG").via_concept == "CONCEPT_NATIONAL_DRAW"

def test_query_expansion_adds_labels_once() -> None:
    text = QueryExpansion(load_ontology()).expand("Στιγμιαίο Λαχείο", [concept("CONCEPT_RETAIL_INSTANT")])
    assert text.count("Rubbellos") == 1 and "Scratchcard" in text

def test_ontology_expansion_is_ranked_and_capped() -> None: ...
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_resolution.py -v`
Expected: FAIL

- [ ] **Step 3: Implement; port the resolver tests at the bottom of `test_graph_rag.py` to `test_resolution.py`; delete `entities.py`**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_resolution.py tests/test_graph_rag.py tests/test_lab_fairness.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/graph backend/tests
git rm backend/app/retrieval/graph/entities.py
git commit -m "feat(retrieval): id resolver for B, ontology term resolver and query expansion for C"
```

---

### Task 8: Temporal validity from real validity windows

**Files:**

- Modify: `backend/app/retrieval/graph/ranking.py`, `backend/app/retrieval/graph/source_lookup.py`, `backend/app/retrieval/graph/pipeline.py`
- Modify: `backend/app/config/__init__.py` (`GraphRagSettings.reference_date: date` default `WINDOW_START + WINDOW_DAYS`, env `GRAPH_REFERENCE_DATE`)
- Test: `backend/tests/test_graph_rag.py`

**Interfaces:**

- `source_lookup.VALID_TO_COLUMNS: dict[str, str]` (`Game: retirement_date`, `PlatformVersion: retired_at`, `Incident: resolved_at` is NOT a validity end (an incident record stays valid), `Campaign: end_at`, `Experiment: end_at`, `Document: valid_to`); `AuthoritativeFacts.valid_to -> date | None`.
- `ranking.temporal_validity(valid_to: date | None, reference: date) -> float`: `1.0` when `valid_to is None or valid_to >= reference`, else `0.3`; `score_nodes(..., validity: dict[str, date | None], reference: date)`.
- The pipeline passes `validity` from the facts it already fetches for `_node_texts`.
- The evidence-ranking document's description of this component becomes true.

- [ ] **Step 1: Write the failing test**

```python
def test_superseded_record_ranks_lower_than_current() -> None:
    reference = date(2026, 1, 1)
    assert temporal_validity(date(2025, 6, 1), reference) == 0.3
    assert temporal_validity(None, reference) == 1.0
    assert temporal_validity(date(2026, 1, 1), reference) == 1.0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_graph_rag.py -k superseded -v`
Expected: FAIL (signature)

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_graph_rag.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/graph backend/app/config/__init__.py backend/tests/test_graph_rag.py
git commit -m "feat(retrieval): temporal validity ranks superseded records from real validity windows"
```

---

### Task 9: Structured answers with parsed citations

**Files:**

- Modify: `backend/app/retrieval/standard/generation.py`, `backend/app/evidence/__init__.py` (`RagAnswer` gains `verdict: str`, `cited_blocks: list[int]`, `raw_text: str`), `backend/app/config/__init__.py` (`GenerationSettings.max_tokens: int` default 600, env `GENERATION_MAX_TOKENS`; `PROMPT_VERSION = "2.0.0"` constant in `generation.py`)
- Test: `backend/tests/test_generation_v2.py`

**Interfaces:**

- `_SYSTEM_PROMPT` v2 asks for a JSON object `{"verdict": "<one line, or 'unknown' when the sources do not answer>", "answer": "<prose with [n] citations>"}`; `parse_answer(raw: str, block_count: int) -> ParsedAnswer(verdict, answer, cited_blocks)`: strict JSON first, then a fenced-JSON fallback, then plain text (`verdict=""`, `answer=raw`); `cited_blocks` are the `[n]` integers in `answer` within `1..block_count`, deduplicated in order.
- `AnswerGenerator.generate(...) -> GenerationOutput(raw_text, latency_ms)`; pipelines call `parse_answer` and fill `RagAnswer`.
- `LiteLLMAnswerGenerator` passes `max_tokens`, `temperature`, and records `response.usage` tokens when present (`RagAnswer.usage: dict[str, int] | None`).
- `FakeAnswerGenerator` returns valid JSON citing `[1]` when context exists.

- [ ] **Step 1: Write the failing tests**

```python
def test_parse_answer_reads_json_and_citations() -> None:
    parsed = parse_answer('{"verdict": "yes", "answer": "Price is 2.50 [2] and [9]."}', block_count=3)
    assert parsed.verdict == "yes" and parsed.cited_blocks == [2]

def test_parse_answer_falls_back_to_plain_text() -> None:
    parsed = parse_answer("The price is 2.50 [1].", block_count=2)
    assert parsed.verdict == "" and parsed.answer.startswith("The price") and parsed.cited_blocks == [1]

def test_fake_generator_emits_json_with_a_citation() -> None: ...
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_generation_v2.py -v`
Expected: FAIL

- [ ] **Step 3: Implement; update pipelines, runner (`prompt_version` in the record), API schema passthrough (RagAnswer is already the DTO)**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(retrieval): structured answers with verdict and parsed citations"
```

---

### Task 10: Event envelope v2

**Files:**

- Modify: `backend/app/events/__init__.py`, `backend/app/api/schemas.py`, `backend/app/api/runs.py`
- Test: `backend/tests/test_api_queries.py`, `backend/tests/test_standard_rag.py`

**Interfaces:**

- `RetrievalEvent` gains `event_id: str` (uuid4 hex) and `timestamp: str` (ISO 8601 UTC) set by the emitter; `RecordedEvent` carries both; the API attaches events unchanged.

- [ ] **Step 1: Write the failing test**

```python
def test_recorded_events_carry_ids_and_timestamps(client) -> None:
    run_id = client.post("/api/v1/queries", json={"question": "What is the price of GAME_UK_01?", "configurations": ["A"]}).json()["run_id"]
    events = wait_for(client, run_id)["events"]
    assert all(e["event_id"] and e["timestamp"].endswith("+00:00") for e in events)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_api_queries.py -k timestamps -v`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_api_queries.py tests/test_standard_rag.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/events/__init__.py backend/app/api backend/tests
git commit -m "feat(events): event ids and timestamps on every recorded event"
```

---

### Task 11: Lab fairness v2

**Files:**

- Modify: `backend/app/retrieval/graph/lab.py` (`Lab` holds `dense`, `sparse`, `reranker`, `store`, `corpus` (chunks plus records), `source_lookup`, `generator`, `ontology`, `resolvers`; `pipeline_a()`, `wired_pipelines()`)
- Test: `backend/tests/test_lab_fairness.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_a_b_c_share_every_retrieval_component(lab, wired) -> None:
    a = lab.pipeline_a(); b, c = (p for _, p in wired.pipelines)
    for attr in ("embeddings", "sparse", "reranker", "store", "corpus", "generator"):
        assert getattr(a, attr) is getattr(b, attr) is getattr(c, attr)
    assert a.settings.top_k == b.settings.top_k == c.settings.top_k
    assert a.settings.context == b.settings.context == c.settings.context

def test_b_has_no_term_resolver_and_c_has_one(wired) -> None: ...
```

- [ ] **Step 2: Run to verify failure, implement, run green, commit**

```bash
git commit -m "test(retrieval): fairness contract pins shared components across A, B and C"
```

---

### Task 12: Live index and trace run

**Files:**

- Modify: `backend/app/retrieval/graph/traces.py` (questions become the four saved demo questions from `app/api/queries.py`, imported, with the stale ids removed from DEMO-02 and DEMO-03 replaced by descriptions plus the ids that exist in the dev world: read `data/generated/dev-seed2026/_manifest.json` scenarios and pick ids by querying Parquet, never the ledger), `Makefile` (`index-vector` unchanged; add `pull-models: ollama pull bge-m3`)
- Docs: `docs/retrieval/example-traces.md` regenerated from the trace CLI (fake generator) and committed

- [ ] **Step 1: `ollama pull bge-m3`; `make index-vector`; verify `vector-index.json` has `record_count > 0` and `vector_names` includes `sparse`**
- [ ] **Step 2: `cd backend && VECTOR_E2E=1 GRAPH_E2E=1 uv run pytest tests/test_vector_store_qdrant.py tests/test_graph_rag_live.py tests/test_api_live.py tests/test_benchmark_live.py -q`; re-ingest the graph afterwards**
- [ ] **Step 3: `uv run python -m app.retrieval.graph.traces --generator fake > ../docs/retrieval/example-traces.md`; read it and confirm pipeline C shows `graph.query.expanded` and `via_concept` on a Greek or German question**
- [ ] **Step 4: Commit**

```bash
git add backend/app/retrieval/graph/traces.py Makefile docs/retrieval/example-traces.md
git commit -m "chore(retrieval): v2 trace run against the live index and graph"
```

---

### Task 13: Documentation and decisions

**Files:**

- Modify: `docs/retrieval/standard-rag.md`, `graph-rag.md`, `evidence-ranking.md`, `context-budgeting.md`, `retrieval-fairness.md`, `reranking.md`, `embeddings.md` (as-built v2 sections), `DECISIONS.md` (D-021 fastembed; D-022 hybrid RRF; D-023 one total budget and slot cap; D-024 structured answer prompt v2), `HITL_STATUS.md` (CP1 part 2 presented), `.env.example` verified complete

- [ ] **Step 1: Write; grep for `max_evidence_nodes`, `lexical(w=`, `entities.py` in docs and fix**
- [ ] **Step 2: Commit**

```bash
git add docs DECISIONS.md HITL_STATUS.md .env.example
git commit -m "docs: retrieval v2 as built"
```

---

## Self-review notes

- Spec 5.4 coverage: shared components (Tasks 3, 4, 5, 11), A's structured access (Task 2, 4), hybrid (Tasks 3, 4), reranker (Task 5), one budget and slots (Task 6), structured prompt (Task 9), B id-only resolution (Task 7), temporal validity (Task 8), C term table and expansion and ranked concept expansion (Task 7), telemetry attribution (Task 7, 10), dedupe rule 10a.8 (Task 6), 10a.2 carriers (Task 2).
- Type names chained across tasks: `SparseVector`, `SparseEmbedder`, `SearchHit`, `Reranker`, `ContextAssembly`, `ResolvedEntity.via_concept`, `ParsedAnswer`, `GenerationOutput`; check each later task against the first definition.
- Not in this plan: bank 2.0.0, judge, statistics (Phase 3); API data-model and streaming endpoints (Phase 4).
