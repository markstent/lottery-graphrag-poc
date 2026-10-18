"""Operational scenario: cross-market platform incident (SCN-007).

One payments platform version degrades checkout in three markets with graded
severity; the fourth market deferred the update. The primary market and the
order of the related markets are drawn from the scenario stream (design
10a.5). Each market gets its own incident, impacted games, failing sessions,
support contacts and an incident report written in the market language with
the market's own incident type and product names. No report names a sibling
market's incident: that link is only discoverable through the shared version.
KPIs are not edited here; they are derived from the planted rows afterwards.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.datasets.rows import (
    DocumentRow,
    GameRow,
    IncidentGameMapRow,
    IncidentRow,
    PlayerRow,
    SessionRow,
    SupportCaseRow,
)
from app.datasets.taxonomies import MARKET_LANGUAGE
from app.scenarios.planter import ScenarioPlanter, at

# Eligible primary markets; the unaffected market deferred the shared update.
SCN007_CANDIDATE_MARKETS = ("MKT_AT", "MKT_CZ", "MKT_GR")
SCN007_UNAFFECTED_MARKET = "MKT_UK"
SCN007_PLATFORM = "PLT_PAYMENTS"
# Severity by rank: primary market first, then the related markets in draw order.
SCN007_SEVERITY_BY_RANK = ("HIGH", "MEDIUM", "LOW")
# Incident length per severity; each market's incident starts one day after the previous.
SCN007_DURATION_HOURS = {"HIGH": 48, "MEDIUM": 24, "LOW": 12}
SEVERITY_WEIGHT = {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3}
SCN007_START_DAY = 140
SCN007_START_HOUR = 9
SCN007_START_JITTER_HOURS = 6
SCN007_SCENARIO_DAYS = 5
SCN007_VERSION_LEAD_DAYS = 30
SCN007_RELEASE_NOTE_LEAD_DAYS = 3
SCN007_GAMES_PER_INCIDENT = 2
SCN007_ROOT_CAUSE_CODE = "RC_77"
# Signal volumes: at least `base` rows, else share x strength x daily mean.
SCN007_SESSION_BASE, SCN007_SESSION_SHARE = 8, 0.35
SCN007_SUPPORT_BASE, SCN007_SUPPORT_SHARE = 6, 0.5
SCN007_SESSION_MINUTES = (2, 8)
SCN007_CASE_OPEN_HOURS = (2, 50)
SCN007_SENTIMENT = (-0.9, 0.3)

# Incident report bodies per market language: four sentences, no internal ". ".
SCN007_REPORT_TEMPLATES = {
    "el": (
        "Το περιστατικό {incident} καταγράφηκε ως «{incident_type}» στις {date}. "
        "Οι πληρωμές για «{family}» απέτυχαν στο ταμείο μετά την αναβάθμιση στην "
        "έκδοση πλατφόρμας {version}. "
        "Οι ψηφιακές αγορές δεν ολοκληρώνονταν μέχρι την εφαρμογή της διόρθωσης. "
        "Η εξυπηρέτηση πελατών δέχτηκε πολλά παράπονα για πληρωμές κατά τη διάρκεια της βλάβης."
    ),
    "de": (
        "Der Vorfall {incident} wurde am {date} als „{incident_type}“ eingestuft. "
        "Zahlungen für „{family}“ schlugen nach dem Wechsel auf die Plattformversion "
        "{version} an der Kasse fehl. "
        "Digitale Käufe waren bis zur Bereitstellung der Korrektur nicht möglich. "
        "Der Kundendienst erhielt während der Störung zahlreiche Beschwerden zu Zahlungen."
    ),
    "cs": (
        "Incident {incident} byl dne {date} zařazen jako „{incident_type}“. "
        "Platby za „{family}“ po nasazení verze platformy {version} selhávaly u pokladny. "
        "Digitální nákupy nebylo možné dokončit až do nasazení opravy. "
        "Zákaznická podpora během výpadku přijala mnoho stížností na platby."
    ),
}
SCN007_RELEASE_NOTE_TEMPLATE = (
    "Release {app_version} defers the platform version {version} update for the UK. "
    "The checkout component update is rescheduled after stability reports from other markets. "
    "UK checkout is unaffected."
)


def plant_cross_market_platform_incident(plan: ScenarioPlanter) -> None:
    """SCN-007: one platform version degrades checkout in three markets; UK deferred."""
    primary, *related = plan.rng.sample(SCN007_CANDIDATE_MARKETS, len(SCN007_CANDIDATE_MARKETS))
    base = at(SCN007_START_DAY, SCN007_START_HOUR)
    version = _shared_version(plan, base - timedelta(days=SCN007_VERSION_LEAD_DAYS))

    incidents: list[IncidentRow] = []
    incident_games: list[IncidentGameMapRow] = []
    support: list[SupportCaseRow] = []
    sessions: list[SessionRow] = []
    documents: list[DocumentRow] = []
    affected_games: list[str] = []

    for rank, (market, severity) in enumerate(
        zip([primary, *related], SCN007_SEVERITY_BY_RANK, strict=True)
    ):
        started = base + timedelta(days=rank, hours=plan.rng.randrange(SCN007_START_JITTER_HOURS))
        resolved = started + timedelta(hours=SCN007_DURATION_HOURS[severity])
        incident = IncidentRow(
            incident_id=plan.next_id("incidents"),
            market_id=market,
            platform_id=SCN007_PLATFORM,
            platform_version_id=version,
            app_version_id=None,
            incident_type=plan.local("incident_type", market, "PAYMENT"),
            severity=severity,
            started_at=started,
            resolved_at=resolved,
            summary=(
                f"Payment checkout failures on platform version {version} "
                "affecting digital checkout."
            ),
            root_cause_code=SCN007_ROOT_CAUSE_CODE,
        )
        incidents.append(incident)

        digital = plan.digital_games(market)
        if len(digital) < SCN007_GAMES_PER_INCIDENT:
            raise RuntimeError(
                f"scenario {plan.spec.scenario_id}: {market} has fewer than "
                f"{SCN007_GAMES_PER_INCIDENT} digital games"
            )
        games = plan.rng.sample(digital, SCN007_GAMES_PER_INCIDENT)
        incident_games.extend(
            IncidentGameMapRow(
                incident_id=incident.incident_id,
                game_id=game.game_id,
                impact_weight=round(SEVERITY_WEIGHT[severity] * plan.spec.strength, 3),
            )
            for game in games
        )
        affected_games.extend(game.game_id for game in games)

        case_count = plan.signal_count(
            SCN007_SUPPORT_BASE, plan.daily_mean("support_cases", market), SCN007_SUPPORT_SHARE
        )
        players = plan.players_in(market, case_count)
        support.extend(_support_cases(plan, incident, market, resolved, players, games))
        session_count = plan.signal_count(
            SCN007_SESSION_BASE, plan.daily_mean("sessions", market), SCN007_SESSION_SHARE
        )
        sessions.extend(_failing_sessions(plan, incident, market, resolved, players, session_count))
        reported_game, *_ = games
        documents.append(_incident_report(plan, incident, market, resolved, reported_game))

    primary_report, *_ = documents
    release_note = _release_note(plan, version, base)
    documents.append(release_note)

    plan.add("incidents", incidents)
    plan.add("incident_game_map", incident_games)
    plan.add("support_cases", support)
    plan.add("sessions", sessions)
    plan.add("documents", documents)
    plan.add("document_chunks", [chunk for doc in documents for chunk in plan.chunk_rows(doc)])

    primary_incident, first_related, *_ = (i.incident_id for i in incidents)
    plan.affected_markets = [primary, *related]
    plan.affected_games = sorted(set(affected_games))
    plan.start_date = base.date()
    plan.duration_days = SCN007_SCENARIO_DAYS
    plan.truth = {
        "root_cause_entity": version,
        "primary_market": primary,
        "related_markets": related,
        "unaffected_markets": [SCN007_UNAFFECTED_MARKET],
        "unaffected_explanation": (
            f"{SCN007_UNAFFECTED_MARKET} deferred the {version} update; "
            f"see {release_note.document_id}."
        ),
        "required_path": [primary_incident, version, first_related],
        "planted_incidents": [i.incident_id for i in incidents],
        "kpi_effect": (
            f"session_completion down / payment_failure_rate up for {primary} during the incident"
        ),
    }
    plan.required_evidence = [
        version,
        *(i.incident_id for i in incidents),
        primary_report.document_id,
        release_note.document_id,
        f"kpi:{primary}:session_completion",
    ]


def _shared_version(plan: ScenarioPlanter, released_by: datetime) -> str:
    """Latest payments platform version released on or before `released_by`."""
    candidates = [
        v
        for v in plan.tables["platform_versions"]
        if v.platform_id == SCN007_PLATFORM and v.released_at <= released_by
    ]
    if not candidates:
        raise RuntimeError("scenario SCN-007: no eligible platform version")
    return str(max(candidates, key=lambda v: v.released_at).platform_version_id)


def _support_cases(
    plan: ScenarioPlanter,
    incident: IncidentRow,
    market: str,
    resolved: datetime,
    players: list[PlayerRow],
    games: list[GameRow],
) -> list[SupportCaseRow]:
    """Payment complaints opened while the incident was live."""
    span = int((resolved - incident.started_at).total_seconds())
    cases: list[SupportCaseRow] = []
    for player in players:
        opened = incident.started_at + timedelta(seconds=plan.rng.randrange(span))
        low, spread = SCN007_SENTIMENT
        cases.append(
            SupportCaseRow(
                support_case_id=plan.next_id("support_cases"),
                market_id=market,
                player_id=player.player_id,
                game_id=plan.rng.choice(games).game_id,
                incident_id=incident.incident_id,
                opened_at=opened,
                closed_at=opened + timedelta(hours=plan.rng.randrange(*SCN007_CASE_OPEN_HOURS)),
                category_code=plan.local("support_category", market, "PAYMENT"),
                sentiment_score=round(low + plan.rng.random() * spread, 2),
                summary_text=(
                    f"Payment failing at checkout since {incident.started_at.date().isoformat()}."
                ),
            )
        )
    return cases


def _failing_sessions(
    plan: ScenarioPlanter,
    incident: IncidentRow,
    market: str,
    resolved: datetime,
    players: list[PlayerRow],
    count: int,
) -> list[SessionRow]:
    """Failed checkout sessions spread over the incident duration."""
    span = int((resolved - incident.started_at).total_seconds())
    devices = plan.devices_of([p.player_id for p in players])
    app_version = plan.app_version_at(market, incident.started_at)
    sessions: list[SessionRow] = []
    for _ in range(count):
        player = plan.rng.choice(players)
        owned = devices.get(player.player_id)
        started_at = incident.started_at + timedelta(seconds=plan.rng.randrange(span))
        sessions.append(
            SessionRow(
                session_id=plan.next_id("sessions"),
                player_id=player.player_id,
                market_id=market,
                device_id=plan.rng.choice(owned) if owned else None,
                channel_code="APP",
                started_at=started_at,
                ended_at=started_at
                + timedelta(minutes=plan.rng.randrange(*SCN007_SESSION_MINUTES)),
                app_version_id=app_version,
                session_outcome="FAIL_PAYMENT",
            )
        )
    return sessions


def _incident_report(
    plan: ScenarioPlanter, incident: IncidentRow, market: str, resolved: datetime, game: GameRow
) -> DocumentRow:
    """Incident report in the market language naming local incident type and product."""
    type_name = plan.names[("incident_type", incident.incident_type)]
    body = SCN007_REPORT_TEMPLATES[MARKET_LANGUAGE[market]].format(
        incident=incident.incident_id,
        incident_type=type_name,
        date=incident.started_at.date().isoformat(),
        family=plan.names[("family", game.game_family_id)],
        version=incident.platform_version_id,
    )
    return DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="INCIDENT_REPORT",
        market_id=market,
        language_code=MARKET_LANGUAGE[market],
        title=f"Incident Report: {type_name} ({incident.incident_id})",
        created_at=resolved,
        valid_from=resolved,
        valid_to=None,
        source_system_code="document_store",
        source_record_id=incident.incident_id,
        body=body,
    )


def _release_note(plan: ScenarioPlanter, version: str, base: datetime) -> DocumentRow:
    """Deferral note explaining why the unaffected market never saw the incident."""
    created = base - timedelta(days=SCN007_RELEASE_NOTE_LEAD_DAYS)
    app_version = plan.app_version_at(SCN007_UNAFFECTED_MARKET, base)
    if app_version is None:
        raise RuntimeError("scenario SCN-007: no released app version in the unaffected market")
    return DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="RELEASE_NOTE",
        market_id=SCN007_UNAFFECTED_MARKET,
        language_code=MARKET_LANGUAGE[SCN007_UNAFFECTED_MARKET],
        title=f"Release Note: {app_version} (Deferred Update)",
        created_at=created,
        valid_from=created,
        valid_to=None,
        source_system_code="document_store",
        source_record_id=app_version,
        body=SCN007_RELEASE_NOTE_TEMPLATE.format(app_version=app_version, version=version),
    )
