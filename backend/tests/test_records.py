"""Structured records serialised into text blocks for the shared vector collection."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.retrieval.standard.records import (
    SERIALISERS,
    RecordBlock,
    records_manifest,
    serialise_records,
)
from app.scenarios.engine import apply_scenarios


@pytest.fixture(scope="module")
def world_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    apply_scenarios(world)
    dataset_dir = tmp_path_factory.mktemp("tiny-world-records")
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def blocks(world_dir: Path) -> list[RecordBlock]:
    return serialise_records(world_dir)


def test_serialises_every_catalogue_record_once(blocks: list[RecordBlock]) -> None:
    by_table = Counter(block.table for block in blocks)
    assert by_table["games"] == 20 and by_table["payment_providers"] == 6
    assert len({b.record_id for b in blocks if b.table == "games"}) == 20


def test_game_block_names_local_family_and_price(blocks: list[RecordBlock]) -> None:
    block = next(b for b in blocks if b.record_id == "GAME_AT_01")
    assert "Zahlenziehung" in block.text and "2.50 EUR" in block.text and "GAME_AT_01" in block.text


def test_shared_devices_and_instruments_become_blocks_with_their_players(
    blocks: list[RecordBlock],
) -> None:
    shared = [b for b in blocks if b.table in ("devices", "payment_methods")]
    assert {b.table for b in shared} == {"devices", "payment_methods"}
    assert all("player accounts" in b.text for b in shared)


def test_share_participants_become_player_blocks(blocks: list[RecordBlock]) -> None:
    players = {b.record_id for b in blocks if b.table == "players"}
    shared = [b for b in blocks if b.table in ("devices", "payment_methods")]
    named = {word.rstrip(".,") for b in shared for word in b.text.split() if "PLAYER_" in word}
    assert named and named <= players
    sample = next(b for b in blocks if b.table == "players")
    assert sample.market_id and "Registered" in sample.text and "segment" in sample.text


def test_long_player_lists_are_capped() -> None:
    ids = [f"PLAYER_UK_{n:06d}" for n in range(15)]
    row = {
        "device_id": "DEV_UK_000001",
        "device_family": "IOS",
        "player_ids": ids,
        "os_version_bucket": None,
        "first_seen_at": None,
    }
    text = SERIALISERS["devices"](row)
    assert "used by 15 player accounts" in text and text.endswith("and 3 more.")
    assert text.count("PLAYER_") == 12


def test_record_block_to_corpus_chunk_is_marked_as_record(blocks: list[RecordBlock]) -> None:
    chunk = blocks[0].to_corpus_chunk()
    assert chunk.kind == "record" and chunk.chunk_id.startswith("REC_")
    assert chunk.record_table == blocks[0].table
    payload = chunk.to_payload()
    assert payload["kind"] == "record" and payload["record_table"] == blocks[0].table
    evidence = chunk.to_evidence(similarity=0.5, rank=1)
    assert evidence.kind == "record" and evidence.record_table == blocks[0].table


def test_every_block_ends_with_provenance(blocks: list[RecordBlock]) -> None:
    for block in blocks:
        assert block.text.endswith(
            f"Source: {block.source_system} table {block.table}, record {block.record_id}."
        )
        assert "None" not in block.text


def test_formatting_of_dates_and_timestamps(blocks: list[RecordBlock]) -> None:
    incident = next(b for b in blocks if b.table == "incidents")
    assert incident.valid_from is not None and "T" in incident.valid_from
    assert "." not in incident.valid_from
    assert incident.valid_to is None
    game = next(b for b in blocks if b.record_id == "GAME_AT_01")
    assert game.market_id == "MKT_AT" and game.valid_from is not None
    assert len(game.valid_from) == 10


def test_order_is_deterministic_by_table_then_id(world_dir: Path) -> None:
    first = serialise_records(world_dir)
    assert first == serialise_records(world_dir)
    tables = list(dict.fromkeys(b.table for b in first))
    for table in tables:
        ids = [b.record_id for b in first if b.table == table]
        assert ids == sorted(ids)
    assert tables[0] == "games" and tables[-1] == "players"


def test_records_manifest_counts_per_table(blocks: list[RecordBlock]) -> None:
    manifest = records_manifest(blocks)
    assert manifest["total"] == len(blocks)
    assert manifest["by_table"]["games"] == 20
