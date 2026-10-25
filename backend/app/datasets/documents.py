"""Synthetic document corpus and chunking.

Documents are multilingual per market profiles (docs/reference/01 section 5/9/20):
market documents use the market language most of the time, corporate
documents use English. Each document has one subject entity (a game,
incident, campaign, app version, experiment or platform version) and its
detail sentences mention only entities related to that subject, by their
local display name and sometimes their identifier, the way a local operator
would write them. Sentence templates live in ``document_templates``.
"""

from __future__ import annotations

import random
import string
from collections.abc import Mapping, Sequence
from datetime import datetime, time, timedelta
from typing import Any, NamedTuple

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.distributions import (
    MARKET_DOCUMENT_ENGLISH_SHARE,
    MARKET_SPLIT,
    MENTION_NAME_ONLY_SHARE,
    REVIEW_SUBJECTLESS_SHARE,
)
from app.datasets.document_templates import MARKET_NAMES, REPORTING_PERIOD, TEMPLATES
from app.datasets.rows import (
    AppVersionRow,
    CampaignRow,
    DocumentChunkRow,
    DocumentRow,
    ExperimentRow,
    GameMechanicRow,
    GameRow,
    IncidentRow,
    PlatformVersionRow,
)
from app.datasets.taxonomies import MARKET_LANGUAGE
from app.datasets.util import chunk_text, word_count

_CORPORATE_TYPES = {
    "POLICY",
    "PLATFORM_DOCUMENTATION",
    "TECHNICAL_INTEGRATION_NOTE",
    "EXPERIMENT_REPORT",
}

_TYPE_WEIGHTS: tuple[tuple[str, int], ...] = (
    ("PRODUCT_SPEC", 18),
    ("GAME_RULES", 28),
    ("RELEASE_NOTE", 30),
    ("INCIDENT_REPORT", 22),
    ("POST_INCIDENT_REVIEW", 10),
    ("MARKETING_BRIEF", 14),
    ("CAMPAIGN_EVALUATION", 14),
    ("SUPPORT_SUMMARY", 18),
    ("MONTHLY_MARKET_REVIEW", 18),
    ("EXPERIMENT_REPORT", 6),
    ("MEETING_NOTE", 20),
    ("PLATFORM_DOCUMENTATION", 10),
    ("POLICY", 5),
    ("TECHNICAL_INTEGRATION_NOTE", 10),
)

# Subject kind per document type; kinds name both the entity pool and the
# template pool ("platform" has no template pool and uses generic sentences).
_SUBJECT_KIND: dict[str, str] = {
    "PRODUCT_SPEC": "game",
    "GAME_RULES": "game",
    "SUPPORT_SUMMARY": "game",
    "MONTHLY_MARKET_REVIEW": "game",
    "MEETING_NOTE": "game",
    "INCIDENT_REPORT": "incident",
    "POST_INCIDENT_REVIEW": "incident",
    "RELEASE_NOTE": "release",
    "MARKETING_BRIEF": "campaign",
    "CAMPAIGN_EVALUATION": "campaign",
    "EXPERIMENT_REPORT": "experiment",
    "POLICY": "platform",
    "PLATFORM_DOCUMENTATION": "platform",
    "TECHNICAL_INTEGRATION_NOTE": "platform",
}

# Days after the window start from which each subject kind's documents are
# written (half-open range); documents without an entity subject spread over
# the whole window.
_CREATED_OFFSET_DAYS: dict[str, tuple[int, int]] = {
    "game": (0, 1),
    "incident": (1, 10),
    "release": (0, 5),
    "campaign": (1, 20),
    "experiment": (0, 1),
    "platform": (0, WINDOW_DAYS),
}
_REPORTING_PERIOD_OFFSET_DAYS = (0, WINDOW_DAYS)
# Additional days a document may be written after its offset.
_CREATED_JITTER_DAYS = 60

# Detail sentences per document body (half-open range).
_DETAIL_SENTENCES = (3, 7)


class Ref(NamedTuple):
    """An entity as a document names it: local display name and identifier."""

    name: str
    entity_id: str


class WorldIndex:
    """Lookups from the generated tables that documents draw their subjects from."""

    def __init__(self) -> None:
        self.games_by_market: dict[str, list[GameRow]] = {}
        self.incidents_by_market: dict[str | None, list[IncidentRow]] = {}
        self.campaigns_by_market: dict[str, list[CampaignRow]] = {}
        self.app_versions_by_market: dict[str, list[AppVersionRow]] = {}
        self.experiments_by_market: dict[str, list[ExperimentRow]] = {}
        self.platform_versions: list[PlatformVersionRow] = []
        self.family_name: dict[str, str] = {}
        self.mechanics_of_game: dict[str, list[GameMechanicRow]] = {}
        self.incident_type_name: dict[str, str] = {}
        self.segment_name: dict[str, str] = {}
        self.games_of_incident: dict[str, list[GameRow]] = {}
        self.incidents_of_game: dict[str, list[IncidentRow]] = {}
        self.campaigns_of_game: dict[str, list[CampaignRow]] = {}
        self.games_of_campaign: dict[str, list[GameRow]] = {}
        self.incidents_of_app_version: dict[str, list[IncidentRow]] = {}
        self.app_version_by_id: dict[str, AppVersionRow] = {}
        self.platform_version_by_id: dict[str, PlatformVersionRow] = {}

    @classmethod
    def from_tables(cls, tables: Mapping[str, Sequence[Any]]) -> WorldIndex:
        index = cls()
        games = {g.game_id: g for g in tables["games"]}
        incidents = {i.incident_id: i for i in tables["incidents"]}
        campaigns = {c.campaign_id: c for c in tables["campaigns"]}
        mechanics = {m.mechanic_id: m for m in tables["game_mechanics"]}
        for game in games.values():
            index.games_by_market.setdefault(game.market_id, []).append(game)
        for incident in incidents.values():
            index.incidents_by_market.setdefault(incident.market_id, []).append(incident)
            if incident.app_version_id is not None:
                index.incidents_of_app_version.setdefault(incident.app_version_id, []).append(
                    incident
                )
        for campaign in campaigns.values():
            index.campaigns_by_market.setdefault(campaign.market_id, []).append(campaign)
        for version in tables["app_versions"]:
            index.app_versions_by_market.setdefault(version.market_id, []).append(version)
            index.app_version_by_id[version.app_version_id] = version
        for experiment in tables["experiments"]:
            index.experiments_by_market.setdefault(experiment.market_id, []).append(experiment)
        index.platform_versions = list(tables["platform_versions"])
        index.platform_version_by_id = {v.platform_version_id: v for v in index.platform_versions}
        index.family_name = {f.family_id: f.name for f in tables["game_families"]}
        for link in tables["game_mechanic_map"]:
            index.mechanics_of_game.setdefault(link.game_id, []).append(mechanics[link.mechanic_id])
        index.incident_type_name = {t.incident_type_id: t.name for t in tables["incident_types"]}
        index.segment_name = {s.segment_id: s.name for s in tables["player_segments"]}
        for incident_link in tables["incident_game_map"]:
            game = games[incident_link.game_id]
            incident = incidents[incident_link.incident_id]
            index.games_of_incident.setdefault(incident.incident_id, []).append(game)
            index.incidents_of_game.setdefault(game.game_id, []).append(incident)
        for campaign_link in tables["campaign_game_map"]:
            game = games[campaign_link.game_id]
            campaign = campaigns[campaign_link.campaign_id]
            index.games_of_campaign.setdefault(campaign.campaign_id, []).append(game)
            index.campaigns_of_game.setdefault(game.game_id, []).append(campaign)
        return index


class _Subject(NamedTuple):
    kind: str
    ref: Ref | None
    market_id: str | None
    related: dict[str, Ref]


def mention(rng: random.Random, ref: Ref) -> str:
    """Render an entity mention: name only, or name with its identifier."""
    if rng.random() < MENTION_NAME_ONLY_SHARE:
        return ref.name
    return f"{ref.name} ({ref.entity_id})"


def _fields(template: str) -> list[str]:
    """Placeholders in template order, without duplicates (RNG draws stay deterministic)."""
    return list(dict.fromkeys(name for _, name, _, _ in string.Formatter().parse(template) if name))


def _incident_ref(index: WorldIndex, incident: IncidentRow) -> Ref:
    return Ref(index.incident_type_name[incident.incident_type], incident.incident_id)


def _game_related(rng: random.Random, index: WorldIndex, game: GameRow) -> dict[str, Ref]:
    related = {
        "game": Ref(game.game_name, game.game_id),
        "family": Ref(index.family_name[game.game_family_id], game.game_family_id),
    }
    mechanics = index.mechanics_of_game.get(game.game_id)
    if mechanics:
        mechanic = rng.choice(mechanics)
        related["mechanic"] = Ref(mechanic.description, mechanic.mechanic_id)
    return related


def _incident_related(index: WorldIndex, incident: IncidentRow) -> dict[str, Ref]:
    related = {
        "incident": _incident_ref(index, incident),
        "incident_type": Ref(
            index.incident_type_name[incident.incident_type], incident.incident_type
        ),
    }
    if incident.app_version_id is not None:
        version = index.app_version_by_id[incident.app_version_id]
        related["app_version"] = Ref(version.version_label, version.app_version_id)
    if incident.platform_version_id is not None:
        platform = index.platform_version_by_id[incident.platform_version_id]
        related["platform_version"] = Ref(platform.version_label, platform.platform_version_id)
    return related


def _subject_for(
    rng: random.Random, index: WorldIndex, kind: str, market_id: str | None
) -> _Subject | None:
    """Pick a subject of ``kind`` (in ``market_id`` for market documents)."""
    if kind == "game":
        games = index.games_by_market.get(market_id or "", [])
        if not games:
            return None
        game = rng.choice(games)
        related = _game_related(rng, index, game)
        if game_incidents := index.incidents_of_game.get(game.game_id):
            incident = rng.choice(game_incidents)
            related["incident"] = _incident_ref(index, incident)
        if game_campaigns := index.campaigns_of_game.get(game.game_id):
            campaign = rng.choice(game_campaigns)
            related["campaign"] = Ref(campaign.campaign_name, campaign.campaign_id)
        return _Subject(kind, related["game"], game.market_id, related)
    if kind == "incident":
        # Cross-market incidents (no market) join every market's pool; a document
        # about one becomes a corporate English document.
        incidents = [
            *index.incidents_by_market.get(market_id, []),
            *index.incidents_by_market.get(None, []),
        ]
        if not incidents:
            return None
        incident = rng.choice(incidents)
        related = _incident_related(index, incident)
        if incident_games := index.games_of_incident.get(incident.incident_id):
            related.update(_game_related(rng, index, rng.choice(incident_games)))
        return _Subject(kind, related["incident"], incident.market_id, related)
    if kind == "campaign":
        campaigns = index.campaigns_by_market.get(market_id or "", [])
        if not campaigns:
            return None
        campaign = rng.choice(campaigns)
        related = {"campaign": Ref(campaign.campaign_name, campaign.campaign_id)}
        if campaign_games := index.games_of_campaign.get(campaign.campaign_id):
            related.update(_game_related(rng, index, rng.choice(campaign_games)))
        return _Subject(kind, related["campaign"], campaign.market_id, related)
    if kind == "release":
        versions = index.app_versions_by_market.get(market_id or "", [])
        if not versions:
            return None
        version = rng.choice(versions)
        related = {"app_version": Ref(version.version_label, version.app_version_id)}
        if version_incidents := index.incidents_of_app_version.get(version.app_version_id):
            related["incident"] = _incident_ref(index, rng.choice(version_incidents))
        return _Subject(kind, related["app_version"], version.market_id, related)
    if kind == "experiment":
        experiments = [e for market in index.experiments_by_market.values() for e in market]
        if not experiments:
            return None
        experiment = rng.choice(experiments)
        related = {
            "segment": Ref(index.segment_name[experiment.target_segment], experiment.target_segment)
        }
        return _Subject(
            kind,
            Ref(experiment.experiment_name, experiment.experiment_id),
            experiment.market_id,
            related,
        )
    if not index.platform_versions:
        return None
    platform = rng.choice(index.platform_versions)
    ref = Ref(platform.version_label, platform.platform_version_id)
    return _Subject(kind, ref, None, {"platform_version": ref})


def _compose_body(
    rng: random.Random, language: str, subject: _Subject | None, market_id: str | None
) -> str:
    """Opener, three to six distinct fillable detail sentences, closer."""
    templates = TEMPLATES[language]
    related = dict(subject.related) if subject is not None else {}
    if subject is not None and subject.ref is not None:
        related["subject"] = subject.ref
    if market_id is not None:
        related["market"] = Ref(MARKET_NAMES[language][market_id], market_id)

    def render(template: str) -> str:
        return template.format(**{name: mention(rng, related[name]) for name in _fields(template)})

    opener = rng.choice(templates["open"])
    if subject is None:
        opening = opener.format(subject=REPORTING_PERIOD[language])
    else:
        opening = render(opener)

    kind = subject.kind if subject is not None else ""
    pool = [
        t
        for t in (*templates.get(kind, ()), *templates["generic"])
        if set(_fields(t)) <= set(related)
    ]
    forced: list[str] = []
    if kind == "game":
        # Rule 6: a game document names its family and a mechanic locally.
        for name in ("family", "mechanic"):
            candidates = [t for t in pool if _fields(t) == [name]]
            if candidates:
                forced.append(rng.choice(candidates))
    remaining = [t for t in pool if t not in forced]
    count = rng.randrange(*_DETAIL_SENTENCES)
    details = forced + rng.sample(remaining, min(count - len(forced), len(remaining)))

    closer = rng.choice(templates["close"])
    return " ".join([opening, *(render(t) for t in details), closer])


def generate_documents(
    rng: random.Random, total: int, index: WorldIndex
) -> tuple[list[DocumentRow], list[DocumentChunkRow]]:
    """Multilingual synthetic documents and their chunks."""
    type_plan: list[str] = []
    for doc_type, weight in _TYPE_WEIGHTS:
        type_plan.extend([doc_type] * weight)
    rng.shuffle(type_plan)

    documents: list[DocumentRow] = []
    chunks: list[DocumentChunkRow] = []
    for number in range(1, total + 1):
        doc_id = f"DOC_{number:04d}"
        doc_type = type_plan[(number - 1) % len(type_plan)]
        kind = _SUBJECT_KIND[doc_type]
        if doc_type in _CORPORATE_TYPES:
            market_id: str | None = None
            language = "en"
        else:
            code = rng.choices(list(MARKET_SPLIT), weights=list(MARKET_SPLIT.values()))[0]
            market_id = f"MKT_{code}"
            language = (
                "en" if rng.random() < MARKET_DOCUMENT_ENGLISH_SHARE else MARKET_LANGUAGE[market_id]
            )

        subject: _Subject | None
        if doc_type == "MONTHLY_MARKET_REVIEW" and rng.random() < REVIEW_SUBJECTLESS_SHARE:
            subject = None
        else:
            subject = _subject_for(rng, index, kind, market_id)
        if subject is not None and subject.kind == "incident" and subject.market_id is None:
            market_id = None
            language = "en"
        body_market = market_id
        if subject is not None and subject.market_id is not None:
            body_market = subject.market_id
        body = _compose_body(rng, language, subject, body_market)

        type_title = doc_type.replace("_", " ").title()
        if subject is not None and subject.ref is not None:
            ref = subject.ref
            title = f"{type_title}: {ref.name} ({ref.entity_id})"
            source_record_id = ref.entity_id
            offset_range = _CREATED_OFFSET_DAYS[kind]
        else:
            title = f"{type_title}: Reporting Period"
            source_record_id = ""
            offset_range = _REPORTING_PERIOD_OFFSET_DAYS

        offset_days = rng.randrange(*offset_range) + rng.randrange(_CREATED_JITTER_DAYS)
        created = datetime.combine(WINDOW_START, time.min) + timedelta(
            days=min(offset_days, WINDOW_DAYS - 1),
            seconds=rng.randrange(24 * 60 * 60),
        )
        documents.append(
            DocumentRow(
                document_id=doc_id,
                document_type=doc_type,
                market_id=market_id,
                language_code=language,
                title=title,
                created_at=created,
                valid_from=created,
                valid_to=None,
                source_system_code="document_store",
                source_record_id=source_record_id,
                body=body,
            )
        )
        for chunk_index, chunk_body in enumerate(chunk_text(body)):
            chunks.append(
                DocumentChunkRow(
                    chunk_id=f"CHNK_{number:04d}_{chunk_index:02d}",
                    document_id=doc_id,
                    chunk_index=chunk_index,
                    text=chunk_body,
                    token_count=word_count(chunk_body),
                    embedding_version=None,
                )
            )
    documents.sort(key=lambda d: d.document_id)
    chunks.sort(key=lambda c: c.chunk_id)
    return documents, chunks
