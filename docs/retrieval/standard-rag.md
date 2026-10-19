# Standard RAG

Pipeline:

```text
question
 -> dense + sparse (BM25) embedding
 -> hybrid search (dense top-k + sparse top-k, reciprocal rank fusion)
 -> top-k
 -> optional reranking
 -> context budget selection
 -> LLM
 -> answer + citations
```

The baseline must be competitive.

Record every candidate and selected chunk.

Do not deliberately weaken chunking, top-k, reranking or prompts.

## Implementation (Phase 8)

Code lives in `backend/app/retrieval/standard/`.

- **Chunking** comes from the generation-time chunker
  (`app/datasets/util.py::chunk_text`, sentence-grouped); the vector index and
  all pipelines consume `document_chunks.parquet` as the single corpus source
  (docs/retrieval/retrieval-fairness.md).
- **Embeddings**: `embeddings.py` adapts Ollama (default model `bge-m3`,
  1024d, multilingual el/de/cs/en) and a deterministic token-hashing fake
  (`HashingEmbedder`) used by CI and tests.
- **Indexed corpus**: document chunks plus the serialised structured records
  (`records.py`, `kind="record"`) are indexed side by side in one collection.
  The lab loads the same chunks-plus-records corpus (`load_indexed_corpus`) so
  every hit resolves to a chunk for pipelines A, B and C alike.
  Documents and records without a market carry `market_id == ""`.
- **Sparse embeddings**: `sparse.py` adapts fastembed BM25 (`Qdrant/bm25`)
  and a deterministic hashing fake. `SPARSE_PROVIDER` unset follows
  `EMBEDDING_PROVIDER` (`hashing` -> `hashing`, anything else -> `fastembed`).
- **Vector store**: `vector_store.py` adapts Qdrant (shared collection,
  ADR-002; external chunk ids map to deterministic UUID point ids) plus an
  in-memory store for tests. Each point has a named dense vector `dense`
  (cosine) and a named sparse vector `sparse` (Qdrant applies the IDF
  modifier, which fastembed BM25 requires). `search(dense, sparse, limit,
  markets, kinds)` runs a dense and a sparse top-`limit` inside the same
  filter and fuses them with reciprocal rank fusion (Qdrant: `query_points`
  with two `Prefetch` entries and `FusionQuery(fusion=Fusion.RRF)`; in
  memory: `fusion.reciprocal_rank_fusion`). A hit's `score` is the fused
  score and becomes `EvidenceChunk.similarity`.
  Since hybrid retrieval, `similarity` is the fused reciprocal-rank score of
  the dense and sparse channels, not a cosine.
  The RRF constant (`fusion.RRF_K = 1` with 1-based ranks) matches Qdrant's
  server-side `Fusion.RRF` (`1 / (position + 2)`, 0-based) so both stores
  rank and score identically; a live test checks the parity. The in-memory store also
  reports each hit's `dense_rank`/`sparse_rank`; Qdrant fuses server side
  and does not expose them (`None`). Both ranks are copied onto
  `EvidenceChunk` and the `rag.candidate.retrieved` event.
  Every pipeline builds evidence from the hit payload through the shared
  `corpus.hit_to_evidence`, so no hit is dropped for lack of a corpus entry. A market scope matches only non-empty
  market ids, so market-less items are excluded from scoped runs for every
  pipeline. `top_k` defaults to 40 (`RAG_TOP_K`).
- **Reranking**: `reranking.py` blends the incoming rank with lexical
  overlap, `score = (1 - w) * (1 / rank_in) + w * overlap` (w = 0.3 by
  default); it blends on rank because the fused score is not on the scale of
  overlap; disabled and enabled modes both record per-candidate
  scores. The graph pipeline gets an equivalent candidate-ranking opportunity.
- **Context budget**: `context.py` walks candidates in rank order within a
  token budget (default 2000), skipping near-duplicates (Jaccard >= 0.85);
  discarded chunks carry `context_budget` or `duplicate` reasons.
- **Generation**: `generation.py` implements the ADR-003 gateway contract with
  a deterministic `FakeAnswerGenerator` (CI default) and a LiteLLM adapter
  (`GENERATION_PROVIDER=litellm`). Citations are derived from the selected
  context by the pipeline, never parsed from model output.
- **Telemetry**: `pipeline.py` emits the full `rag.*` event sequence from
  docs/07 section 7 into an `EventSink`; every candidate carries similarity,
  rank, rerank score and selected/discarded outcome.

Index build (also `make index-vector`):

```bash
uv run python -m app.retrieval.standard            # ollama/bge-m3 into Qdrant
uv run python -m app.retrieval.standard --provider hashing  # deterministic, no services
uv run python -m app.retrieval.standard --no-rebuild        # upsert into the existing collection
```

The index manifest is written to `<dataset>/vector-index.json` with the dense
and sparse model names, dimensions, vector names, chunk count and record count
for reproducibility.
`--no-rebuild` refuses a collection without a sparse vector (a pre-hybrid,
dense-only collection); rebuild it instead.

## Tests

`backend/tests/test_standard_rag.py` covers retrieval correctness (planted
relevance, citations, determinism), context limits (budget, duplicates,
reasons), telemetry completeness, the fake generator, the corpus loader, the
in-memory hybrid search (fusion, kind and market filters) and the dense-only
collection refusal.
`backend/tests/test_vector_store_qdrant.py` runs live against Qdrant with
`VECTOR_E2E=1` (CI provides the service container).
