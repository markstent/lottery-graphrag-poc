"""Answer claims: the statements a correct answer makes and the source
records that carry them (benchmark v2)."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast


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
