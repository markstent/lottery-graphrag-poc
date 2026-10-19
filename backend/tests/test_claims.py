"""Claim payloads, carrier sets and anchor exclusion (Phase 3 benchmark v2, Tasks 2 and 3)."""

from __future__ import annotations

from typing import Any

import pytest
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.evaluation.claims import (
    CarrierIndex,
    Claim,
    ClaimSpec,
    claim_from_payload,
    exclude_anchor,
    selection_carrier,
)


def _incident(incident_id: str, summary: str) -> tuple[Any, ...]:
    return (incident_id, None, None, None, None, None, "high", None, None, summary, None)


@pytest.fixture(scope="module")
def carrier_index(tmp_path_factory: pytest.TempPathFactory) -> CarrierIndex:
    """A two-record, one-chunk world in the real Parquet layout."""
    tables: dict[str, list[Any]] = {name: [] for name in TABLE_SCHEMAS}
    tables["incidents"] = [
        _incident("INC_X", "Draw results were delayed."),
        _incident("INC_Z", "Login failures on PLV_Y_2 after the release."),
    ]
    tables["document_chunks"] = [
        ("CHNK_0001_00", "DOC_0001", 0, "The outage inc_x ran on PLV_Y.", 7, "v1"),
        ("CHNK_0002_00", "DOC_0002", 0, "Unrelated maintenance note.", 3, "v1"),
    ]
    world_dir = tmp_path_factory.mktemp("carrier-world")
    write_world(world_dir, TABLE_SCHEMAS, tables)
    return CarrierIndex.build(world_dir)


def test_claim_payload_round_trip() -> None:
    claim = Claim("c1", "The price is 2.50 GBP.", frozenset({"REC_B", "REC_A"}))
    payload = claim.to_payload()
    assert payload["carriers"] == ["REC_A", "REC_B"]
    assert claim_from_payload(payload) == claim


def test_carriers_include_records_and_chunks_that_state_the_fact(
    carrier_index: CarrierIndex,
) -> None:
    spec = ClaimSpec("c1", "INC_X ran on PLV_Y", ("INC_X",), (("INC_X",), ("PLV_Y",)))
    assert carrier_index.carriers(spec) == frozenset({"INC_X", "CHNK_0001_00"})


def test_a_marker_group_matches_any_of_its_alternatives(carrier_index: CarrierIndex) -> None:
    spec = ClaimSpec("c1", "s", (), (("delayed", "maintenance"),))
    assert carrier_index.carriers(spec) == frozenset({"INC_X", "CHNK_0002_00"})


def test_markers_match_whole_words_only(carrier_index: CarrierIndex) -> None:
    spec = ClaimSpec("c1", "s", (), (("PLV_Y_2",),))
    assert carrier_index.carriers(spec) == frozenset({"INC_Z"})
    assert carrier_index.carriers(ClaimSpec("c2", "s", (), (("PLV",),))) == frozenset()


def test_declared_documents_carry_through_every_chunk(carrier_index: CarrierIndex) -> None:
    spec = ClaimSpec("c1", "s", ("INC_Z",), (), document_ids=("DOC_0002",))
    assert carrier_index.carriers(spec) == frozenset({"INC_Z", "CHNK_0002_00"})


@pytest.mark.parametrize(
    "spec",
    [
        ClaimSpec("c1", "s", ("INC_TYPO",), ()),
        ClaimSpec("c1", "s", ("INC_X",), (), document_ids=("DOC_9999",)),
    ],
)
def test_ids_absent_from_the_world_are_refused(
    carrier_index: CarrierIndex, spec: ClaimSpec
) -> None:
    with pytest.raises(ValueError, match="absent from the world"):
        carrier_index.carriers(spec)


def test_anchor_exclusion_drops_claims_carried_only_by_the_anchor() -> None:
    claims = (
        Claim("a", "s", frozenset({"GAME_UK_01"})),
        Claim("b", "s", frozenset({"GAME_UK_01", "CHNK_1"})),
    )
    assert exclude_anchor(claims, "GAME_UK_01") == (Claim("b", "s", frozenset({"CHNK_1"})),)


@pytest.mark.parametrize(
    ("kind", "expected"),
    [("record", "INC_001"), ("node", "NODE_1"), ("chunk", "NODE_1")],
)
def test_selection_carrier_names_the_id_a_claim_carrier_uses(kind: str, expected: str) -> None:
    assert selection_carrier(kind, "NODE_1", "INC_001") == expected


def test_selection_carrier_rejects_an_unknown_kind() -> None:
    with pytest.raises(ValueError, match="selection kind"):
        selection_carrier("edge", "X", "Y")
