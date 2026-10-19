"""Hybrid (dense + sparse) vector store adapters over the shared Qdrant layer (ADR-002).

- QdrantVectorStore: the real store used for development and benchmarks.
- InMemoryVectorStore: brute force for CI and tests; same contract.

Every point carries a dense vector (``dense``, cosine) and a sparse BM25
vector (``sparse``, dot product; Qdrant applies the IDF modifier). A search
runs a dense top-``limit`` and a sparse top-``limit`` inside the same filter
and fuses the two rankings on the client with ``reciprocal_rank_fusion``
(both stores, so ties break identically everywhere). Payloads carry the
evidence provenance fields so search results can build EvidenceChunk objects
without extra lookups.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from app.retrieval.standard.fusion import reciprocal_rank_fusion
from app.retrieval.standard.sparse import SparseVector

VectorPayload = dict[str, Any]

DENSE_VECTOR = "dense"
SPARSE_VECTOR = "sparse"


class VectorStoreError(RuntimeError):
    """Raised when a vector backend fails."""


@dataclass(frozen=True, slots=True)
class SearchHit:
    """One fused search result.

    ``score`` is the reciprocal-rank-fusion score. ``dense_rank`` and
    ``sparse_rank`` are the 1-based ranks in each channel, ``None`` when the
    point was not in that channel's top-``limit``.
    """

    id: str
    score: float
    dense_rank: int | None
    sparse_rank: int | None
    payload: VectorPayload


class VectorStore(Protocol):
    def upsert(
        self,
        ids: list[str],
        dense: list[list[float]],
        sparse: list[SparseVector],
        payloads: list[VectorPayload],
    ) -> None:
        """Insert or overwrite points."""
        ...

    def search(
        self,
        dense: list[float],
        sparse: SparseVector,
        limit: int,
        markets: Sequence[str] | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        """Return up to ``limit`` hits fused from a dense and a sparse top-``limit``.

        ``markets`` restricts both channels to payloads whose ``market_id``
        is one of the given full market ids (e.g. ``MKT_GR``) or empty:
        market-less documents and records (shared infrastructure, corporate
        taxonomy, devices) are shared evidence and stay in every scoped
        run, exactly as the graph pipelines keep market-less nodes.
        ``kinds`` restricts to payload ``kind`` values
        (``chunk``, ``record``). ``None`` or an empty sequence means no
        restriction. The top-k is computed within the filter, never cropped
        afterwards.
        """
        ...

    def reset(self) -> None:
        """Remove all points (index rebuilds)."""
        ...

    def count(self) -> int:
        """Number of stored points."""
        ...

    def collection_info(self) -> dict[str, Any]:
        """``{"vectors": [names], "sparse_vectors": [names], "points": n}``."""
        ...


# ``market_id`` of shared (market-less) evidence.
SHARED_MARKET = ""


def _market_scope(markets: Sequence[str] | None) -> list[str] | None:
    """The scoped market ids plus the shared market; ``None`` when unscoped."""
    if not markets:
        return None
    return [*dict.fromkeys(market for market in markets if market), SHARED_MARKET]


class InMemoryVectorStore:
    """Brute-force hybrid store; dense vectors must be L2-normalised."""

    def __init__(self) -> None:
        self._dense: dict[str, list[float]] = {}
        self._sparse: dict[str, dict[int, float]] = {}
        self._payloads: dict[str, VectorPayload] = {}

    def upsert(
        self,
        ids: list[str],
        dense: list[list[float]],
        sparse: list[SparseVector],
        payloads: list[VectorPayload],
    ) -> None:
        for point_id, vector, terms, payload in zip(ids, dense, sparse, payloads, strict=True):
            self._dense[point_id] = vector
            self._sparse[point_id] = dict(zip(terms.indices, terms.values, strict=True))
            self._payloads[point_id] = payload

    def search(
        self,
        dense: list[float],
        sparse: SparseVector,
        limit: int,
        markets: Sequence[str] | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        scope = _market_scope(markets)
        kind_scope = list(kinds) if kinds else None
        candidates = [
            point_id
            for point_id, payload in self._payloads.items()
            if (scope is None or payload.get("market_id") in scope)
            and (kind_scope is None or payload.get("kind") in kind_scope)
        ]
        dense_ranking = _top(
            [(point_id, _dot(dense, self._dense[point_id])) for point_id in candidates], limit
        )
        query_terms = dict(zip(sparse.indices, sparse.values, strict=True))
        # Like Qdrant, the sparse channel only returns points sharing a term.
        sparse_scores = [
            (point_id, score)
            for point_id in candidates
            if (score := _sparse_dot(query_terms, self._sparse[point_id])) > 0
        ]
        sparse_ranking = _top(sparse_scores, limit)
        dense_ranks = {point_id: rank for rank, point_id in enumerate(dense_ranking, start=1)}
        sparse_ranks = {point_id: rank for rank, point_id in enumerate(sparse_ranking, start=1)}
        fused = reciprocal_rank_fusion([dense_ranking, sparse_ranking])[:limit]
        return [
            SearchHit(
                id=point_id,
                score=score,
                dense_rank=dense_ranks.get(point_id),
                sparse_rank=sparse_ranks.get(point_id),
                payload=self._payloads[point_id],
            )
            for point_id, score in fused
        ]

    def reset(self) -> None:
        self._dense.clear()
        self._sparse.clear()
        self._payloads.clear()

    def count(self) -> int:
        return len(self._dense)

    def collection_info(self) -> dict[str, Any]:
        return {
            "vectors": [DENSE_VECTOR],
            "sparse_vectors": [SPARSE_VECTOR],
            "points": self.count(),
        }


def _top(scores: list[tuple[str, float]], limit: int) -> list[str]:
    """Ids by score descending then id, cut to ``limit``."""
    scores.sort(key=lambda entry: (-entry[1], entry[0]))
    return [point_id for point_id, _ in scores[:limit]]


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _sparse_dot(query: dict[int, float], document: dict[int, float]) -> float:
    return sum(weight * document.get(index, 0.0) for index, weight in query.items())


_COLLECTION_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


class QdrantVectorStore:
    """Qdrant adapter with named vectors ``dense`` (cosine) and ``sparse``.

    `dimensions` must match the embedding model. Call `ensure_collection`
    before the first upsert of a fresh collection.
    """

    def __init__(self, url: str, collection: str, dimensions: int) -> None:
        if not _COLLECTION_NAME.fullmatch(collection):
            raise ValueError(f"Invalid collection name: {collection!r}")
        if dimensions <= 0:
            raise ValueError(f"Invalid dimensions: {dimensions}")
        from qdrant_client import QdrantClient  # imported lazily: heavy import

        self._collection = collection
        self._dimensions = dimensions
        # check_compatibility=False: no background version-check thread and
        # no outbound phone-home; keeps runs deterministic and CI quiet.
        self._client: Any = QdrantClient(url=url, timeout=30, check_compatibility=False)

    def upsert(
        self,
        ids: list[str],
        dense: list[list[float]],
        sparse: list[SparseVector],
        payloads: list[VectorPayload],
    ) -> None:
        from qdrant_client import models

        points = [
            models.PointStruct(
                id=self._point_id(point_id),
                vector={
                    DENSE_VECTOR: vector,
                    SPARSE_VECTOR: models.SparseVector(
                        indices=list(terms.indices), values=list(terms.values)
                    ),
                },
                payload={"_external_id": point_id, **payload},
            )
            for point_id, vector, terms, payload in zip(ids, dense, sparse, payloads, strict=True)
        ]
        # Batched: one call for the whole corpus can outlive the client
        # timeout on larger worlds (demo profile has thousands of points).
        batch_size = 256
        try:
            for start in range(0, len(points), batch_size):
                self._client.upsert(
                    collection_name=self._collection, points=points[start : start + batch_size]
                )
        except Exception as error:  # qdrant-client raises varied transport errors
            raise VectorStoreError(f"Qdrant upsert failed: {error}") from error

    def search(
        self,
        dense: list[float],
        sparse: SparseVector,
        limit: int,
        markets: Sequence[str] | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        """A dense and a sparse top-``limit`` in one batch, fused on the client.

        Each channel is ordered by score then id before fusion, so the
        result never depends on how the server orders equal scores.
        """
        from qdrant_client import models

        scope = _market_scope(markets)
        conditions: list[Any] = []
        if scope is not None:
            conditions.append(
                models.FieldCondition(key="market_id", match=models.MatchAny(any=scope))
            )
        if kinds:
            conditions.append(
                models.FieldCondition(key="kind", match=models.MatchAny(any=list(kinds)))
            )
        query_filter = models.Filter(must=conditions) if conditions else None
        requests = [
            models.QueryRequest(
                query=dense, using=DENSE_VECTOR, limit=limit, filter=query_filter, with_payload=True
            ),
            models.QueryRequest(
                query=models.SparseVector(indices=list(sparse.indices), values=list(sparse.values)),
                using=SPARSE_VECTOR,
                limit=limit,
                filter=query_filter,
                with_payload=True,
            ),
        ]
        try:
            responses = self._client.query_batch_points(
                collection_name=self._collection, requests=requests
            )
        except Exception as error:
            raise VectorStoreError(f"Qdrant search failed: {error}") from error
        payloads: dict[str, VectorPayload] = {}
        channels: list[list[str]] = []
        for response in responses:
            scored: list[tuple[str, float]] = []
            for point in response.points:
                payload = dict(point.payload or {})
                # Restore the caller's id; Qdrant only accepts uint/UUID point ids.
                external_id = str(payload.pop("_external_id", point.id))
                payloads[external_id] = payload
                scored.append((external_id, float(point.score)))
            channels.append(_top(scored, limit))
        dense_ranks = {point_id: rank for rank, point_id in enumerate(channels[0], start=1)}
        sparse_ranks = {point_id: rank for rank, point_id in enumerate(channels[1], start=1)}
        return [
            SearchHit(
                id=point_id,
                score=score,
                dense_rank=dense_ranks.get(point_id),
                sparse_rank=sparse_ranks.get(point_id),
                payload=payloads[point_id],
            )
            for point_id, score in reciprocal_rank_fusion(channels)[:limit]
        ]

    def _point_id(self, external_id: str) -> str:
        """Deterministic UUID for an external id, stable across rebuilds."""
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"semantic-context-lab/{external_id}"))

    def reset(self) -> None:
        try:
            self._client.delete_collection(collection_name=self._collection)
        except Exception as error:  # a missing collection is fine on reset
            if "not found" not in str(error).lower():
                raise VectorStoreError(f"Qdrant reset failed: {error}") from error
        self.ensure_collection()

    def count(self) -> int:
        try:
            return int(self._client.count(collection_name=self._collection, exact=True).count)
        except Exception as error:
            raise VectorStoreError(f"Qdrant count failed: {error}") from error

    def collection_info(self) -> dict[str, Any]:
        """Vector names of the live collection; an unnamed (legacy) dense
        vector is reported as ``""``."""
        try:
            info = self._client.get_collection(collection_name=self._collection)
        except Exception as error:
            raise VectorStoreError(f"Qdrant collection info failed: {error}") from error
        vectors = info.config.params.vectors
        sparse_vectors = info.config.params.sparse_vectors or {}
        return {
            "vectors": sorted(vectors) if isinstance(vectors, dict) else [""],
            "sparse_vectors": sorted(sparse_vectors),
            "points": int(info.points_count or 0),
        }

    def ensure_collection(self) -> None:
        from qdrant_client import models

        try:
            existing = [
                collection.name for collection in self._client.get_collections().collections
            ]
            if self._collection not in existing:
                self._client.create_collection(
                    collection_name=self._collection,
                    vectors_config={
                        DENSE_VECTOR: models.VectorParams(
                            size=self._dimensions, distance=models.Distance.COSINE
                        )
                    },
                    # fastembed's Qdrant/bm25 emits term-frequency weights only;
                    # the IDF half of BM25 is computed server side.
                    sparse_vectors_config={
                        SPARSE_VECTOR: models.SparseVectorParams(modifier=models.Modifier.IDF)
                    },
                )
        except Exception as error:
            raise VectorStoreError(f"Qdrant collection setup failed: {error}") from error
