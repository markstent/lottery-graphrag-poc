# Embeddings

Requirements:

- multilingual
- local-capable
- supports English, Greek, German and Czech
- versioned
- deterministic enough for reproducible retrieval

The final model must be selected at implementation time and recorded in experiment metadata.

Do not hard-code assumptions into domain logic.

## Selection (Phase 8)

- **Runtime model**: `bge-m3` via Ollama (multilingual: English, Greek,
  German, Czech; 1024 dimensions). Selected because it is local-capable,
  versioned by model name, and demonstrably retrieves the planted scenarios
  across languages in the development world.
- **CI/test model**: `HashingEmbedder` (deterministic token-hashing, any
  dimension) so retrieval mechanics are testable without model downloads.
- Versioning: the model name is stamped into the index manifest
  (`vector-index.json`) and recorded on every run result; changing the model
  requires a rebuild, which is the version boundary.

## Use

One dense model (`bge-m3`) and one sparse model (`Qdrant/bm25`) serve every pipeline.
They embed the document chunks and record blocks at index time and the question at query time for A's search, B's and C's document channel and the record-anchored fallback seed search.
The dense model also scores graph nodes' semantic relevance against the question (pipelines B and C), over each node's one text (`docs/retrieval/evidence-ranking.md`).
