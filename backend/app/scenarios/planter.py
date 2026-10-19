"""Shared planting context for scenario injectors (docs/04-scenario-catalogue.md).

`ScenarioPlanter` bundles one scenario's outcome fields with the lookups every
injector needs. Planted ids come from `next_id`, which continues each table's
own id sequence (`schema.ID_FORMATS`), so a planted row is indistinguishable
from a baseline row by its id. Every planted id is recorded per table in
planting order; the engine publishes them as ``truth["planted_ids"]``.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from datetime import date, datetime, time, timedelta
from typing import Any

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.rows import (
    DocumentChunkRow,
    DocumentRow,
    GameRow,
    PlayerRow,
    SessionRow,
    SupportCaseRow,
)
from app.datasets.schema import ID_FORMATS, primary_key
from app.datasets.taxonomies import incident_type_for, local_names, support_category_for
from app.datasets.util import chunk_text, word_count
from app.datasets.world import World
from app.scenarios.catalogue import ScenarioSpec

_SEQUENCE_FIELD = "{n"
_MARKET_FIELD = "{market}"

SECONDS_PER_DAY = 24 * 60 * 60

# Shared shape of planted failing sessions and complaints, used by every
# scenario that plants them so their rows look alike across scenarios.
# Length of a planted failing session in minutes (half-open range).
PLANTED_SESSION_MINUTES = (2, 8)
# Hours a planted complaint stays open (half-open range).
PLANTED_CASE_OPEN_HOURS = (2, 50)
# Sentiment of a planted complaint: lowest score and the spread above it.
PLANTED_CASE_SENTIMENT = (-0.9, 0.3)


def at(day_offset: int, hour: int = 0, minute: int = 0) -> datetime:
    """Naive timestamp inside the generation window."""
    return datetime.combine(WINDOW_START + timedelta(days=day_offset), time(hour, minute))


class ScenarioPlanter:
    """One scenario's outcome plus the helper lookups every injector shares."""

    def __init__(self, world: World, rng: random.Random, spec: ScenarioSpec) -> None:
        self.world = world
        self.rng = rng
        self.spec = spec
        self.tables = world.tables
        self.names = local_names()
        self.truth: dict[str, Any] = {}
        self.required_evidence: list[str] = []
        self.affected_markets: list[str] = []
        self.affected_games: list[str] = []
        self.start_date: date = WINDOW_START
        self.duration_days = 1
        self.planted_rows: dict[str, int] = {}
        self.planted_ids: dict[str, list[str]] = {}
        self._counters: dict[tuple[str, str | None], int] = {}

    def add(self, table: str, rows: Sequence[tuple[Any, ...]]) -> None:
        """Append planted rows and record their ids (tables with an id format only)."""
        self.tables[table].extend(rows)
        self.planted_rows[table] = self.planted_rows.get(table, 0) + len(rows)
        if table in ID_FORMATS:
            key = primary_key(table)
            self.planted_ids.setdefault(table, []).extend(getattr(row, key) for row in rows)

    def next_id(self, table: str, market_code: str | None = None) -> str:
        """Next id in the table's sequence, continuing after its current maximum."""
        id_format = ID_FORMATS[table]
        prefix_template, separator, _ = id_format.partition(_SEQUENCE_FIELD)
        if not separator or "{" in prefix_template.replace(_MARKET_FIELD, ""):
            raise ValueError(f"table {table} has no plain sequence id format: {id_format}")
        per_market = _MARKET_FIELD in prefix_template
        if per_market != (market_code is not None):
            raise ValueError(f"table {table}: market_code is required exactly for {id_format}")
        key = (table, market_code)
        if key not in self._counters:
            prefix = prefix_template.replace(_MARKET_FIELD, market_code or "")
            ids = (getattr(row, primary_key(table)) for row in self.tables[table])
            suffixes = [
                int(rest)
                for rest in (i.removeprefix(prefix) for i in ids if i.startswith(prefix))
                if rest.isdigit()
            ]
            self._counters[key] = max(suffixes, default=0)
        self._counters[key] += 1
        return id_format.format(n=self._counters[key], market=market_code)

    def chunk_rows(self, document: DocumentRow) -> list[DocumentChunkRow]:
        """Chunks of a planted document, ids derived from the document number."""
        number = document.document_id.rpartition("_")[2]
        return [
            DocumentChunkRow(
                chunk_id=ID_FORMATS["document_chunks"].format(doc=number, n=index),
                document_id=document.document_id,
                chunk_index=index,
                text=text,
                token_count=word_count(text),
                embedding_version=None,
            )
            for index, text in enumerate(chunk_text(document.body))
        ]

    def daily_mean(self, table: str, market_id: str) -> float:
        """Mean rows per day of a market's table over the generation window."""
        return sum(1 for row in self.tables[table] if row.market_id == market_id) / WINDOW_DAYS

    def signal_count(self, base: int, daily_mean: float, share: float) -> int:
        """Planted signal volume scaled to the market's daily volume and scenario strength."""
        return max(base, round(share * self.spec.strength * daily_mean))

    def local(self, kind: str, market_id: str, canonical: str) -> str:
        """Market-local taxonomy code for a canonical kind."""
        if kind == "incident_type":
            return incident_type_for(market_id, canonical)
        if kind == "support_category":
            return support_category_for(market_id, canonical)
        raise ValueError(f"unknown taxonomy kind {kind!r}")

    def market_code(self, market_id: str) -> str:
        return str(next(m.market_code for m in self.tables["markets"] if m.market_id == market_id))

    def markets_with_active_players(self, minimum: int) -> list[str]:
        """Market ids (sorted) with at least `minimum` active players."""
        counts: dict[str, int] = {}
        for player in self.tables["players"]:
            if player.account_status == "ACTIVE":
                counts[player.market_id] = counts.get(player.market_id, 0) + 1
        return sorted(market for market, count in counts.items() if count >= minimum)

    def players_in(self, market_id: str, count: int) -> list[PlayerRow]:
        pool = [
            p
            for p in self.tables["players"]
            if p.market_id == market_id and p.account_status == "ACTIVE"
        ]
        if len(pool) < count:
            raise RuntimeError(
                f"scenario {self.spec.scenario_id}: not enough players in {market_id}"
            )
        return self.rng.sample(pool, count)

    def digital_games(self, market_id: str) -> list[GameRow]:
        return sorted(
            (g for g in self.tables["games"] if g.market_id == market_id and g.digital_enabled),
            key=lambda g: g.game_id,
        )

    def app_version_at(self, market_id: str, moment: datetime) -> str | None:
        """Latest app version of the market released on or before `moment`."""
        released = [
            a
            for a in self.tables["app_versions"]
            if a.market_id == market_id and a.released_at <= moment
        ]
        return str(max(released, key=lambda a: a.released_at).app_version_id) if released else None

    def devices_of(self, player_ids: list[str]) -> dict[str, list[str]]:
        grouped: dict[str, list[str]] = {}
        for link in self.tables["player_device"]:
            if link.player_id in player_ids:
                grouped.setdefault(link.player_id, []).append(link.device_id)
        return grouped

    def failing_session(
        self,
        player: PlayerRow,
        market_id: str,
        started_at: datetime,
        app_version_id: str | None,
        device_id: str | None,
        outcome: str,
        *,
        channel_code: str,
    ) -> SessionRow:
        """One planted session starting at `started_at` that ends in `outcome`."""
        return SessionRow(
            session_id=self.next_id("sessions"),
            player_id=player.player_id,
            market_id=market_id,
            device_id=device_id,
            channel_code=channel_code,
            started_at=started_at,
            ended_at=started_at + timedelta(minutes=self.rng.randrange(*PLANTED_SESSION_MINUTES)),
            app_version_id=app_version_id,
            session_outcome=outcome,
        )

    def support_case(
        self,
        player: PlayerRow,
        market_id: str,
        opened_at: datetime,
        category: str,
        summary: str,
        *,
        game_id: str | None = None,
        incident_id: str | None = None,
    ) -> SupportCaseRow:
        """One planted complaint opened at `opened_at` with a negative sentiment."""
        low, spread = PLANTED_CASE_SENTIMENT
        return SupportCaseRow(
            support_case_id=self.next_id("support_cases"),
            market_id=market_id,
            player_id=player.player_id,
            game_id=game_id,
            incident_id=incident_id,
            opened_at=opened_at,
            closed_at=opened_at + timedelta(hours=self.rng.randrange(*PLANTED_CASE_OPEN_HOURS)),
            category_code=category,
            sentiment_score=round(low + self.rng.random() * spread, 2),
            summary_text=summary,
        )
