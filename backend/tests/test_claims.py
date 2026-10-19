"""Claim payload tests (docs/plans Phase 3 benchmark v2, Task 2)."""

from __future__ import annotations

from app.evaluation.claims import Claim, claim_from_payload


def test_claim_payload_round_trip() -> None:
    claim = Claim("c1", "The price is 2.50 GBP.", frozenset({"REC_B", "REC_A"}))
    payload = claim.to_payload()
    assert payload["carriers"] == ["REC_A", "REC_B"]
    assert claim_from_payload(payload) == claim
