"""Structured records serialised into text blocks for the shared vector collection.

Pipeline A reads the warehouse only through the vector collection, so the
catalogue and operational tables (games, markets, platforms, channels,
incidents, campaigns, experiments, support cases and the taxonomies) and
the planted-pattern carriers (shared devices, shared payment methods and the
players taking part in a share, design 10a.2) are rendered as short English
sentences and indexed next to document chunks. Local names are joined from
the taxonomy tables so a block names a game's family, category and
mechanics the way the market does. A graph node is shown as these blocks
only, so the model never sees warehouse text A could not index (D-028).

This serialiser is a fixed, published function: one template per table in
``SERIALISERS``, no tuning hooks, versioned by ``RECORD_SERIALISER_VERSION``
(stamped into the index manifest and the reproducibility record). Once a
benchmark bank is built against it, its wording is frozen.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb

from app.datasets.schema import TABLE_PROVENANCE, TABLE_SCHEMAS
from app.graph.mapping import game_available_via
from app.retrieval.standard.corpus import CorpusChunk

Row = dict[str, Any]

# Bump on any change to a template, a query or the provenance suffix: the
# index must then be rebuilt (the API refuses a mismatched index).
RECORD_SERIALISER_VERSION = "2.1.0"

# Version of the structured facts a record block carries into the prompt
# (method v0.3), recorded with every run; bump on any change to them.
RECORD_FACTS_VERSION = "1.0.0"

# Player ids listed in a shared device or payment method block.
MAX_LISTED_PLAYERS = 12

_SHARED_DEVICES = """
    SELECT device_id, list(player_id ORDER BY player_id) AS player_ids
    FROM (SELECT DISTINCT device_id, player_id FROM player_device)
    GROUP BY device_id HAVING count(*) > 1
"""
_SHARED_METHODS = """
    SELECT payment_method_id, list(player_id ORDER BY player_id) AS player_ids
    FROM (SELECT DISTINCT payment_method_id, player_id FROM player_payment_method)
    GROUP BY payment_method_id HAVING count(*) > 1
"""
_GAME_NAMES = "string_agg(g.game_name || ' (' || g.game_id || ')', ', ' ORDER BY g.game_id)"

# One query per table; every query yields ``record_id`` and, where the record
# has a market, ``market_id``. Rows come back ordered by record id.
_QUERIES: dict[str, str] = {
    "games": """
        SELECT g.game_id AS record_id, g.*, m.market_name, f.name AS family_name,
            c.name AS category_name, mech.mechanic_names
        FROM games g
        JOIN markets m ON m.market_id = g.market_id
        JOIN game_families f ON f.family_id = g.game_family_id
        JOIN game_categories c ON c.category_code = g.game_category_code
        LEFT JOIN (
            SELECT gmm.game_id, string_agg(gm.mechanic_code || ' (' || gm.description || ')',
                '; ' ORDER BY gm.mechanic_id) AS mechanic_names
            FROM game_mechanic_map gmm JOIN game_mechanics gm ON gm.mechanic_id = gmm.mechanic_id
            GROUP BY gmm.game_id
        ) mech ON mech.game_id = g.game_id
        ORDER BY record_id
    """,
    "platform_versions": """
        SELECT v.platform_version_id AS record_id, v.*, p.platform_name
        FROM platform_versions v JOIN platforms p ON p.platform_id = v.platform_id
        ORDER BY record_id
    """,
    "incidents": f"""
        SELECT i.incident_id AS record_id, i.*, m.market_name, t.name AS incident_type_name,
            p.platform_name, v.version_label AS platform_version_label,
            a.version_label AS app_version_label, affected.game_names
        FROM incidents i
        LEFT JOIN markets m ON m.market_id = i.market_id
        LEFT JOIN incident_types t ON t.incident_type_id = i.incident_type
        LEFT JOIN platforms p ON p.platform_id = i.platform_id
        LEFT JOIN platform_versions v ON v.platform_version_id = i.platform_version_id
        LEFT JOIN app_versions a ON a.app_version_id = i.app_version_id
        LEFT JOIN (
            SELECT igm.incident_id, {_GAME_NAMES} AS game_names
            FROM incident_game_map igm JOIN games g ON g.game_id = igm.game_id
            GROUP BY igm.incident_id
        ) affected ON affected.incident_id = i.incident_id
        ORDER BY record_id
    """,
    "campaigns": f"""
        SELECT c.campaign_id AS record_id, c.*, m.market_name, promoted.game_names
        FROM campaigns c
        LEFT JOIN markets m ON m.market_id = c.market_id
        LEFT JOIN (
            SELECT cgm.campaign_id, {_GAME_NAMES} AS game_names
            FROM campaign_game_map cgm JOIN games g ON g.game_id = cgm.game_id
            GROUP BY cgm.campaign_id
        ) promoted ON promoted.campaign_id = c.campaign_id
        ORDER BY record_id
    """,
    "player_segments": """
        SELECT s.segment_id AS record_id, s.*, m.market_name
        FROM player_segments s LEFT JOIN markets m ON m.market_id = s.market_id
        ORDER BY record_id
    """,
    "payment_providers": """
        SELECT pp.provider_id AS record_id, pp.*, pp.home_market_id AS market_id,
            m.market_name, p.platform_name
        FROM payment_providers pp
        LEFT JOIN markets m ON m.market_id = pp.home_market_id
        LEFT JOIN platforms p ON p.platform_id = pp.platform_id
        ORDER BY record_id
    """,
    "app_versions": """
        SELECT a.app_version_id AS record_id, a.*, m.market_name
        FROM app_versions a LEFT JOIN markets m ON m.market_id = a.market_id
        ORDER BY record_id
    """,
    "game_families": """
        SELECT f.family_id AS record_id, f.*, m.market_name
        FROM game_families f LEFT JOIN markets m ON m.market_id = f.market_id
        ORDER BY record_id
    """,
    "game_mechanics": """
        SELECT gm.mechanic_id AS record_id, gm.*, m.market_name
        FROM game_mechanics gm LEFT JOIN markets m ON m.market_id = gm.market_id
        ORDER BY record_id
    """,
    "incident_types": """
        SELECT t.incident_type_id AS record_id, t.*, m.market_name
        FROM incident_types t LEFT JOIN markets m ON m.market_id = t.market_id
        ORDER BY record_id
    """,
    "support_categories": """
        SELECT s.support_category_id AS record_id, s.*, m.market_name
        FROM support_categories s LEFT JOIN markets m ON m.market_id = s.market_id
        ORDER BY record_id
    """,
    "markets": """
        SELECT m.market_id AS record_id, m.*
        FROM markets m
        ORDER BY record_id
    """,
    "platforms": """
        SELECT p.platform_id AS record_id, p.*, s.name AS supplier_name
        FROM platforms p LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id
        ORDER BY record_id
    """,
    "channels": """
        SELECT c.channel_code AS record_id, c.*
        FROM channels c
        ORDER BY record_id
    """,
    "experiments": """
        SELECT e.experiment_id AS record_id, e.*, m.market_name,
            seg.name AS target_segment_name
        FROM experiments e
        LEFT JOIN markets m ON m.market_id = e.market_id
        LEFT JOIN player_segments seg ON seg.segment_id = e.target_segment
        ORDER BY record_id
    """,
    "support_cases": """
        SELECT s.support_case_id AS record_id, s.*, m.market_name,
            c.name AS category_name, g.game_name
        FROM support_cases s
        LEFT JOIN markets m ON m.market_id = s.market_id
        LEFT JOIN support_categories c ON c.support_category_id = s.category_code
        LEFT JOIN games g ON g.game_id = s.game_id
        ORDER BY record_id
    """,
    "devices": f"""
        SELECT d.device_id AS record_id, d.*, shared.player_ids
        FROM devices d JOIN ({_SHARED_DEVICES}) shared ON shared.device_id = d.device_id
        ORDER BY record_id
    """,
    "payment_methods": f"""
        SELECT pm.payment_method_id AS record_id, pm.*, pp.name AS provider_name,
            shared.player_ids
        FROM payment_methods pm
        JOIN ({_SHARED_METHODS}) shared ON shared.payment_method_id = pm.payment_method_id
        LEFT JOIN payment_providers pp ON pp.provider_id = pm.provider_id
        ORDER BY record_id
    """,
    "players": f"""
        SELECT p.player_id AS record_id, p.*, m.market_name,
            vs.name AS value_segment_name, es.name AS engagement_segment_name
        FROM players p
        LEFT JOIN markets m ON m.market_id = p.market_id
        LEFT JOIN player_segments vs ON vs.segment_id = p.value_segment
        LEFT JOIN player_segments es ON es.segment_id = p.engagement_segment
        WHERE p.player_id IN (
            SELECT player_id FROM player_device
            WHERE device_id IN (SELECT device_id FROM ({_SHARED_DEVICES}))
            UNION
            SELECT player_id FROM player_payment_method
            WHERE payment_method_id IN (SELECT payment_method_id FROM ({_SHARED_METHODS}))
        )
        ORDER BY record_id
    """,
}

# Validity window columns (valid_from, valid_to) per table, shared by record
# blocks and authoritative facts. They match graph ingestion except that an
# incident's resolution is not the end of its validity.
VALIDITY_COLUMNS: dict[str, tuple[str | None, str | None]] = {
    "games": ("launch_date", "retirement_date"),
    "platform_versions": ("released_at", "retired_at"),
    "incidents": ("started_at", None),
    "campaigns": ("start_at", "end_at"),
    "app_versions": ("released_at", None),
    "experiments": ("start_at", "end_at"),
    "support_cases": ("opened_at", None),
    "documents": ("valid_from", "valid_to"),
}


def _join(*sentences: str | None) -> str:
    return " ".join(sentence for sentence in sentences if sentence)


def _opt(value: object, sentence: str) -> str | None:
    """The sentence when its value exists; ``None`` fields are omitted, never printed."""
    return sentence if value is not None else None


def _in(r: Row) -> str:
    return f" in {r['market_name']}" if r["market_name"] is not None else ""


def _channels(r: Row) -> str | None:
    return ", ".join(game_available_via(r)) or None


def _players(ids: list[str]) -> str:
    listed = ", ".join(ids[:MAX_LISTED_PLAYERS])
    extra = len(ids) - MAX_LISTED_PLAYERS
    return f"{listed} and {extra} more" if extra > 0 else listed


SERIALISERS: dict[str, Callable[[Row], str]] = {
    "games": lambda r: _join(
        f"{r['game_name']} ({r['game_id']}) is a {r['family_name']} game in {r['market_name']}.",
        f"Ticket price {r['ticket_price']} {r['currency_code']}.",
        f"Category {r['category_name']}.",
        _opt(r["mechanic_names"], f"Mechanics: {r['mechanic_names']}."),
        _opt(_channels(r), f"Channels: {_channels(r)}."),
        f"Launched {r['launch_date']}.",
        _opt(r["retirement_date"], f"Retired {r['retirement_date']}."),
        f"Status {r['status']}.",
    ),
    "platform_versions": lambda r: _join(
        f"Platform version {r['version_label']} ({r['platform_version_id']}) of"
        f" {r['platform_name']} ({r['platform_id']}).",
        f"Released {r['released_at']}.",
        _opt(r["retired_at"], f"Retired {r['retired_at']}."),
    ),
    "incidents": lambda r: _join(
        f"Incident {r['incident_id']}{_in(r)}: {r['summary']}",
        f"Type {r['incident_type_name']} ({r['incident_type']}). Severity {r['severity']}.",
        f"Platform {r['platform_name']} ({r['platform_id']}).",
        _opt(
            r["platform_version_id"],
            f"Platform version {r['platform_version_label']} ({r['platform_version_id']}).",
        ),
        _opt(r["app_version_id"], f"App version {r['app_version_label']} ({r['app_version_id']})."),
        _opt(r["game_names"], f"Affected games: {r['game_names']}."),
        f"Started {r['started_at']}.",
        _opt(r["resolved_at"], f"Resolved {r['resolved_at']}."),
        _opt(r["root_cause_code"], f"Root cause {r['root_cause_code']}."),
    ),
    "campaigns": lambda r: _join(
        f"Campaign {r['campaign_name']} ({r['campaign_id']}){_in(r)}.",
        f"Type {r['campaign_type']}. Objective {r['objective_code']}.",
        f"Budget {r['budget_amount']} {r['currency_code']}.",
        _opt(r["game_names"], f"Promoted games: {r['game_names']}."),
        f"Starts {r['start_at']}.",
        _opt(r["end_at"], f"Ends {r['end_at']}."),
    ),
    "player_segments": lambda r: _join(
        f"Player segment {r['name']} ({r['segment_id']}){_in(r)}.",
        f"Kind {r['segment_kind']}. Language {r['language_code']}.",
    ),
    "payment_providers": lambda r: _join(
        f"Payment provider {r['name']} ({r['provider_id']}) on platform"
        f" {r['platform_name']} ({r['platform_id']}).",
        _opt(r["market_name"], f"Home market {r['market_name']}."),
    ),
    "app_versions": lambda r: _join(
        f"App version {r['version_label']} ({r['app_version_id']}){_in(r)}.",
        f"Released {r['released_at']}.",
        _opt(r["min_os_bucket"], f"Minimum OS {r['min_os_bucket']}."),
    ),
    "game_families": lambda r: _join(
        f"Game family {r['name']} ({r['family_id']}){_in(r)}.",
        f"Language {r['language_code']}.",
    ),
    "game_mechanics": lambda r: _join(
        f"Game mechanic {r['mechanic_code']} ({r['mechanic_id']}){_in(r)}: {r['description']}.",
        f"Language {r['language_code']}.",
    ),
    "incident_types": lambda r: _join(
        f"Incident type {r['name']} ({r['incident_type_id']}){_in(r)}.",
        f"Language {r['language_code']}.",
    ),
    "support_categories": lambda r: _join(
        f"Support category {r['name']} ({r['support_category_id']}){_in(r)}.",
        f"Language {r['language_code']}.",
    ),
    "markets": lambda r: _join(
        f"Market {r['market_name']} ({r['market_id']}), market code {r['market_code']}.",
        f"Currency {r['currency_code']}. Primary language {r['primary_language']}.",
        f"Time zone {r['timezone']}.",
    ),
    "platforms": lambda r: _join(
        f"Platform {r['platform_name']} ({r['platform_id']}) of type {r['platform_type']},"
        f" supplied by {r['supplier_name']} ({r['supplier_id']}).",
    ),
    "channels": lambda r: f"Channel {r['channel_code']}: {r['description']}.",
    "experiments": lambda r: _join(
        f"Experiment {r['experiment_name']} ({r['experiment_id']}){_in(r)}.",
        f"Hypothesis: {r['hypothesis']}.",
        _opt(
            r["target_segment"],
            f"Target segment {r['target_segment_name']} ({r['target_segment']}).",
        ),
        f"Primary metric {r['primary_metric']}.",
        f"Starts {r['start_at']}.",
        _opt(r["end_at"], f"Ends {r['end_at']}."),
        _opt(r["result_summary"], f"Result: {r['result_summary']}"),
    ),
    "support_cases": lambda r: _join(
        f"Support case {r['support_case_id']}{_in(r)}: {r['summary_text']}",
        f"Category {r['category_name']} ({r['category_code']}).",
        _opt(r["player_id"], f"Player {r['player_id']}."),
        _opt(r["game_id"], f"Game {r['game_name']} ({r['game_id']})."),
        _opt(r["incident_id"], f"Incident {r['incident_id']}."),
        f"Opened {r['opened_at']}.",
        _opt(r["closed_at"], f"Closed {r['closed_at']}."),
        f"Sentiment score {r['sentiment_score']}.",
    ),
    "devices": lambda r: _join(
        f"Device {r['device_id']} ({r['device_family']}) is used by {len(r['player_ids'])}"
        f" player accounts: {_players(r['player_ids'])}.",
        _opt(r["os_version_bucket"], f"OS version {r['os_version_bucket']}."),
        _opt(r["first_seen_at"], f"First seen {r['first_seen_at']}."),
    ),
    "payment_methods": lambda r: _join(
        f"Payment method {r['payment_method_id']} ({r['payment_type']}, provider"
        f" {r['provider_name']}) is used by {len(r['player_ids'])}"
        f" player accounts: {_players(r['player_ids'])}.",
        _opt(r["created_at"], f"Created {r['created_at']}."),
    ),
    "players": lambda r: _join(
        f"Player {r['player_id']}{_in(r)}.",
        f"Value segment {r['value_segment_name']} ({r['value_segment']}).",
        f"Engagement segment {r['engagement_segment_name']} ({r['engagement_segment']}).",
        f"Registered {r['registration_date']}.",
    ),
}


@dataclass(frozen=True, slots=True)
class RecordBlock:
    """One serialised warehouse row, ready to index as a corpus chunk."""

    record_id: str
    table: str
    market_id: str | None
    text: str
    source_system: str
    valid_from: str | None
    valid_to: str | None

    def to_corpus_chunk(self) -> CorpusChunk:
        return CorpusChunk(
            chunk_id=f"REC_{self.table}_{self.record_id}",
            document_id=self.record_id,
            chunk_index=0,
            text=self.text,
            title=f"{self.table}: {self.record_id}",
            document_type=self.table.upper(),
            # Market-less records (corporate taxonomy, devices) are shared evidence:
            # every market scope admits the empty market.
            market_id=self.market_id or "",
            language_code="en",
            source_system=self.source_system,
            valid_from=self.valid_from,
            valid_to=self.valid_to,
            kind="record",
            record_table=self.table,
        )


def _render(value: Any) -> Any:
    """ISO dates, ISO date-times without microseconds, two-decimal money."""
    if isinstance(value, datetime):
        return value.replace(microsecond=0).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    return value


def _rows(connection: duckdb.DuckDBPyConnection, query: str) -> list[Row]:
    cursor = connection.execute(query)
    columns = [column[0] for column in cursor.description]
    return [
        {name: _render(value) for name, value in zip(columns, row, strict=True)}
        for row in cursor.fetchall()
    ]


def _block(table: str, row: Row) -> RecordBlock:
    source_system, _ = TABLE_PROVENANCE[table]
    record_id = str(row["record_id"])
    provenance = f"Source: {source_system} table {table}, record {record_id}."
    valid_from, valid_to = VALIDITY_COLUMNS.get(table, (None, None))
    return RecordBlock(
        record_id=record_id,
        table=table,
        market_id=row.get("market_id"),
        text=f"{SERIALISERS[table](row)} {provenance}",
        source_system=source_system,
        valid_from=row[valid_from] if valid_from else None,
        valid_to=row[valid_to] if valid_to else None,
    )


def serialise_records(dataset_dir: Path) -> list[RecordBlock]:
    """Every serialisable record of the dataset, ordered by table then record id."""
    connection = duckdb.connect()
    try:
        for table in TABLE_SCHEMAS:
            path = (dataset_dir / f"{table}.parquet").as_posix().replace("'", "''")
            connection.execute(f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{path}')")
        return [
            _block(table, row)
            for table, query in _QUERIES.items()
            for row in _rows(connection, query)
        ]
    finally:
        connection.close()


def records_manifest(blocks: list[RecordBlock]) -> dict[str, Any]:
    """Block counts in total and per table, in serialisation order."""
    return {"total": len(blocks), "by_table": dict(Counter(block.table for block in blocks))}
