"""Structured records serialised into text blocks for the shared vector collection,
and the compact facts the prompt shows for them (D-085).

The fact-block goldens pin the rendered prompt block of the first record of
each table in the tiny world (seed 42, scenarios applied); regenerate them
only for an intended, reviewed change (``python -m tests.test_records`` from
backend/).
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import duckdb
import pytest
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.retrieval.graph.source_lookup import NODE_SOURCES, SNIPPET_COLUMNS
from app.retrieval.standard.generation import context_block
from app.retrieval.standard.records import (
    _QUERIES,
    FACT_SERIALISERS,
    RECORD_SERIALISER_VERSION,
    SERIALISERS,
    RecordBlock,
    _fact_value,
    _rows,
    records_manifest,
    serialise_records,
)
from app.scenarios.engine import apply_scenarios

FACT_BLOCKS = Path(__file__).parent / "fixtures" / "golden" / "fact_blocks.json"


def write_tiny_world(dataset_dir: Path) -> Path:
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    apply_scenarios(world)
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    return dataset_dir


@pytest.fixture(scope="module")
def world_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_tiny_world(tmp_path_factory.mktemp("tiny-world-records"))


def fact_blocks(dataset_dir: Path) -> dict[str, str]:
    """The prompt block of the first record of each table, as A shows it."""
    rendered: dict[str, str] = {}
    for block in serialise_records(dataset_dir):
        if block.table not in rendered:
            evidence = block.to_corpus_chunk().to_evidence(similarity=0.0, rank=1)
            rendered[block.table] = context_block(evidence)
    return rendered


def first_rows(dataset_dir: Path) -> dict[str, dict[str, Any]]:
    """The first row of each serialised table, as the serialisers read it."""
    connection = duckdb.connect()
    try:
        for table in TABLE_SCHEMAS:
            path = (dataset_dir / f"{table}.parquet").as_posix()
            connection.execute(f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{path}')")
        return {table: _rows(connection, query)[0] for table, query in _QUERIES.items()}
    finally:
        connection.close()


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


def test_incident_block_states_every_graph_snippet_fact(
    world_dir: Path, blocks: list[RecordBlock]
) -> None:
    """Pipeline A's incident block and B/C's incident snippet cannot drift apart.

    Every snippet column's value appears in the block; the market is stated by
    its name in the text and by its id on the block.
    """
    columns = SNIPPET_COLUMNS["incidents"]
    selected = ", ".join(f"i.{column}" for column in columns)
    connection = duckdb.connect()
    try:
        cursor = connection.execute(
            f"SELECT {selected}, m.market_name FROM read_parquet(?) i"
            " JOIN read_parquet(?) m ON m.market_id = i.market_id"
            " WHERE i.root_cause_code IS NOT NULL AND i.resolved_at IS NOT NULL"
            " ORDER BY i.incident_id LIMIT 1",
            [str(world_dir / "incidents.parquet"), str(world_dir / "markets.parquet")],
        )
        row = dict(zip([*columns, "market_name"], cursor.fetchone() or (), strict=True))
    finally:
        connection.close()
    incident_id = row.pop("incident_id")
    block = next(b for b in blocks if b.record_id == incident_id)
    assert block.market_id == row.pop("market_id")
    for column in ("started_at", "resolved_at"):
        row[column] = row[column].replace(microsecond=0).isoformat()
    for column, value in row.items():
        assert str(value) in block.text, column


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


def test_every_graph_label_with_warehouse_text_has_a_record_block() -> None:
    """The judge and the model see only text A could index (D-028): every
    structured label's table is serialised, except players outside a share
    (design 10a.2) and payment-method links, which are blocks only for
    shared instruments."""
    tables = {table for table, _ in NODE_SOURCES.values()}
    unserialised = tables - set(SERIALISERS)
    assert unserialised == {"player_payment_method"}
    assert {"support_cases", "experiments", "markets", "platforms", "channels"} <= set(SERIALISERS)


def test_serialiser_version_is_published() -> None:
    assert RECORD_SERIALISER_VERSION == "2.1.0"


def test_support_case_block_states_its_summary_and_category(
    world_dir: Path, blocks: list[RecordBlock]
) -> None:
    cases = [b for b in blocks if b.table == "support_cases"]
    connection = duckdb.connect()
    try:
        total, summary, category, market = connection.execute(
            "SELECT count(*) OVER (), s.summary_text, c.name, s.market_id"
            " FROM read_parquet(?) s JOIN read_parquet(?) c"
            " ON c.support_category_id = s.category_code ORDER BY s.support_case_id LIMIT 1",
            [
                str(world_dir / "support_cases.parquet"),
                str(world_dir / "support_categories.parquet"),
            ],
        ).fetchone() or (0, "", "", "")
    finally:
        connection.close()
    assert len(cases) == total
    first = cases[0]
    assert summary in first.text and category in first.text and first.market_id == market
    assert first.source_system == "support_platform"


def test_experiment_market_platform_and_channel_blocks(blocks: list[RecordBlock]) -> None:
    by_table = Counter(block.table for block in blocks)
    assert by_table["markets"] == 4 and by_table["channels"] == 3
    assert by_table["platforms"] > 0 and by_table["experiments"] > 0
    experiment = next(b for b in blocks if b.table == "experiments")
    assert "Hypothesis" in experiment.text and "Result" in experiment.text
    assert experiment.market_id and experiment.valid_from is not None
    market = next(b for b in blocks if b.record_id == "MKT_GR")
    assert "Greece" in market.text and market.market_id == "MKT_GR"
    platform = next(b for b in blocks if b.table == "platforms")
    assert platform.market_id is None and "supplied by" in platform.text
    channel = next(b for b in blocks if b.record_id == "APP")
    assert channel.market_id is None and "Mobile application" in channel.text


def test_payment_provider_block_market_is_its_home_market(blocks: list[RecordBlock]) -> None:
    provider = next(b for b in blocks if b.table == "payment_providers" and b.market_id)
    assert provider.market_id is not None and provider.market_id.startswith("MKT_")


# -- compact facts (D-085) --------------------------------------------------------------

_SENTINEL = re.compile(r"SNT\d+X")


def _sentinel_row(row: dict[str, Any]) -> dict[str, Any]:
    """The row with a unique sentinel in every column; flags keep their
    booleans (they select channels, not text) and a list gets two sentinels."""
    count = 0
    marked: dict[str, Any] = {}
    for column, value in row.items():
        if isinstance(value, bool):
            marked[column] = value
            continue
        size = 2 if isinstance(value, list) else 1
        values = [f"SNT{count + index}X" for index in range(size)]
        count += size
        marked[column] = values if isinstance(value, list) else values[0]
    return marked


def _fact_text(table: str, row: dict[str, Any]) -> str:
    heading, facts = FACT_SERIALISERS[table](row)
    return "\n".join([heading, *(f"{name}: {value}" for name, value in facts)])


def test_every_serialised_table_has_facts() -> None:
    assert FACT_SERIALISERS.keys() == SERIALISERS.keys()


def test_facts_hold_no_column_absent_from_the_record_block(world_dir: Path) -> None:
    """D-028 holds for the facts: every value they state is in the record
    block A indexes, or is its market id, which every v0.2 prompt block
    showed on its title line."""
    for table, row in first_rows(world_dir).items():
        marked = _sentinel_row(row)
        stated = set(_SENTINEL.findall(_fact_text(table, marked)))
        indexed = set(_SENTINEL.findall(SERIALISERS[table](marked)))
        assert stated, table
        assert stated <= indexed | {marked.get("market_id")}, table


def test_facts_state_every_column_of_the_record_block(world_dir: Path) -> None:
    """Facts are the record block with less filler, never with less content."""
    for table, row in first_rows(world_dir).items():
        marked = _sentinel_row(row)
        indexed = set(_SENTINEL.findall(SERIALISERS[table](marked)))
        assert indexed <= set(_SENTINEL.findall(_fact_text(table, marked))), table


@pytest.mark.parametrize("table", list(SERIALISERS))
def test_fact_block_golden(world_dir: Path, table: str) -> None:
    expected = json.loads(FACT_BLOCKS.read_text(encoding="utf-8"))
    assert fact_blocks(world_dir)[table] == expected[table]


def test_fact_block_golden_covers_every_table() -> None:
    assert json.loads(FACT_BLOCKS.read_text(encoding="utf-8")).keys() == SERIALISERS.keys()


def test_midnight_dropped_other_times_kept() -> None:
    assert _fact_value("2025-08-19T00:00:00") == "2025-08-19"
    assert _fact_value("2025-03-05T23:32:47") == "2025-03-05 23:32:47"
    assert _fact_value("2025-08-19") == "2025-08-19"
    assert _fact_value("Seen at 2025-08-19T00:00:00.") == "Seen at 2025-08-19T00:00:00."
    assert _fact_value(-0.295) == "-0.295"


def test_omitted_facts_are_never_printed_as_none(blocks: list[RecordBlock]) -> None:
    for block in blocks:
        assert all(value != "None" for _name, value in block.facts), block.record_id
        assert block.heading.endswith(f" {block.record_id}")


def test_index_payload_unchanged(blocks: list[RecordBlock]) -> None:
    """The facts never reach the index: the payload keys and the indexed text
    are those of serialiser 2.1.0, so no re-index is needed."""
    chunk = next(b for b in blocks if b.table == "incidents").to_corpus_chunk()
    assert chunk.facts_heading is not None and chunk.facts
    assert chunk.to_payload().keys() == {
        "chunk_id",
        "document_id",
        "chunk_index",
        "title",
        "document_type",
        "market_id",
        "language_code",
        "source_system",
        "valid_from",
        "valid_to",
        "text",
        "kind",
        "record_table",
    }
    assert chunk.to_payload()["text"] == chunk.text
    assert RECORD_SERIALISER_VERSION == "2.1.0"


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        rendered = fact_blocks(write_tiny_world(Path(directory)))
    FACT_BLOCKS.write_text(json.dumps(rendered, indent=1, ensure_ascii=False) + "\n")
