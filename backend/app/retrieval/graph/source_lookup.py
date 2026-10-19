"""Authoritative source lookup for graph evidence.

The graph guides retrieval; quantitative facts come from the structured
layer (AGENTS.md Graph Augmentation Principle). For each selected structured
node this module reads the authoritative warehouse row from the dataset
Parquet via DuckDB and renders a compact factual snippet that the generator
must quote rather than invent.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb

# Graph label -> (parquet table, id column). Only labels whose rows carry
# facts an answer might quote.
NODE_SOURCES: dict[str, tuple[str, str]] = {
    "Incident": ("incidents", "incident_id"),
    "PlatformVersion": ("platform_versions", "platform_version_id"),
    "AppVersion": ("app_versions", "app_version_id"),
    "Game": ("games", "game_id"),
    "Market": ("markets", "market_id"),
    "Player": ("players", "player_id"),
    "PaymentProvider": ("payment_providers", "provider_id"),
    "IncidentType": ("incident_types", "incident_type_id"),
    "GameFamily": ("game_families", "family_id"),
    "SupportCategory": ("support_categories", "support_category_id"),
    "PlayerSegment": ("player_segments", "segment_id"),
    "Platform": ("platforms", "platform_id"),
    "Channel": ("channels", "channel_code"),
    "Campaign": ("campaigns", "campaign_id"),
    "Experiment": ("experiments", "experiment_id"),
    "SupportCase": ("support_cases", "support_case_id"),
}

# Columns quoted in the snippet, per table, in order. Kept small on purpose:
# the snippet is evidence, not a row dump.
SNIPPET_COLUMNS: dict[str, tuple[str, ...]] = {
    "incidents": (
        "incident_id",
        "market_id",
        "severity",
        "incident_type",
        "started_at",
        "resolved_at",
        "summary",
        "root_cause_code",
    ),
    "platform_versions": ("platform_version_id", "platform_id", "version_label", "released_at"),
    "app_versions": ("app_version_id", "market_id", "version_label", "released_at"),
    "games": (
        "game_id",
        "game_name",
        "market_id",
        "game_family_id",
        "ticket_price",
        "currency_code",
    ),
    "documents": (
        "document_id",
        "document_type",
        "market_id",
        "language_code",
        "title",
        "valid_from",
        "valid_to",
    ),
    "markets": ("market_id", "market_name", "currency_code"),
    "players": ("player_id", "market_id", "account_status", "value_segment"),
    "payment_providers": ("provider_id", "name", "home_market_id", "platform_id"),
    "incident_types": ("incident_type_id", "market_id", "name", "language_code"),
    "game_families": ("family_id", "market_id", "name", "language_code"),
    "support_categories": ("support_category_id", "market_id", "name", "language_code"),
    "player_segments": ("segment_id", "market_id", "segment_kind", "name", "language_code"),
    "channels": ("channel_code", "description"),
    "platforms": ("platform_id", "platform_name", "platform_type", "supplier_id"),
    "campaigns": (
        "campaign_id",
        "market_id",
        "campaign_name",
        "objective_code",
        "start_at",
        "end_at",
    ),
    "experiments": (
        "experiment_id",
        "market_id",
        "experiment_name",
        "primary_metric",
        "result_summary",
    ),
    "support_cases": ("support_case_id", "market_id", "category_code", "opened_at", "summary_text"),
}

# PaymentMethod nodes are link-table derived: the authoritative facts are
# the account links (who uses the instrument and with what weight), read
# from player_payment_method.parquet keyed by payment_method_id.
NODE_SOURCES["PaymentMethod"] = ("player_payment_method", "payment_method_id")
LINK_COLUMNS: tuple[str, ...] = ("player_id", "first_used_at", "last_used_at", "usage_weight")

# Cap rendered account links per instrument so a popular instrument cannot
# blow the context budget.
MAX_LINK_ROWS = 8


@dataclass(frozen=True, slots=True)
class AuthoritativeFacts:
    node_id: str
    node_label: str
    source_table: str
    source_record_id: str
    columns: dict[str, str]

    def snippet(self) -> str:
        pairs = ", ".join(f"{key}={value}" for key, value in self.columns.items())
        return f"[authoritative {self.source_table}] {pairs}"

    def to_payload(self) -> dict[str, str]:
        return {
            "source_table": self.source_table,
            "source_record_id": self.source_record_id,
            **self.columns,
        }


class SourceLookup:
    """Reads authoritative rows from the dataset Parquet files.

    Results are memoised per (label, id): ranking and evidence assembly
    both request facts for the same nodes.
    """

    def __init__(self, dataset_dir: Path) -> None:
        self._dataset_dir = dataset_dir
        self._cache: dict[tuple[str, str], AuthoritativeFacts | None] = {}

    def fetch(self, node_label: str, node_id: str) -> AuthoritativeFacts | None:
        key = (node_label, node_id)
        if key in self._cache:
            return self._cache[key]
        facts = self._fetch(node_label, node_id)
        self._cache[key] = facts
        return facts

    def _fetch(self, node_label: str, node_id: str) -> AuthoritativeFacts | None:
        mapping = NODE_SOURCES.get(node_label)
        if mapping is None:
            return None
        table, id_column = mapping
        path = self._dataset_dir / f"{table}.parquet"
        if not path.exists():
            return None
        if table == "player_payment_method":
            return self._fetch_links(path, id_column, node_id)
        columns = SNIPPET_COLUMNS.get(table)
        if columns is None:
            return None
        connection = duckdb.connect()
        try:
            projection = ", ".join(f'"{column}"' for column in columns)
            rows: list[tuple[Any, ...]] = connection.execute(
                f'SELECT {projection} FROM read_parquet(?) WHERE "{id_column}" = ?',
                [str(path), node_id],
            ).fetchall()
        finally:
            connection.close()
        if not rows:
            return None
        values = rows[0]
        rendered = {
            column: ("-" if value is None else str(value))
            for column, value in zip(columns, values, strict=True)
        }
        return AuthoritativeFacts(
            node_id=node_id,
            node_label=node_label,
            source_table=table,
            source_record_id=node_id,
            columns=rendered,
        )

    def _fetch_links(self, path: Path, id_column: str, node_id: str) -> AuthoritativeFacts | None:
        """Link-table facts: the accounts sharing one instrument."""
        connection = duckdb.connect()
        try:
            count_result = connection.execute(
                f'SELECT count(*) FROM read_parquet(?) WHERE "{id_column}" = ?',
                [str(path), node_id],
            ).fetchone()
            count = int(count_result[0]) if count_result is not None else 0
            if count == 0:
                return None
            projection = ", ".join(f'"{column}"' for column in LINK_COLUMNS)
            rows: list[tuple[Any, ...]] = connection.execute(
                f'SELECT {projection} FROM read_parquet(?) WHERE "{id_column}" = ? '
                'ORDER BY "usage_weight" DESC LIMIT ?',
                [str(path), node_id, MAX_LINK_ROWS],
            ).fetchall()
        finally:
            connection.close()
        links = []
        for player_id, first_used, _last_used, weight in rows:
            day = str(first_used)[:10] if first_used is not None else "-"
            links.append(f"{player_id}[weight={weight},from={day}]")
        rendered = {
            "accounts_sharing": str(count),
            "links": "; ".join(links) + ("; ..." if count > MAX_LINK_ROWS else ""),
        }
        return AuthoritativeFacts(
            node_id=node_id,
            node_label="PaymentMethod",
            source_table="player_payment_method",
            source_record_id=node_id,
            columns=rendered,
        )
