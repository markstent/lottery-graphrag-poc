"""Document corpus access for indexing and retrieval payloads.

Chunks are the generation-time chunks (datasets/util.py chunk_text): one
source of truth for the corpus, shared by A/B/C for fairness
(docs/retrieval/retrieval-fairness.md). This module joins chunk rows with
their document metadata into retrieval-ready payloads.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb

from app.evidence import EvidenceChunk


@dataclass(frozen=True, slots=True)
class CorpusChunk:
    """One indexed chunk with provenance: a document chunk or a serialised record."""

    chunk_id: str
    document_id: str
    chunk_index: int
    text: str
    title: str
    document_type: str
    market_id: str
    language_code: str
    source_system: str
    valid_from: str | None
    valid_to: str | None
    kind: str = "chunk"
    record_table: str | None = None

    def to_payload(self) -> dict[str, str | int | None]:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "chunk_index": self.chunk_index,
            "title": self.title,
            "document_type": self.document_type,
            "market_id": self.market_id,
            "language_code": self.language_code,
            "source_system": self.source_system,
            "valid_from": self.valid_from,
            "valid_to": self.valid_to,
            "text": self.text,
            "kind": self.kind,
            "record_table": self.record_table,
        }

    def to_evidence(
        self, similarity: float, rank: int, discovered_via: str = "vector"
    ) -> EvidenceChunk:
        return EvidenceChunk(
            chunk_id=self.chunk_id,
            document_id=self.document_id,
            chunk_index=self.chunk_index,
            text=self.text,
            title=self.title,
            document_type=self.document_type,
            market_id=self.market_id,
            language_code=self.language_code,
            source_system=self.source_system,
            valid_from=self.valid_from,
            valid_to=self.valid_to,
            similarity=round(similarity, 6),
            rank=rank,
            discovered_via=discovered_via,
            kind=self.kind,
            record_table=self.record_table,
        )


def load_corpus(dataset_dir: Path) -> list[CorpusChunk]:
    """Load chunks joined with document metadata, ordered by chunk_id."""
    query = """
        SELECT
            c.chunk_id,
            c.document_id,
            c.chunk_index,
            c.text,
            d.title,
            d.document_type,
            d.market_id,
            d.language_code,
            d.source_system_code AS source_system,
            CAST(d.valid_from AS VARCHAR) AS valid_from,
            CAST(d.valid_to AS VARCHAR) AS valid_to
        FROM read_parquet(?) AS c
        JOIN read_parquet(?) AS d USING (document_id)
        ORDER BY c.chunk_id
    """
    rows = (
        duckdb.connect()
        .execute(
            query,
            [
                str(dataset_dir / "document_chunks.parquet"),
                str(dataset_dir / "documents.parquet"),
            ],
        )
        .fetchall()
    )
    return [
        CorpusChunk(
            chunk_id=str(row[0]),
            document_id=str(row[1]),
            chunk_index=int(row[2]),
            text=str(row[3]),
            title=str(row[4]),
            document_type=str(row[5]),
            market_id=str(row[6]),
            language_code=str(row[7]),
            source_system=str(row[8]),
            valid_from=row[9],
            valid_to=row[10],
        )
        for row in rows
    ]
