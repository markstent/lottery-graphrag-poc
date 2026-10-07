"""Live Qdrant integration tests (ADR-002 shared vector layer).

Opt-in like the graph E2E tests: they need the docker-compose Qdrant
service. CI runs them with VECTOR_E2E=1 and a Qdrant service container.
"""

from __future__ import annotations

import contextlib
import os
import uuid

import pytest
from app.retrieval.standard.embeddings import HashingEmbedder
from app.retrieval.standard.vector_store import QdrantVectorStore

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")

pytestmark = pytest.mark.skipif(
    os.environ.get("VECTOR_E2E") != "1",
    reason="Qdrant integration tests run only with VECTOR_E2E=1",
)


def test_qdrant_upsert_search_reset_roundtrip() -> None:
    collection = f"poc_test_{uuid.uuid4().hex[:12]}"
    embedder = HashingEmbedder(dimensions=64)
    store = QdrantVectorStore(url=QDRANT_URL, collection=collection, dimensions=64)
    try:
        store.ensure_collection()

        vectors = embedder.embed(
            ["payment checkout regression in Greece", "spring marketing campaign brief"]
        )
        store.upsert(
            ids=["CHNK_PAY", "CHNK_MKT"],
            vectors=vectors,
            payloads=[
                {"chunk_id": "CHNK_PAY", "text": "payment checkout regression in Greece"},
                {"chunk_id": "CHNK_MKT", "text": "spring marketing campaign brief"},
            ],
        )
        assert store.count() == 2

        query = embedder.embed(["payment checkout regression"])[0]
        hits = store.search(query, limit=2)
        assert hits[0][0] == "CHNK_PAY"
        assert hits[0][1] > hits[1][1]
        assert hits[0][2]["chunk_id"] == "CHNK_PAY"

        # Upsert overwrites cleanly.
        store.upsert(ids=["CHNK_PAY"], vectors=[vectors[0]], payloads=[{"chunk_id": "CHNK_PAY"}])
        assert store.count() == 2

        store.reset()
        assert store.count() == 0
    finally:
        with contextlib.suppress(Exception):  # best-effort cleanup
            store._client.delete_collection(collection_name=collection)
