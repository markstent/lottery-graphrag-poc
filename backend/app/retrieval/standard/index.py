"""Vector index builder for the standard RAG pipeline.

Embeds the generation-time document chunks into the shared Qdrant collection
(ADR-002) and records an index manifest next to the dataset. The manifest
carries the embedding model version so every run is reproducible.

Usage:
    uv run python -m app.retrieval.standard [--dataset-dir DIR] [--provider ollama|hashing]
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
from pathlib import Path

from app.config import EmbeddingSettings, RetrievalSettings, VectorSettings, from_env
from app.retrieval.standard.corpus import load_corpus
from app.retrieval.standard.embeddings import EmbeddingFunction, HashingEmbedder, OllamaEmbedder
from app.retrieval.standard.vector_store import InMemoryVectorStore, QdrantVectorStore, VectorStore


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


def build_index(settings: RetrievalSettings, rebuild: bool = True) -> dict[str, object]:
    """Embed the corpus into the configured store; return the manifest."""
    dataset_dir = Path(settings.dataset_dir)
    corpus = load_corpus(dataset_dir)
    if not corpus:
        raise RuntimeError(f"No document chunks found in {dataset_dir}")

    embedder = build_embedder(settings.embedding)
    store = build_store(settings.vector, embedder.dimensions, settings.embedding.provider)
    if rebuild:
        store.reset()

    vectors = embedder.embed([chunk.text for chunk in corpus])
    store.upsert(
        ids=[chunk.chunk_id for chunk in corpus],
        vectors=vectors,
        payloads=[chunk.to_payload() for chunk in corpus],
    )

    manifest = {
        "collection": settings.vector.collection,
        "embedding_provider": settings.embedding.provider,
        "embedding_model": embedder.model_name,
        "embedding_dimensions": embedder.dimensions,
        "chunk_count": len(corpus),
        "indexed_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
    }
    store_count = store.count()
    if store_count != len(corpus):
        raise RuntimeError(
            f"Index verification failed: store holds {store_count} points, expected {len(corpus)}"
        )
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
    args = parser.parse_args()

    settings = from_env()
    if args.dataset_dir:
        settings = dataclasses.replace(settings, dataset_dir=args.dataset_dir)
    if args.provider:
        settings = dataclasses.replace(
            settings,
            embedding=dataclasses.replace(settings.embedding, provider=args.provider),
        )

    manifest = build_index(settings)
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
