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
  (`GENERATION_PROVIDER=litellm`); see the answer contract below.
- **Telemetry**: `pipeline.py` emits the full `rag.*` event sequence from
  docs/07 section 7 into an `EventSink`; every candidate carries similarity,
  rank, rerank score and selected/discarded outcome.

## Answer contract (prompt v2)

Pipelines A, B and C share one generator, one prompt and one parser, so answers are produced identically for every configuration.
The prompt version is `PROMPT_VERSION` in `generation.py` (currently `2.0.0`) and every benchmark run records it as `prompt_version` in its reproducibility record.

The prompt numbers every context block shown to the model: document chunks first, then structured graph blocks.
The system prompt tells the model to use only those numbered sources, to cite every claim as `[n]`, and to reply with exactly one JSON object:

```json
{"verdict": "<one line, or 'unknown' when the sources do not answer>", "answer": "<prose with [n] citations>"}
```

When the sources do not answer the question, the model must set `verdict` to `unknown` and say so in the answer.
`GENERATION_MAX_TOKENS` (default 600) caps the completion length and `GENERATION_TEMPERATURE` (default 0) is passed through unchanged.

`parse_answer` reads the model output with three strategies, in order:

1. Strict JSON: the whole output is the JSON object with string `verdict` and `answer` keys.
2. Fenced JSON: the object sits inside a fenced code block somewhere in the output; the `json` tag is optional and matched case-insensitively.
3. Plain text: anything else, including JSON with missing keys or wrong types, keeps the whole output as the answer with an empty verdict.

Cited blocks are the `[n]` markers in the parsed answer that point at a block actually shown to the model (`1..block_count`), deduplicated in order of first appearance.
A bracket may group several numbers, so `[1, 2]` cites blocks 1 and 2; ranges such as `[1-3]` are not supported.
A marker outside that range is dropped, so an answer can never cite a source it was not given.

`RagAnswer` carries the result:

- `text` is the parsed prose answer, which the evaluator scores and the UI shows.
- `verdict` is the one-line verdict, empty when the model gave none.
- `cited_blocks` lists the cited block numbers; block `n` is `citations[n - 1]`, because `citations` lists every block in prompt order.
- `raw_text` is the model output verbatim.
- `usage` holds the prompt, completion and total token counts when the gateway reports them.

A gateway failure or an empty output still raises `GenerationError`; the parser never turns a failed call into an answer.

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
