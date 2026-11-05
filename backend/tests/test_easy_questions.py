"""The easy-to-read wordings of the Live Lab's saved questions (D-108)."""

from __future__ import annotations

import hashlib
import re

import pyarrow.parquet as pq
import pytest
from app.api.easy_questions import EASY_WORDINGS, WRITTEN_FOR_WORLD, easy_wording
from app.datasets.document_templates import MARKET_NAMES
from app.evaluation.official import DATA_DIR

ID_TOKEN = re.compile(r"\b[A-Z]{2,12}(?:_[A-Z0-9]+)+\b")
WORLD = DATA_DIR / "generated" / "dev-seed2026"
# Countries as the wordings name them; the UK by its everyday short name.
COUNTRY = {**MARKET_NAMES["en"], "MKT_UK": "UK"}


def _anchor(instance_id: str) -> str:
    """The record id an instance id ends with: L05-2026-INC_037 -> INC_037."""
    return instance_id.split("-", 2)[2]


@pytest.mark.parametrize("instance_id", sorted(EASY_WORDINGS))
def test_a_wording_names_only_its_own_record_id_in_brackets(instance_id: str) -> None:
    wording = EASY_WORDINGS[instance_id]
    anchor = _anchor(instance_id)
    assert ID_TOKEN.findall(wording) == [anchor]
    assert f"({anchor})" in wording
    assert wording.endswith("?")


def test_a_wording_is_served_only_for_the_world_it_was_written_from() -> None:
    instance_id = next(iter(EASY_WORDINGS))
    assert easy_wording(instance_id, WRITTEN_FOR_WORLD) == EASY_WORDINGS[instance_id]
    assert easy_wording(instance_id, "0" * 64) is None
    assert easy_wording("L99-2026-NONE_1", WRITTEN_FOR_WORLD) is None


def _rows(table: str, key: str) -> dict[str, dict[str, object]]:
    return {row[key]: row for row in pq.read_table(WORLD / f"{table}.parquet").to_pylist()}


@pytest.mark.skipif(not WORLD.is_dir(), reason="the development world is not generated here")
def test_each_wording_names_its_record_as_the_world_holds_it() -> None:
    """Against data/generated/dev-seed2026: the manifest is the one the
    wordings were written for, and each names its record's country and its
    game name or start date as the world records them."""
    assert hashlib.sha256((WORLD / "_manifest.json").read_bytes()).hexdigest() == (
        WRITTEN_FOR_WORLD
    )
    games = _rows("games", "game_id")
    incidents = _rows("incidents", "incident_id")
    for instance_id, wording in EASY_WORDINGS.items():
        anchor = _anchor(instance_id)
        record = games.get(anchor) or incidents[anchor]
        assert COUNTRY[str(record["market_id"])] in wording, instance_id
        if anchor in games:
            assert str(record["game_name"]) in wording, instance_id
        else:
            started = record["started_at"]
            assert f"{started.day} {started:%B %Y}" in wording, instance_id  # type: ignore[attr-defined]
