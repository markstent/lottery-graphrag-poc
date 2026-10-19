"""Hybrid vector index builder for the standard RAG pipeline.

Embeds the generation-time document chunks plus the serialised structured
records (``records.py``) into the shared Qdrant collection (ADR-002), dense
and sparse, and records an index manifest next to the dataset. The manifest
carries both model versions so every run is reproducible.

Usage:
    uv run python -m app.retrieval.standard [--dataset-dir DIR] [--provider ollama|hashing]
        [--rebuild | --no-rebuild]
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
from collections.abc import Sequence
from pathlib import Path

from app.config import EmbeddingSettings, RetrievalSettings, VectorSettings, from_env
from app.retrieval.standard.corpus import CorpusChunk, load_corpus
from app.retrieval.standard.embeddings import EmbeddingFunction, HashingEmbedder, OllamaEmbedder
from app.retrieval.standard.records import serialise_records
from app.retrieval.standard.sparse import SparseEmbedder, build_sparse_embedder
from app.retrieval.standard.vector_store import (
    DENSE_VECTOR,
    SPARSE_VECTOR,
    InMemoryVectorStore,
    QdrantVectorStore,
    VectorStore,
)

# Everything the vector collection holds, keyed by chunk id: document chunks
# plus record blocks, so every search hit resolves to a chunk.
IndexedCorpus = dict[str, CorpusChunk]


def build_embedder(settings: EmbeddingSettings) -> EmbeddingFunction:
    if settings.provider == "hashing":
        return HashingEmbedder(dimensions=settings.dimensions)
    if settings.provider == "ollama":
        return OllamaEmbedder(
            model=settings.model, dimensions=settings.dimensions, host=settings.host
        )
    raise ValueError(f"Unknown embedding provider: {settings.provider!r}")


def build_store(settings: VectorSettings, dimensions: int, provider: str) -> VectorStore:
    if provider == "hashing":
        # The deterministic fake never needs an external service.
        return InMemoryVectorStore()
    store = QdrantVectorStore(
        url=settings.url, collection=settings.collection, dimensions=dimensions
    )
    store.ensure_collection()
    return store


def load_indexed_corpus(dataset_dir: Path) -> IndexedCorpus:
    """Document chunks then record blocks, keyed by chunk id."""
    chunks = [
        *load_corpus(dataset_dir),
        *(b.to_corpus_chunk() for b in serialise_records(dataset_dir)),
    ]
    return {chunk.chunk_id: chunk for chunk in chunks}


def index_corpus(
    store: VectorStore,
    embedder: EmbeddingFunction,
    sparse: SparseEmbedder,
    corpus: Sequence[CorpusChunk],
) -> None:
    """Embed ``corpus`` dense and sparse and upsert it into ``store``."""
    texts = [chunk.text for chunk in corpus]
    store.upsert(
        ids=[chunk.chunk_id for chunk in corpus],
        dense=embedder.embed(texts),
        sparse=sparse.embed_documents(texts),
        payloads=[chunk.to_payload() for chunk in corpus],
    )
    store_count = store.count()
    if store_count < len(corpus):
        raise RuntimeError(
            f"Index verification failed: store holds {store_count} points, "
            f"expected at least {len(corpus)}"
        )


def build_index(settings: RetrievalSettings, rebuild: bool = True) -> dict[str, object]:
    """Embed chunks and record blocks into the configured store; return the manifest.

    Without ``rebuild`` the points are upserted into the existing collection,
    which must already carry a sparse vector.
    """
    dataset_dir = Path(settings.dataset_dir)
    corpus = load_indexed_corpus(dataset_dir)
    if not corpus:
        raise RuntimeError(f"No document chunks or records found in {dataset_dir}")
    record_count = sum(1 for chunk in corpus.values() if chunk.kind == "record")

    embedder = build_embedder(settings.embedding)
    sparse = build_sparse_embedder(settings.embedding)
    store = build_store(settings.vector, embedder.dimensions, settings.embedding.provider)
    if rebuild:
        store.reset()
    elif SPARSE_VECTOR not in store.collection_info()["sparse_vectors"]:
        raise RuntimeError("collection lacks a sparse vector; rebuild with --rebuild")

    index_corpus(store, embedder, sparse, list(corpus.values()))

    store_count = store.count()
    if rebuild and store_count != len(corpus):
        raise RuntimeError(
            f"Index verification failed: store holds {store_count} points, expected {len(corpus)}"
        )
    manifest = {
        "collection": settings.vector.collection,
        "embedding_provider": settings.embedding.provider,
        "embedding_model": embedder.model_name,
        "embedding_dimensions": embedder.dimensions,
        "sparse_model": sparse.model_name,
        "vector_names": [DENSE_VECTOR, SPARSE_VECTOR],
        "chunk_count": len(corpus) - record_count,
        "record_count": record_count,
        "indexed_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
    }
    manifest_path = dataset_dir / "vector-index.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset-dir", default=None, help="Dataset directory (default: $DATASET_DIR)"
    )
    parser.add_argument(
        "--provider",
        choices=["ollama", "hashing"],
        default=None,
        help="Embedding provider override (default: $EMBEDDING_PROVIDER or ollama)",
    )
    parser.add_argument(
        "--rebuild",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Drop and recreate the collection first (default); --no-rebuild upserts in place",
    )
    args = parser.parse_args()

    settings = from_env()
    if args.dataset_dir:
        settings = dataclasses.replace(settings, dataset_dir=args.dataset_dir)
    if args.provider:
        settings = dataclasses.replace(
            settings,
            embedding=dataclasses.replace(settings.embedding, provider=args.provider),
        )

    manifest = build_index(settings, rebuild=args.rebuild)
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
