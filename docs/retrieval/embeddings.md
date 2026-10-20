# Embeddings

## What changed in v2

In v1 retrieval used one dense model and cosine search over document chunks only.
In v2 a sparse BM25 model (`Qdrant/bm25`, run by fastembed, D-021) sits next to the dense model, and the two are fused into one hybrid search (D-022).
Both models embed the serialised warehouse records as well as the document chunks.

## Requirements

The models are multilingual (English, Greek, German and Czech), local-capable, versioned and deterministic enough for reproducible retrieval.
The chosen models are recorded in experiment metadata, and domain logic makes no assumption about them.

## Models

- **Dense**: `bge-m3` via Ollama (1024 dimensions).
  Chosen because it is local-capable, versioned by model name and retrieves the planted scenarios across languages in the development world.
  `OllamaEmbedder` L2-normalises every vector, as the embedding contract requires, and refuses a vector whose length differs from `EMBEDDING_DIMENSIONS` with an `EmbeddingError` naming both sizes.
  Qdrant ranks by cosine, which ignores vector length, so an index built before normalisation ranks the same and needs no rebuild (`tests/test_embeddings.py` pins this to within 1e-12).
  B and C score node relevance with a plain dot product (`ranking.semantic_scores`), which equals the cosine only for unit vectors.
  Raw bge-m3 vectors from Ollama were measured on 2026-10-20, before normalisation, over five representative texts (an English question, an English incident report, a record block, a German rules sentence and a Greek question).
  Their norms were 0.99999993, 0.99999964, 1.00000014, 1.00000033 and 1.00000032, all equal to 1 within 1e-6 (largest deviation 3.6e-7).
  Normalisation therefore moves a B or C node score by less than 1e-6 (at most a last-digit change in the six-decimal score), so runs made before it, the Phase 3 pilots included, stand.
  At lab build the existing collection's dense size is compared with the embedder's, and a mismatch raises a `VectorStoreError` naming both sizes, even for an empty collection.
- **Sparse**: `Qdrant/bm25` via fastembed (`SPARSE_MODEL`), downloaded once into `FASTEMBED_CACHE`.
  `SPARSE_PROVIDER` unset follows `EMBEDDING_PROVIDER`: `hashing` gives `hashing`, anything else gives `fastembed`.
- **CI and tests**: `HashingEmbedder` and `HashingSparseEmbedder`, deterministic token hashing, so retrieval mechanics are testable without model downloads.
- **Versioning**: both model names are stamped into the index manifest (`vector-index.json`); the dense model name is also recorded on every run result and benchmark reproducibility record.
  Changing a model requires a rebuild, which is the version boundary.

## Use

The same two models serve every pipeline.
They embed the document chunks and record blocks at index time, and the question at query time for A's search, B's and C's document channel and the record-anchored fallback seed search.
The dense model also scores each graph node's semantic relevance against the question in B and C, over the node's one text (`docs/retrieval/evidence-ranking.md`).
