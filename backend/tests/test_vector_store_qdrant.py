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
from app.retrieval.standard.sparse import HashingSparseEmbedder
from app.retrieval.standard.vector_store import QdrantVectorStore

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")

pytestmark = pytest.mark.skipif(
    os.environ.get("VECTOR_E2E") != "1",
    reason="Qdrant integration tests run only with VECTOR_E2E=1",
)


def test_qdrant_hybrid_upsert_search_reset_roundtrip() -> None:
    collection = f"poc_test_{uuid.uuid4().hex[:12]}"
    dense = HashingEmbedder(dimensions=64)
    sparse = HashingSparseEmbedder()
    store = QdrantVectorStore(url=QDRANT_URL, collection=collection, dimensions=64)
    texts = [
        "payment checkout regression in Greece",
        "spring marketing campaign brief",
        "Game record: instant lottery sold at retailers",
    ]
    try:
        store.ensure_collection()
        info = store.collection_info()
        assert info["vectors"] == ["dense"]
        assert info["sparse_vectors"] == ["sparse"]

        store.upsert(
            ids=["CHNK_PAY", "CHNK_MKT", "REC_games_G1"],
            dense=dense.embed(texts),
            sparse=sparse.embed_documents(texts),
            payloads=[
                {"chunk_id": "CHNK_PAY", "market_id": "MKT_GR", "kind": "chunk"},
                {"chunk_id": "CHNK_MKT", "market_id": "MKT_UK", "kind": "chunk"},
                {"chunk_id": "REC_games_G1", "market_id": "", "kind": "record"},
            ],
        )
        assert store.count() == 3
        assert store.collection_info()["points"] == 3

        query = "payment checkout regression"
        hits = store.search(dense.embed([query])[0], sparse.embed_query(query), limit=3)
        assert hits[0].id == "CHNK_PAY"
        assert hits[0].payload["chunk_id"] == "CHNK_PAY"
        assert "_external_id" not in hits[0].payload
        assert hits[0].score >= hits[-1].score
        # Qdrant fuses server side: no per-channel ranks.
        assert hits[0].dense_rank is None and hits[0].sparse_rank is None

        records = store.search(
            dense.embed(["instant lottery"])[0],
            sparse.embed_query("instant lottery"),
            limit=3,
            kinds=["record"],
        )
        assert [hit.id for hit in records] == ["REC_games_G1"]

        # Market scope matches only non-empty market ids.
        scoped = store.search(
            dense.embed([query])[0], sparse.embed_query(query), limit=3, markets=["MKT_UK", ""]
        )
        assert [hit.id for hit in scoped] == ["CHNK_MKT"]

        # Upsert overwrites cleanly.
        store.upsert(
            ids=["CHNK_PAY"],
            dense=dense.embed(texts[:1]),
            sparse=sparse.embed_documents(texts[:1]),
            payloads=[{"chunk_id": "CHNK_PAY"}],
        )
        assert store.count() == 3

        store.reset()
        assert store.count() == 0
        assert store.collection_info()["sparse_vectors"] == ["sparse"]
    finally:
        with contextlib.suppress(Exception):  # best-effort cleanup
            store._client.delete_collection(collection_name=collection)
