# Standard RAG

## What changed in v2

In v1 pipeline A searched document chunks by dense cosine similarity, reordered them with a lexical blend and asked for a prose answer whose citations were derived from the selected context.
In v2 A also reads the warehouse: every serialised table is indexed as record blocks in the same collection as the documents.
Search is hybrid, dense plus sparse BM25, fused on the client by reciprocal rank fusion (D-022), and a cross-encoder judges the hits (D-021, D-025).
Answers follow a structured prompt with a verdict and parsed citations (D-024).

## Requirement

The baseline must be competitive: chunking, top-k, reranking and prompts are never deliberately weakened, and every candidate and selected chunk is recorded.

```text
question
 -> dense + sparse (BM25) embedding
 -> hybrid search (dense top-k + sparse top-k, reciprocal rank fusion)
 -> the shared judge (cross-encoder reranker)
 -> context selection (one token budget, one slot count)
 -> LLM
 -> structured answer + citations
```

## Implementation

Code lives in `backend/app/retrieval/standard/`.

- **Chunking** comes from the generation-time chunker (`app/datasets/util.py::chunk_text`, sentence-grouped); every pipeline consumes `document_chunks.parquet` as the single document source.
- **Record blocks**: `records.py` serialises warehouse rows into short English sentences, one fixed template per table, with local names joined from the taxonomy tables and a provenance sentence at the end.
  The tables are games, platform versions, incidents, campaigns, player segments, payment providers, app versions, game families, game mechanics, incident types, support categories, markets, platforms, channels, experiments, support cases, and the planted-pattern carriers: shared devices, shared payment methods and the players taking part in a share (design 10a.2).
  The serialiser is versioned (`RECORD_SERIALISER_VERSION`, currently 2.1.0); any change to a template or query bumps it and needs an index rebuild.
  Record blocks (`kind="record"`) are indexed next to the document chunks in one collection, and the lab loads the same chunks-plus-records corpus (`load_indexed_corpus`), so every hit resolves to a chunk for A, B and C alike.
  Documents and records without a market carry `market_id == ""`; a payment provider's market is its home market.
- **Embeddings**: `embeddings.py` (dense) and `sparse.py` (BM25), with deterministic hashing fakes for CI (`docs/retrieval/embeddings.md`).
- **Vector store**: `vector_store.py` adapts Qdrant (shared collection, ADR-002; chunk ids map to deterministic UUID point ids) plus an in-memory store for tests.
  Each point has a named dense vector `dense` (cosine) and a named sparse vector `sparse` (Qdrant applies the IDF modifier, which BM25 requires).
  `search(dense, sparse, limit, markets, kinds)` runs a dense and a sparse top-`limit` inside the same filter (Qdrant: one `query_batch_points` call) and fuses them on the client with `fusion.reciprocal_rank_fusion`.
  The fused score is the sum of `1 / (60 + rank)` over the channels (`fusion.RRF_K = 60`, the published default, 1-based ranks).
  Ties break by fused score, then dense rank (absent from the dense channel last), then id, and each channel is ordered by score then id before fusion, so equal scores never depend on server order.
  The in-memory and Qdrant stores therefore return the same fused order by construction; a live test checks the parity, ties included.
  A hit's fused score becomes `EvidenceChunk.similarity`, so `similarity` is a reciprocal-rank score, not a cosine.
  Every hit also reports its `dense_rank` and `sparse_rank` (`None` when it was not in that channel's top-`limit`), copied onto `EvidenceChunk` and the `rag.candidate.retrieved` event.
  Every pipeline builds evidence from the hit payload through the shared `corpus.hit_to_evidence`, so no hit is dropped for lack of a corpus entry.
  A market scope admits the scoped market ids plus the empty market, so market-less items (shared infrastructure, corporate taxonomy, devices) stay in scoped runs for every pipeline, exactly as the graph pipelines keep market-less nodes.
  `top_k` defaults to 40 (`RAG_TOP_K`).
- **Reranking**: `reranking.py` holds the one judge shared by A, B and C (`docs/retrieval/reranking.md`).
- **Context selection**: `context.py` fills one token budget and one slot count from the reranked list (`docs/retrieval/context-budgeting.md`).
- **Generation**: `generation.py` implements the ADR-003 gateway contract with a deterministic `FakeAnswerGenerator` (CI default) and a LiteLLM adapter (`GENERATION_PROVIDER=litellm`); see the answer contract below.
- **Telemetry**: `pipeline.py` emits the `rag.*` event sequence from docs/07 section 7; every candidate carries similarity, channel ranks, rerank score and outcome.

## Answer contract (prompt v2)

Pipelines A, B and C share one generator, one prompt and one parser.
The prompt version is `PROMPT_VERSION` in `generation.py` (currently `2.0.0`), and every benchmark run records it as `prompt_version`.

Every pipeline hands the generator one list, its selected evidence in judge order, and the prompt numbers the blocks in that order whatever their kind (document chunk, record block or graph node).
The same selected evidence therefore gives the same prompt string in A, B and C, and one builder (`citations_for`) turns the list into citations.
The system prompt tells the model to use only those numbered sources, to cite every claim as `[n]`, and to reply with exactly one JSON object:

```json
{"verdict": "<one line, or 'unknown' when the sources do not answer>", "answer": "<prose with [n] citations>"}
```

When the sources do not answer the question, the model must set `verdict` to `unknown` and say so in the answer.
`GENERATION_MAX_TOKENS` (default 1200, room for models that spend completion tokens on hidden thinking) caps the completion length, and `GENERATION_TEMPERATURE` (default 0) is passed through unchanged.

`parse_answer` reads the model output with three strategies, in order:

1. Strict JSON: the whole output is the JSON object with string `verdict` and `answer` keys.
2. Fenced JSON: every fenced code block in the output is tried in turn; the `json` tag is optional and matched case-insensitively.
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

A gateway failure or an empty output raises `GenerationError`; the parser never turns a failed call into an answer.

## Index build

Also available as `make index-vector`:

```bash
uv run python -m app.retrieval.standard            # ollama/bge-m3 into Qdrant
uv run python -m app.retrieval.standard --provider hashing  # deterministic, no services
uv run python -m app.retrieval.standard --no-rebuild        # upsert into the existing collection
```

The index manifest is written to `<dataset>/vector-index.json` with the dense and sparse model names, dimensions, vector names, the record serialiser version, chunk count and record count.
`--no-rebuild` refuses a dense-only collection from before hybrid search; rebuild it instead.
At cold start the API refuses a populated collection that is dense-only or whose manifest names another serialiser version (or is missing), with `VECTOR_RETRIEVAL_ERROR`; an empty collection is indexed in process and its manifest written.

## Tests

- `backend/tests/test_standard_rag.py`: retrieval correctness (planted relevance, citations, determinism over the full event sequence and every outcome), context limits, telemetry completeness, the fake generator, the corpus loader, the in-memory hybrid search (fusion, kind and market filters, shared evidence under a scope), the index manifest and the dense-only collection refusal.
- `backend/tests/test_records.py`, `test_sparse_and_fusion.py`, `test_rerank_cross_encoder.py` and `test_generation_v2.py`: record serialisation, BM25 and fusion, the cross-encoder judge, and prompt v2 parsing.
- `backend/tests/test_vector_store_qdrant.py`: live against Qdrant with `VECTOR_E2E=1` (CI provides the service container).
