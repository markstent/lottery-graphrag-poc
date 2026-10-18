"""Checkout degradation scenarios: app release (SCN-001) and payment provider (SCN-009).

SCN-001: one market's app release breaks checkout for one device family.
The market, the release and the device family are drawn from the scenario
stream (design 10a.5). The cohort's sessions on the release abandon or fail
payment, technical support contacts rise, an application incident is raised
on the matching app platform, and the release note and incident report are
written in the market language.

SCN-009: one cross-market payment provider fails intermittently in the three
markets where it holds the most payment methods. Failures and payment
complaints appear on alternating days, no incident is raised, and only a
later corporate post-incident review names the provider and the markets.
No market-level row or summary names the provider: the link is only
discoverable through the players' payment methods.

KPIs are not edited here; they are derived from the planted rows afterwards.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta

from app.datasets.config import WINDOW_START
from app.datasets.rows import (
    AppVersionRow,
    DeviceRow,
    DocumentRow,
    IncidentGameMapRow,
    IncidentRow,
    PlayerDeviceRow,
    PlayerRow,
    SessionRow,
    SupportCaseRow,
)
from app.datasets.taxonomies import MARKET_LANGUAGE, PAYMENT_PROVIDERS
from app.scenarios.inject_operations import SEVERITY_WEIGHT
from app.scenarios.planter import ScenarioPlanter, at

# SCN-001 eligibility: a release late enough for baseline before it and early
# enough for the 10-day window and its documents; a cohort of eight players.
SCN001_RELEASE_DAYS = (20, 250)  # inclusive window day offsets
SCN001_COHORT_SIZE = 8
SCN001_DEVICE_FAMILIES = ("ANDROID", "IOS")
SCN001_PLATFORM = {"ANDROID": "PLT_APP_ANDROID", "IOS": "PLT_APP_IOS"}
SCN001_FAMILY_LABEL = {"ANDROID": "Android", "IOS": "iOS"}
SCN001_OS_BUCKET = {"ANDROID": "15", "IOS": "18"}
# Scenario shape in days after the window start (the day after the release).
SCN001_WINDOW_DAYS = 10
SCN001_FAILING_DAYS = 6
SCN001_INCIDENT_DAY = 4
SCN001_INCIDENT_HOUR = 9
SCN001_INCIDENT_REPORT_DAY = 5
SCN001_SEVERITY = "HIGH"
SCN001_ROOT_CAUSE_CODE = "RC_31"
SCN001_GAMES_PER_INCIDENT = 2
# The checkout component the release changed, named in the release note.
SCN001_CHECKOUT_COMPONENT = "CheckoutSheet"
# Failing cohort sessions: 70 percent abandon, the rest fail at payment.
SCN001_ABANDON_SHARE = 0.7
# Signal volumes: at least `base` rows, else share x strength x daily mean.
SCN001_SESSION_BASE, SCN001_SESSION_SHARE = 12, 0.4
SCN001_SUPPORT_BASE, SCN001_SUPPORT_SHARE = 8, 0.6
SCN001_DEVICE_LEAD_DAYS = 30
SCN001_LINK_USAGE_WEIGHT = 0.5

# SCN-009 shape: a 14-day window from day 230 with failures on even days only.
SCN009_START_DAY = 230
SCN009_WINDOW_DAYS = 14
SCN009_ACTIVE_DAY_STEP = 2
SCN009_MARKET_COUNT = 3
SCN009_MIN_PLAYERS = 4
SCN009_REVIEW_DAY = 245
SCN009_REVIEW_HOUR = 10
SCN009_SESSION_BASE, SCN009_SESSION_SHARE = 6, 0.25
SCN009_SUPPORT_BASE, SCN009_SUPPORT_SHARE = 4, 0.4

# Shared shape of planted failing sessions and complaints.
SESSION_MINUTES = (2, 8)
CASE_OPEN_HOURS = (2, 50)
SENTIMENT = (-0.9, 0.3)  # lowest score and spread
SECONDS_PER_DAY = 24 * 60 * 60

# Support summaries per market language: one sentence, no internal ". ".
SCN001_SUPPORT_TEMPLATES = {
    "en": "The app freezes at checkout since the update to version {label}.",
    "el": "Η εφαρμογή κολλάει στο ταμείο από την ενημέρωση στην έκδοση {label}.",
    "de": "Die App hängt seit dem Update auf Version {label} an der Kasse.",
    "cs": "Aplikace od aktualizace na verzi {label} zamrzá u pokladny.",
}
SCN009_SUPPORT_TEMPLATES = {
    "en": "Payment was declined repeatedly at checkout on {date} after several retries.",
    "el": (
        "Η πληρωμή απορρίφθηκε επανειλημμένα στο ταμείο στις {date} μετά από πολλές προσπάθειες."
    ),
    "de": (
        "Die Zahlung wurde am {date} an der Kasse trotz mehrerer Versuche wiederholt abgelehnt."
    ),
    "cs": "Platba byla dne {date} u pokladny i přes několik pokusů opakovaně zamítnuta.",
}
# Release notes per market language: three sentences, no internal ". ".
SCN001_RELEASE_NOTE_TEMPLATES = {
    "en": (
        "Release {app_version} ships app version {label} to all players. "
        "The checkout component {component} was rebuilt with a new in-app payment "
        "confirmation step. "
        "Players must update to {label} to keep purchasing in the app."
    ),
    "el": (
        "Η κυκλοφορία {app_version} φέρνει την έκδοση εφαρμογής {label} σε όλους τους παίκτες. "
        "Το στοιχείο ταμείου {component} ξαναγράφτηκε με νέο βήμα επιβεβαίωσης πληρωμής "
        "μέσα στην εφαρμογή. "
        "Οι παίκτες πρέπει να ενημερώσουν στην έκδοση {label} για να συνεχίσουν τις αγορές "
        "στην εφαρμογή."
    ),
    "de": (
        "Das Release {app_version} liefert die App-Version {label} an alle Spieler aus. "
        "Die Kassenkomponente {component} wurde mit einem neuen Bestätigungsschritt für "
        "Zahlungen in der App neu gebaut. "
        "Spieler müssen auf {label} aktualisieren, um in der App weiter einkaufen zu können."
    ),
    "cs": (
        "Vydání {app_version} přináší všem hráčům verzi aplikace {label}. "
        "Komponenta pokladny {component} byla přestavěna s novým krokem potvrzení platby "
        "v aplikaci. "
        "Hráči musí aktualizovat na verzi {label}, aby mohli v aplikaci dále nakupovat."
    ),
}
# Incident reports per market language: four sentences, no internal ". ".
SCN001_REPORT_TEMPLATES = {
    "en": (
        "Incident {incident} was classified as “{incident_type}” on {date}. "
        "Checkout on {family} devices stalled after the update to app version {app_version}. "
        "Many purchases were abandoned or failed at the payment step. "
        "Customer support received a rising number of technical complaints from {family} users."
    ),
    "el": (
        "Το περιστατικό {incident} καταγράφηκε ως «{incident_type}» στις {date}. "
        "Το ταμείο σε συσκευές {family} κολλούσε μετά την ενημέρωση στην έκδοση εφαρμογής "
        "{app_version}. "
        "Πολλές αγορές εγκαταλείφθηκαν ή απέτυχαν στο βήμα πληρωμής. "
        "Η εξυπηρέτηση πελατών δέχτηκε αυξανόμενα τεχνικά παράπονα από χρήστες {family}."
    ),
    "de": (
        "Der Vorfall {incident} wurde am {date} als „{incident_type}“ eingestuft. "
        "Die Kasse auf {family}-Geräten blieb nach dem Update auf die App-Version "
        "{app_version} hängen. "
        "Viele Käufe wurden abgebrochen oder schlugen beim Zahlungsschritt fehl. "
        "Der Kundendienst erhielt zunehmend technische Beschwerden von {family}-Nutzern."
    ),
    "cs": (
        "Incident {incident} byl dne {date} zařazen jako „{incident_type}“. "
        "Pokladna na zařízeních {family} po aktualizaci na verzi aplikace {app_version} zamrzala. "
        "Mnoho nákupů bylo přerušeno nebo selhalo v kroku platby. "
        "Zákaznická podpora přijímala stále více technických stížností od uživatelů {family}."
    ),
}
SCN009_REVIEW_TEMPLATE = (
    "Between {start} and {end} the payment provider {provider} returned intermittent "
    "authorisation errors. "
    "Failed payments were observed in {markets} on alternating days. "
    "No incident was raised while the symptoms were visible in session and support data. "
    "The provider confirmed a capacity fault in its authorisation service and deployed a fix."
)


def plant_app_release_conversion_failure(plan: ScenarioPlanter) -> None:
    """SCN-001: an app release breaks checkout for one device family in one market."""
    release = _draw_release(plan)
    market = release.market_id
    family = plan.rng.choice(SCN001_DEVICE_FAMILIES)
    start = datetime.combine(release.released_at.date() + timedelta(days=1), time.min)
    window_end = start + timedelta(days=SCN001_WINDOW_DAYS)

    cohort = plan.players_in(market, SCN001_COHORT_SIZE)
    cohort_devices = _family_devices(plan, market, cohort, family, start)
    digital = plan.digital_games(market)
    if len(digital) < SCN001_GAMES_PER_INCIDENT:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: {market} has fewer than "
            f"{SCN001_GAMES_PER_INCIDENT} digital games"
        )
    games = plan.rng.sample(digital, SCN001_GAMES_PER_INCIDENT)

    incident = IncidentRow(
        incident_id=plan.next_id("incidents"),
        market_id=market,
        platform_id=SCN001_PLATFORM[family],
        platform_version_id=None,
        app_version_id=release.app_version_id,
        incident_type=plan.local("incident_type", market, "APPLICATION"),
        severity=SCN001_SEVERITY,
        started_at=start + timedelta(days=SCN001_INCIDENT_DAY, hours=SCN001_INCIDENT_HOUR),
        resolved_at=window_end,
        summary=(
            f"Checkout stalls on {SCN001_FAMILY_LABEL[family]} devices after app release "
            f"{release.app_version_id}."
        ),
        root_cause_code=SCN001_ROOT_CAUSE_CODE,
    )
    incident_games = [
        IncidentGameMapRow(
            incident_id=incident.incident_id,
            game_id=game.game_id,
            impact_weight=round(SEVERITY_WEIGHT[SCN001_SEVERITY] * plan.spec.strength, 3),
        )
        for game in games
    ]

    per_day = plan.signal_count(
        SCN001_SESSION_BASE, plan.daily_mean("sessions", market), SCN001_SESSION_SHARE
    )
    sessions: list[SessionRow] = []
    for day in range(SCN001_FAILING_DAYS):
        for _ in range(per_day):
            player = plan.rng.choice(cohort)
            outcome = "ABANDONED" if plan.rng.random() < SCN001_ABANDON_SHARE else "FAIL_PAYMENT"
            sessions.append(
                _session(
                    plan,
                    player,
                    start + timedelta(days=day),
                    plan.rng.choice(cohort_devices[player.player_id]),
                    release.app_version_id,
                    outcome,
                )
            )

    case_count = plan.signal_count(
        SCN001_SUPPORT_BASE, plan.daily_mean("support_cases", market), SCN001_SUPPORT_SHARE
    )
    summary = SCN001_SUPPORT_TEMPLATES[MARKET_LANGUAGE[market]].format(label=release.version_label)
    support: list[SupportCaseRow] = []
    for _ in range(case_count):
        opened = start + timedelta(seconds=plan.rng.randrange(SCN001_WINDOW_DAYS * SECONDS_PER_DAY))
        support.append(
            _support_case(
                plan,
                market,
                plan.rng.choice(cohort),
                opened,
                plan.local("support_category", market, "TECHNICAL"),
                summary,
                game_id=plan.rng.choice(games).game_id,
                incident_id=incident.incident_id if opened >= incident.started_at else None,
            )
        )

    release_note = _release_note(plan, release)
    report = _incident_report(plan, incident, release, family, start)
    documents = [release_note, report]

    plan.add("incidents", [incident])
    plan.add("incident_game_map", incident_games)
    plan.add("sessions", sessions)
    plan.add("support_cases", support)
    plan.add("documents", documents)
    plan.add("document_chunks", [chunk for doc in documents for chunk in plan.chunk_rows(doc)])

    plan.affected_markets = [market]
    plan.affected_games = sorted(game.game_id for game in games)
    plan.start_date = start.date()
    plan.duration_days = SCN001_WINDOW_DAYS
    plan.truth = {
        "market": market,
        "app_version_id": release.app_version_id,
        "device_family": family,
        "incident_id": incident.incident_id,
        "release_note_id": release_note.document_id,
        "incident_report_id": report.document_id,
        "expected_interpretation": (
            f"app release {release.app_version_id} broke checkout for the "
            f"{SCN001_FAMILY_LABEL[family]} cohort: abandoned and failed sessions and "
            "technical support contacts rose after the release"
        ),
    }
    plan.required_evidence = [
        release.app_version_id,
        incident.incident_id,
        release_note.document_id,
        f"kpi:{market}:session_completion",
    ]


def plant_payment_provider_degradation(plan: ScenarioPlanter) -> None:
    """SCN-009: one cross-market provider fails intermittently in three markets."""
    provider = plan.rng.choice(
        sorted(p.provider_id for p in PAYMENT_PROVIDERS if p.home_market_id is None)
    )
    start = at(SCN009_START_DAY)
    method_counts, payers = _provider_markets(
        plan, provider, start + timedelta(days=SCN009_WINDOW_DAYS)
    )
    markets = sorted(method_counts, key=lambda market: (-method_counts[market], market))[
        :SCN009_MARKET_COUNT
    ]
    if len(markets) < SCN009_MARKET_COUNT:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: fewer than {SCN009_MARKET_COUNT} markets "
            f"hold payment methods on {provider}"
        )
    active_days = [
        start + timedelta(days=day) for day in range(0, SCN009_WINDOW_DAYS, SCN009_ACTIVE_DAY_STEP)
    ]
    sessions: list[SessionRow] = []
    support: list[SupportCaseRow] = []
    first_cases: list[str] = []
    for market in markets:
        players = payers[market]
        if len(players) < SCN009_MIN_PLAYERS:
            raise RuntimeError(
                f"scenario {plan.spec.scenario_id}: fewer than {SCN009_MIN_PLAYERS} active "
                f"players in {market} pay through {provider}"
            )
        devices = plan.devices_of([p.player_id for p in players])
        per_day = plan.signal_count(
            SCN009_SESSION_BASE, plan.daily_mean("sessions", market), SCN009_SESSION_SHARE
        )
        for day in active_days:
            for _ in range(per_day):
                player = plan.rng.choice(players)
                owned = devices.get(player.player_id)
                device = plan.rng.choice(owned) if owned else None
                sessions.append(_session(plan, player, day, device, None, "FAIL_PAYMENT"))

        case_count = plan.signal_count(
            SCN009_SUPPORT_BASE, plan.daily_mean("support_cases", market), SCN009_SUPPORT_SHARE
        )
        template = SCN009_SUPPORT_TEMPLATES[MARKET_LANGUAGE[market]]
        market_cases: list[SupportCaseRow] = []
        for _ in range(case_count):
            day = plan.rng.choice(active_days)
            opened = day + timedelta(seconds=plan.rng.randrange(SECONDS_PER_DAY))
            market_cases.append(
                _support_case(
                    plan,
                    market,
                    plan.rng.choice(players),
                    opened,
                    plan.local("support_category", market, "PAYMENT"),
                    template.format(date=day.date().isoformat()),
                )
            )
        first_case, *_ = market_cases
        first_cases.append(first_case.support_case_id)
        support.extend(market_cases)

    review = _post_incident_review(plan, provider, markets, start)
    plan.add("sessions", sessions)
    plan.add("support_cases", support)
    plan.add("documents", [review])
    plan.add("document_chunks", plan.chunk_rows(review))

    plan.affected_markets = list(markets)
    plan.start_date = start.date()
    plan.duration_days = SCN009_WINDOW_DAYS
    plan.truth = {
        "provider_id": provider,
        "affected_markets": list(markets),
        "active_days": [day.date().isoformat() for day in active_days],
        "expected_interpretation": (
            f"payment provider {provider} degraded intermittently across {', '.join(markets)}; "
            "the failures share the provider, not a market, channel or product"
        ),
    }
    plan.required_evidence = [provider, review.document_id, *first_cases]


def _draw_release(plan: ScenarioPlanter) -> AppVersionRow:
    """Draw the market, then the release, among markets with an eligible release."""
    low, high = SCN001_RELEASE_DAYS
    releases: dict[str, list[AppVersionRow]] = defaultdict(list)
    for version in plan.tables["app_versions"]:
        if low <= (version.released_at.date() - WINDOW_START).days <= high:
            releases[version.market_id].append(version)
    eligible = [m for m in plan.markets_with_active_players(SCN001_COHORT_SIZE) if releases[m]]
    if not eligible:
        raise RuntimeError(f"scenario {plan.spec.scenario_id}: no eligible market")
    market = plan.rng.choice(eligible)
    return plan.rng.choice(sorted(releases[market], key=lambda v: v.app_version_id))


def _family_devices(
    plan: ScenarioPlanter,
    market: str,
    cohort: list[PlayerRow],
    family: str,
    start: datetime,
) -> dict[str, list[str]]:
    """Each cohort player's devices of `family`; plant one for players without any."""
    device_family = {d.device_id: d.device_family for d in plan.tables["devices"]}
    owned = plan.devices_of([p.player_id for p in cohort])
    code = plan.market_code(market)
    first_seen = start - timedelta(days=SCN001_DEVICE_LEAD_DAYS)
    result: dict[str, list[str]] = {}
    new_devices: list[DeviceRow] = []
    new_links: list[PlayerDeviceRow] = []
    for player in cohort:
        matching = [d for d in owned.get(player.player_id, []) if device_family[d] == family]
        if not matching:
            device_id = plan.next_id("devices", market_code=code)
            new_devices.append(
                DeviceRow(
                    device_id=device_id,
                    device_fingerprint=f"fp-{device_id.lower()}",
                    device_family=family,
                    os_version_bucket=SCN001_OS_BUCKET[family],
                    app_capable=True,
                    first_seen_at=first_seen,
                )
            )
            new_links.append(
                PlayerDeviceRow(
                    player_id=player.player_id,
                    device_id=device_id,
                    first_seen_at=first_seen,
                    last_seen_at=start + timedelta(days=SCN001_WINDOW_DAYS),
                    usage_weight=SCN001_LINK_USAGE_WEIGHT,
                )
            )
            matching = [device_id]
        result[player.player_id] = matching
    plan.add("devices", new_devices)
    plan.add("player_device", new_links)
    return result


def _provider_markets(
    plan: ScenarioPlanter, provider: str, window_end: datetime
) -> tuple[dict[str, int], dict[str, list[PlayerRow]]]:
    """Per market: payment methods on `provider`, and active players paying through it."""
    on_provider = {
        m.payment_method_id for m in plan.tables["payment_methods"] if m.provider_id == provider
    }
    links = [
        link
        for link in plan.tables["player_payment_method"]
        if link.payment_method_id in on_provider
    ]
    player_market = {p.player_id: p.market_id for p in plan.tables["players"]}
    methods: dict[str, set[str]] = defaultdict(set)
    for link in links:
        methods[player_market[link.player_id]].add(link.payment_method_id)
    payer_ids = {link.player_id for link in links if link.first_used_at < window_end}
    payers: dict[str, list[PlayerRow]] = defaultdict(list)
    for player in plan.tables["players"]:
        if player.account_status == "ACTIVE" and player.player_id in payer_ids:
            payers[player.market_id].append(player)
    return {market: len(ids) for market, ids in methods.items()}, payers


def _session(
    plan: ScenarioPlanter,
    player: PlayerRow,
    day: datetime,
    device_id: str | None,
    app_version_id: str | None,
    outcome: str,
) -> SessionRow:
    """One failing checkout session at a random time of `day`."""
    started_at = day + timedelta(seconds=plan.rng.randrange(SECONDS_PER_DAY))
    if device_id is not None and app_version_id is None:
        app_version_id = plan.app_version_at(player.market_id, started_at)
    return SessionRow(
        session_id=plan.next_id("sessions"),
        player_id=player.player_id,
        market_id=player.market_id,
        device_id=device_id,
        channel_code="APP" if device_id is not None else "WEB",
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=plan.rng.randrange(*SESSION_MINUTES)),
        app_version_id=app_version_id,
        session_outcome=outcome,
    )


def _support_case(
    plan: ScenarioPlanter,
    market: str,
    player: PlayerRow,
    opened: datetime,
    category: str,
    summary: str,
    game_id: str | None = None,
    incident_id: str | None = None,
) -> SupportCaseRow:
    low, spread = SENTIMENT
    return SupportCaseRow(
        support_case_id=plan.next_id("support_cases"),
        market_id=market,
        player_id=player.player_id,
        game_id=game_id,
        incident_id=incident_id,
        opened_at=opened,
        closed_at=opened + timedelta(hours=plan.rng.randrange(*CASE_OPEN_HOURS)),
        category_code=category,
        sentiment_score=round(low + plan.rng.random() * spread, 2),
        summary_text=summary,
    )


def _release_note(plan: ScenarioPlanter, release: AppVersionRow) -> DocumentRow:
    """Release note in the market language naming the changed checkout component."""
    language = MARKET_LANGUAGE[release.market_id]
    return DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="RELEASE_NOTE",
        market_id=release.market_id,
        language_code=language,
        title=f"Release Note: {release.version_label} ({release.app_version_id})",
        created_at=release.released_at,
        valid_from=release.released_at,
        valid_to=None,
        source_system_code="document_store",
        source_record_id=release.app_version_id,
        body=SCN001_RELEASE_NOTE_TEMPLATES[language].format(
            app_version=release.app_version_id,
            label=release.version_label,
            component=SCN001_CHECKOUT_COMPONENT,
        ),
    )


def _incident_report(
    plan: ScenarioPlanter,
    incident: IncidentRow,
    release: AppVersionRow,
    family: str,
    start: datetime,
) -> DocumentRow:
    """Incident report in the market language naming the local incident type."""
    language = MARKET_LANGUAGE[release.market_id]
    type_name = plan.names[("incident_type", incident.incident_type)]
    created = start + timedelta(days=SCN001_INCIDENT_REPORT_DAY, hours=SCN001_INCIDENT_HOUR)
    return DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="INCIDENT_REPORT",
        market_id=release.market_id,
        language_code=language,
        title=f"Incident Report: {type_name} ({incident.incident_id})",
        created_at=created,
        valid_from=created,
        valid_to=None,
        source_system_code="document_store",
        source_record_id=incident.incident_id,
        body=SCN001_REPORT_TEMPLATES[language].format(
            incident=incident.incident_id,
            incident_type=type_name,
            date=incident.started_at.date().isoformat(),
            family=SCN001_FAMILY_LABEL[family],
            app_version=release.app_version_id,
        ),
    )


def _post_incident_review(
    plan: ScenarioPlanter, provider: str, markets: list[str], start: datetime
) -> DocumentRow:
    """Corporate English review that first ties the markets' symptoms to the provider."""
    created = at(SCN009_REVIEW_DAY, SCN009_REVIEW_HOUR)
    *leading, last = markets
    end = start + timedelta(days=SCN009_WINDOW_DAYS - 1)
    return DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="POST_INCIDENT_REVIEW",
        market_id=None,
        language_code="en",
        title=f"Post Incident Review: Payment Provider Degradation ({provider})",
        created_at=created,
        valid_from=created,
        valid_to=None,
        source_system_code="document_store",
        source_record_id=provider,
        body=SCN009_REVIEW_TEMPLATE.format(
            start=start.date().isoformat(),
            end=end.date().isoformat(),
            provider=provider,
            markets=f"{', '.join(leading)} and {last}",
        ),
    )
