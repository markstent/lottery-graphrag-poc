"""Embedding functions (docs/reference/retrieval/embeddings.md).

Two adapters:

- OllamaEmbedder: the real multilingual model (default bge-m3, 1024d), used
  for local development and benchmark runs.
- HashingEmbedder: a deterministic fake for CI and tests. It requires no
  model download and produces stable vectors from token hashes, so
  retrieval behaviour is reproducible everywhere.

The model name is the version marker: it is stamped into vector payloads and
recorded on every run.
"""

from __future__ import annotations

import hashlib
import re
from typing import Protocol

import httpx

_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)


class EmbeddingError(RuntimeError):
    """Raised when an embedding backend fails or returns unusable output."""


class EmbeddingFunction(Protocol):
    """Embeds texts into fixed-dimension vectors."""

    model_name: str
    dimensions: int

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed texts; must return one vector per input, L2-normalised."""
        ...


def _tokenise(text: str) -> list[str]:
    return _TOKEN_PATTERN.findall(text.lower())


class HashingEmbedder:
    """Deterministic token-hashing embedder (the CI/test fake).

    Not a quality model: it exists so retrieval mechanics are testable and
    reproducible without model downloads.
    """

    def __init__(self, dimensions: int = 256) -> None:
        self.model_name = f"hashing-{dimensions}"
        self.dimensions = dimensions

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for token in _tokenise(text):
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            index = int.from_bytes(digest, "big") % self.dimensions
            vector[index] += 1.0
        return _normalise(vector)


def _normalise(vector: list[float]) -> list[float]:
    norm = sum(value * value for value in vector) ** 0.5
    if norm == 0.0:
        return vector
    return [value / norm for value in vector]


class OllamaEmbedder:
    """Multilingual embeddings from a local Ollama server.

    Vectors are L2-normalised here, as the Protocol requires: Ollama's raw
    vectors are not guaranteed to be unit length. Qdrant ranks by cosine,
    which ignores length, so an index built from raw vectors ranks the same.
    Every vector must have the configured ``dimensions``.
    """

    def __init__(
        self,
        model: str,
        dimensions: int,
        host: str,
        timeout_s: float = 60.0,
        batch_size: int = 32,
    ) -> None:
        self.model_name = model
        self.dimensions = dimensions
        self._host = host.rstrip("/")
        self._timeout_s = timeout_s
        if batch_size <= 0:
            raise ValueError(f"batch_size must be positive, got {batch_size}")
        self._batch_size = batch_size

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        embeddings: list[list[float]] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start : start + self._batch_size]
            embeddings.extend(self._embed_batch(batch))
        return embeddings

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        try:
            response = httpx.post(
                f"{self._host}/api/embed",
                json={"model": self.model_name, "input": texts},
                timeout=self._timeout_s,
            )
            response.raise_for_status()
            body = response.json()
        except httpx.HTTPError as error:
            raise EmbeddingError(f"Ollama embedding request failed: {error}") from error
        embeddings = body.get("embeddings")
        if not isinstance(embeddings, list) or len(embeddings) != len(texts):
            raise EmbeddingError(
                f"Ollama returned {type(embeddings).__name__} for {len(texts)} inputs"
            )
        for vector in embeddings:
            if len(vector) != self.dimensions:
                raise EmbeddingError(
                    f"Ollama model {self.model_name} returned a {len(vector)}-dimension vector; "
                    f"{self.dimensions} are configured (EMBEDDING_DIMENSIONS)"
                )
        return [_normalise(vector) for vector in embeddings]
