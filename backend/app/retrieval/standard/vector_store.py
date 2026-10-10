"""Vector store adapters over the shared Qdrant layer (ADR-002).

- QdrantVectorStore: the real store used for development and benchmarks.
- InMemoryVectorStore: cosine brute force for CI and tests; same contract.

Payloads carry the evidence provenance fields so search results can build
EvidenceChunk objects without extra lookups.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Protocol

VectorPayload = dict[str, Any]


class VectorStoreError(RuntimeError):
    """Raised when a vector backend fails."""


class VectorStore(Protocol):
    def upsert(
        self, ids: list[str], vectors: list[list[float]], payloads: list[VectorPayload]
    ) -> None:
        """Insert or overwrite points."""
        ...

    def search(self, vector: list[float], limit: int) -> list[tuple[str, float, VectorPayload]]:
        """Return the (id, similarity, payload) nearest neighbours."""
        ...

    def reset(self) -> None:
        """Remove all points (index rebuilds)."""
        ...

    def count(self) -> int:
        """Number of stored points."""
        ...


class InMemoryVectorStore:
    """Brute-force cosine store; vectors must be L2-normalised."""

    def __init__(self) -> None:
        self._vectors: dict[str, list[float]] = {}
        self._payloads: dict[str, VectorPayload] = {}

    def upsert(
        self, ids: list[str], vectors: list[list[float]], payloads: list[VectorPayload]
    ) -> None:
        for point_id, vector, payload in zip(ids, vectors, payloads, strict=True):
            self._vectors[point_id] = vector
            self._payloads[point_id] = payload

    def search(self, vector: list[float], limit: int) -> list[tuple[str, float, VectorPayload]]:
        scores = [
            (point_id, _dot(vector, stored), self._payloads[point_id])
            for point_id, stored in self._vectors.items()
        ]
        scores.sort(key=lambda entry: (-entry[1], entry[0]))
        return scores[:limit]

    def reset(self) -> None:
        self._vectors.clear()
        self._payloads.clear()

    def count(self) -> int:
        return len(self._vectors)


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


_COLLECTION_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


class QdrantVectorStore:
    """Qdrant adapter; collections use cosine distance.

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
        self, ids: list[str], vectors: list[list[float]], payloads: list[VectorPayload]
    ) -> None:
        from qdrant_client.models import PointStruct

        points = [
            PointStruct(
                id=self._point_id(point_id),
                vector=vector,
                payload={"_external_id": point_id, **payload},
            )
            for point_id, vector, payload in zip(ids, vectors, payloads, strict=True)
        ]
        # Batched: one call for the whole corpus can outlive the client
        # timeout on larger worlds (demo profile has ~3k chunks).
        batch_size = 256
        try:
            for start in range(0, len(points), batch_size):
                self._client.upsert(
                    collection_name=self._collection, points=points[start : start + batch_size]
                )
        except Exception as error:  # qdrant-client raises varied transport errors
            raise VectorStoreError(f"Qdrant upsert failed: {error}") from error

    def search(self, vector: list[float], limit: int) -> list[tuple[str, float, VectorPayload]]:
        try:
            result = self._client.query_points(
                collection_name=self._collection, query=vector, limit=limit, with_payload=True
            )
        except Exception as error:
            raise VectorStoreError(f"Qdrant search failed: {error}") from error
        points: list[tuple[str, float, VectorPayload]] = []
        for point in result.points:
            payload = dict(point.payload or {})
            # Restore the caller's id; Qdrant only accepts uint/UUID point ids.
            external_id = str(payload.pop("_external_id", point.id))
            points.append((external_id, float(point.score), payload))
        return points

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

    def ensure_collection(self) -> None:
        from qdrant_client.models import Distance, VectorParams

        try:
            existing = [
                collection.name for collection in self._client.get_collections().collections
            ]
            if self._collection not in existing:
                self._client.create_collection(
                    collection_name=self._collection,
                    vectors_config=VectorParams(size=self._dimensions, distance=Distance.COSINE),
                )
        except Exception as error:
            raise VectorStoreError(f"Qdrant collection setup failed: {error}") from error
