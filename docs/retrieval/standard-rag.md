# Standard RAG

Pipeline:

```text
question
 -> embedding
 -> vector search
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
- **Vector store**: `vector_store.py` adapts Qdrant (shared collection,
  ADR-002; external chunk ids map to deterministic UUID point ids) plus an
  in-memory cosine store for tests.
- **Reranking**: `reranking.py` blends similarity with lexical overlap
  (weight 0.3 by default); disabled and enabled modes both record per-candidate
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
```

The index manifest is written to `<dataset>/vector-index.json` with the model
name, dimensions and chunk count for reproducibility.

## Tests

`backend/tests/test_standard_rag.py` covers retrieval correctness (planted
relevance, citations, determinism), context limits (budget, duplicates,
reasons), telemetry completeness, the fake generator and the corpus loader.
`backend/tests/test_vector_store_qdrant.py` runs live against Qdrant with
`VECTOR_E2E=1` (CI provides the service container).
