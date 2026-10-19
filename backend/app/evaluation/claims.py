"""Answer claims: the statements a correct answer makes and the source
records that carry them (benchmark v2).

A grounder declares each claim as a :class:`ClaimSpec`; the
:class:`CarrierIndex` of one world turns it into a :class:`Claim` whose
carriers are every structured record and document chunk that states the
fact, so the evidence metric credits whichever source a pipeline found.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import duckdb

from app.retrieval.standard.records import serialise_records


def word_pattern(word: str) -> re.Pattern[str]:
    """Whole-word pattern for ``word``, to search casefolded text.

    The boundaries are Unicode-aware (``\\w``), so ``INC_01`` never matches
    inside ``INC_010`` and accented local names match as whole words.
    """
    return re.compile(r"(?<!\w)" + re.escape(word.casefold()) + r"(?!\w)")


@dataclass(frozen=True, slots=True)
class Claim:
    """One statement a correct answer makes, with the record ids that carry it."""

    claim_id: str
    statement: str
    carriers: frozenset[str]

    def to_payload(self) -> dict[str, object]:
        return {
            "claim_id": self.claim_id,
            "statement": self.statement,
            "carriers": sorted(self.carriers),
        }


def claim_from_payload(payload: Mapping[str, object]) -> Claim:
    return Claim(
        claim_id=str(payload["claim_id"]),
        statement=str(payload["statement"]),
        carriers=frozenset(cast(list[str], payload["carriers"])),
    )


@dataclass(frozen=True, slots=True)
class ClaimSpec:
    """What a grounder declares about one claim.

    ``record_ids`` and every chunk of ``document_ids`` carry the claim
    outright. ``markers`` are groups of alternative words: any record block
    or chunk whose text contains, as a whole word, at least one alternative
    of every group states the fact too. No groups means no text matching.
    """

    claim_id: str
    statement: str
    record_ids: tuple[str, ...]
    markers: tuple[tuple[str, ...], ...]
    document_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CarrierIndex:
    """Casefolded text of every record block and document chunk of one world."""

    texts: Mapping[str, str]
    chunk_documents: Mapping[str, str]

    @classmethod
    def build(cls, world_dir: Path) -> CarrierIndex:
        texts = {block.record_id: block.text.casefold() for block in serialise_records(world_dir)}
        path = (world_dir / "document_chunks.parquet").as_posix().replace("'", "''")
        connection = duckdb.connect()
        try:
            chunks = connection.execute(
                f"SELECT chunk_id, document_id, text FROM read_parquet('{path}') ORDER BY chunk_id"
            ).fetchall()
        finally:
            connection.close()
        texts.update((chunk_id, text.casefold()) for chunk_id, _, text in chunks)
        return cls(texts=texts, chunk_documents={chunk_id: doc for chunk_id, doc, _ in chunks})

    def carriers(self, spec: ClaimSpec) -> frozenset[str]:
        documents = set(spec.document_ids)
        declared = {chunk for chunk, doc in self.chunk_documents.items() if doc in documents}
        carriers = {*spec.record_ids, *declared}
        if spec.markers:
            groups = [[word_pattern(word) for word in group] for group in spec.markers]
            carriers.update(
                carrier
                for carrier, text in self.texts.items()
                if all(any(pattern.search(text) for pattern in group) for group in groups)
            )
        return frozenset(carriers)


def exclude_anchor(claims: Sequence[Claim], anchor_id: str) -> tuple[Claim, ...]:
    """Claims without the question's anchor as a carrier; claims only the anchor carries drop."""
    remaining = (
        Claim(claim.claim_id, claim.statement, claim.carriers - {anchor_id}) for claim in claims
    )
    return tuple(claim for claim in remaining if claim.carriers)


def selection_carrier(kind: str, chunk_id: str, document_id: str) -> str:
    """The carrier id of one selected context item.

    A record block's ``document_id`` is its record id and a graph node's
    ``chunk_id`` is its node id; a document chunk is carried by its chunk id.
    """
    if kind == "record":
        return document_id
    if kind in ("node", "chunk"):
        return chunk_id
    raise ValueError(f"unknown selection kind: {kind!r}")
