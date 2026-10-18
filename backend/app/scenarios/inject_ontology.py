"""Ontology-dependent scenarios: mechanic affinity (SCN-010) and transferable campaign (SCN-011).

Both scenarios plant a pattern that only lines up across markets through the
ontology: every market names its mechanics, families and segments with its
own local codes in its own language, and only the ontology binds those codes
to shared concepts. The injectors therefore operate on local codes only and
never write a concept id into the world; concept ids appear in the truth
ledger alone.

SCN-010: one engaged segment over-indexes on the product built on one
mechanic (drawn from the scenario stream) in three markets drawn from the
eligible ones; the fourth market is the control. Each affected market gets
extra tickets on the game from its engaged players, solved so the game's
engaged share exceeds the market's by a strength-scaled lift, and a monthly
review in its language that names the game and segment by local name only.

SCN-011: a cross-sell campaign for one market's retail instant game succeeds
with its engaged segment. A second market (the transfer target) has the same
structure by construction: a retail instant game and an engaged segment. The
target is drawn with the source as an ordered pair; nothing is planted there.

KPIs are not edited here; they are derived from the planted rows afterwards.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta
from decimal import Decimal
from itertools import cycle, islice
from math import ceil
from typing import NamedTuple

from app.datasets.config import WINDOW_DAYS
from app.datasets.master_data import MARKET_CURRENCY
from app.datasets.rows import (
    CampaignExposureRow,
    CampaignGameMapRow,
    CampaignRow,
    DocumentRow,
    DrawRow,
    GameRow,
    PlayerRow,
    TicketRow,
)
from app.datasets.taxonomies import MARKET_LANGUAGE, segments_for
from app.scenarios.planter import ScenarioPlanter, at

SECONDS_PER_DAY = 24 * 60 * 60

# SCN-010: the mechanic meanings the scenario draws from, with the truth-only
# concept each one denotes and the local mechanic code per market code.
SCN010_MECHANICS: dict[str, tuple[str, dict[str, str]]] = {
    "symbol reveal": (
        "CONCEPT_SYMBOL_REVEAL",
        {
            "UK": "MECH_UK_SCRATCH",
            "GR": "MECH_GR_XYSIMO",
            "AT": "MECH_AT_RUBBELN",
            "CZ": "MECH_CZ_STIRANI",
        },
    ),
    "quick pick": (
        "CONCEPT_QUICK_PICK",
        {
            "UK": "MECH_UK_QUICK_PICK",
            "GR": "MECH_GR_TYCHAIA_EPILOGI",
            "AT": "MECH_AT_SCHNELLWAHL",
            "CZ": "MECH_CZ_NAHODNY_TIP",
        },
    ),
}
# Truth-only concept of the segment both scenarios plant into.
ENGAGED_CONCEPT = "CONCEPT_ENGAGED"
SCN010_MARKET_COUNT = 3
# Planted tickets fall between these window days (inclusive); the review follows.
SCN010_TICKET_DAYS = (60, 240)
# Engaged share lift on the planted game per unit of scenario strength: the
# planted volume is solved so the game's engaged share reaches the market's
# engaged share (after planting) plus this lift (0.15 at strength 0.5), capped.
SCN010_LIFT_PER_STRENGTH = 0.3
SCN010_MAX_TARGET_SHARE = 0.95
# Floor on planted tickets per market, for games already above the target.
# Each planted ticket goes to the next engaged player of a shuffled pool.
SCN010_MIN_TICKETS = 30
SCN010_REVIEW_DAY = 250
SCN010_REVIEW_HOUR = 9

# SCN-011: the family bound to the retail instant meaning, per market code.
SCN011_RETAIL_INSTANT_FAMILY = {
    "UK": "FAM_UK_SCRATCHCARD",
    "GR": "FAM_GR_XYSTO",
    "AT": "FAM_AT_RUBBELLOS",
    "CZ": "FAM_CZ_STIRACI_LOS",
}
SCN011_CONCEPT_CHAIN = ["CONCEPT_RETAIL_INSTANT", ENGAGED_CONCEPT]
SCN011_OBJECTIVE = "OBJ_CROSS_SELL"
SCN011_CAMPAIGN_DAYS = (100, 140)  # start and end window day
SCN011_EVALUATION_DAY = 150
SCN011_EVALUATION_HOUR = 10
# Mid-range of the baseline campaign budgets (50 000 to 5 000 000 in market currency).
SCN011_BUDGET_AMOUNT = Decimal("2500000.00")
SCN011_PROMOTION_WEIGHT = 1.5
# Signal volume: at least `base` exposures, else share x strength x daily exposure mean.
SCN011_EXPOSURE_BASE, SCN011_EXPOSURE_SHARE = 40, 0.5
# Far above the baseline shares (distributions.EXPOSURE_ENGAGED_SHARE 0.30 and
# EXPOSURE_CONVERSION_SHARE 0.25): share of exposures engaged, and of engaged
# exposures converting to the promoted game. Applied as exact counts.
SCN011_ENGAGED_SHARE = 0.70
SCN011_CONVERSION_SHARE = 0.45
SCN011_EXPOSURE_CHANNELS = ("APP", "WEB", "RETAIL")
# Hours from exposure to conversion (half-open range), capped at the campaign end.
SCN011_CONVERSION_HOURS = (1, 72)

# Monthly reviews per language: four sentences, no internal ". ".
SCN010_REVIEW_TEMPLATES = {
    "en": (
        "In the reporting period the {segment} segment clearly over-indexed on {game}. "
        "Players in the {segment} segment bought {game} far more often than the market average. "
        "The product is built on the mechanic “{mechanic}”. "
        "The trend held from {start} to {end} and should inform the next product plan."
    ),
    "el": (
        "Κατά την περίοδο αναφοράς το τμήμα «{segment}» υπερεκπροσωπήθηκε σαφώς στο {game}. "
        "Οι παίκτες του τμήματος «{segment}» αγόραζαν {game} πολύ συχνότερα από τον μέσο όρο "
        "της αγοράς. "
        "Το προϊόν βασίζεται στον μηχανισμό «{mechanic}». "
        "Η τάση διατηρήθηκε από {start} έως {end} και πρέπει να ληφθεί υπόψη στον επόμενο "
        "σχεδιασμό προϊόντων."
    ),
    "de": (
        "Im Berichtszeitraum war das Segment „{segment}“ bei {game} deutlich überrepräsentiert. "
        "Spieler im Segment „{segment}“ kauften {game} weit häufiger als der Marktdurchschnitt. "
        "Das Produkt beruht auf der Mechanik „{mechanic}“. "
        "Der Trend hielt vom {start} bis zum {end} an und sollte in die nächste Produktplanung "
        "einfließen."
    ),
    "cs": (
        "Ve sledovaném období byl segment „{segment}“ výrazně nadprůměrně zastoupen u hry {game}. "
        "Hráči segmentu „{segment}“ kupovali {game} mnohem častěji než průměr trhu. "
        "Produkt je založen na mechanice „{mechanic}“. "
        "Trend trval od {start} do {end} a měl by se promítnout do dalšího plánování produktů."
    ),
}
SCN011_CAMPAIGN_NAMES = {
    "en": "Instant Cross-Sell Push",
    "el": "Ενέργεια διασταυρούμενων πωλήσεων",
    "de": "Cross-Selling-Aktion",
    "cs": "Křížový prodej",
}
# Campaign evaluations per language: four sentences, no internal ". ".
SCN011_EVALUATION_TEMPLATES = {
    "en": (
        "The campaign {campaign} promoted {game} ({family}) to the {segment} segment "
        "from {start} to {end}. "
        "{engaged} percent of exposed players engaged with the campaign. "
        "{converted} percent of engaged players went on to buy {game}. "
        "The result is well above our usual campaign response and the approach is worth repeating."
    ),
    "el": (
        "Η καμπάνια «{campaign}» προώθησε το {game} ({family}) στο τμήμα «{segment}» "
        "από {start} έως {end}. "
        "Το {engaged} τοις εκατό των παικτών που την είδαν αλληλεπίδρασε με την καμπάνια. "
        "Το {converted} τοις εκατό των ενεργών παικτών αγόρασε στη συνέχεια {game}. "
        "Το αποτέλεσμα είναι πολύ πάνω από τη συνήθη απόκριση και η προσέγγιση αξίζει "
        "να επαναληφθεί."
    ),
    "de": (
        "Die Kampagne „{campaign}“ bewarb {game} ({family}) vom {start} bis zum {end} "
        "im Segment „{segment}“. "
        "{engaged} Prozent der erreichten Spieler reagierten auf die Kampagne. "
        "{converted} Prozent der reagierenden Spieler kauften anschließend {game}. "
        "Das Ergebnis liegt deutlich über der üblichen Kampagnenresonanz und der Ansatz "
        "sollte wiederholt werden."
    ),
    "cs": (
        "Kampaň „{campaign}“ propagovala hru {game} ({family}) v segmentu „{segment}“ "
        "od {start} do {end}. "
        "Na kampaň reagovalo {engaged} procent oslovených hráčů. "
        "Hru {game} si následně koupilo {converted} procent reagujících hráčů. "
        "Výsledek je výrazně nad obvyklou odezvou kampaní a přístup stojí za zopakování."
    ),
}


def plant_game_mechanic_affinity(plan: ScenarioPlanter) -> None:
    """SCN-010: one engaged segment over-indexes on one mechanic's product in three markets."""
    meaning = plan.rng.choice(tuple(SCN010_MECHANICS))
    concept, local_codes = SCN010_MECHANICS[meaning]
    first_day, last_day = SCN010_TICKET_DAYS
    ticket_start = at(first_day)
    games_by_market = _games_with_mechanic(plan, local_codes, ticket_start)
    eligible = sorted(games_by_market)
    if len(eligible) < SCN010_MARKET_COUNT:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: fewer than {SCN010_MARKET_COUNT} markets "
            f"have a {meaning} game"
        )
    markets = plan.rng.sample(eligible, SCN010_MARKET_COUNT)
    (control,) = sorted({m.market_id for m in plan.tables["markets"]} - set(markets))
    draws = _draws_by_game(plan)

    tickets: list[TicketRow] = []
    documents: list[DocumentRow] = []
    per_market: dict[str, dict[str, object]] = {}
    for market in markets:
        code = plan.market_code(market)
        engaged, _casual, _dormant = segments_for(code, "ENGAGEMENT")
        game = plan.rng.choice(games_by_market[market])
        volume = _affinity_volume(plan, market, game, engaged)
        pool = _engaged_players(plan, market, engaged, ticket_start)
        market_tickets = [
            _ticket(plan, player, game, at(plan.rng.randint(first_day, last_day)), draws)
            for player in _spread(plan, pool, volume.tickets)
        ]
        review = _market_review(plan, market, engaged, game, local_codes[code])
        tickets.extend(market_tickets)
        documents.append(review)
        per_market[market] = {
            "game_id": game.game_id,
            "mechanic_code": local_codes[code],
            "segment_id": engaged,
            "document_id": review.document_id,
            "planted_ticket_count": len(market_tickets),
            "baseline_game_tickets": volume.baseline_game_tickets,
            "baseline_engaged_share": volume.baseline_engaged_share,
            "market_engaged_share": volume.market_engaged_share,
            "target_share": volume.target_share,
        }

    plan.add("tickets", tickets)
    plan.add("documents", documents)
    plan.add("document_chunks", [chunk for doc in documents for chunk in plan.chunk_rows(doc)])

    game_ids = [str(detail["game_id"]) for detail in per_market.values()]
    plan.affected_markets = list(markets)
    plan.affected_games = sorted(game_ids)
    plan.start_date = ticket_start.date()
    plan.duration_days = last_day - first_day + 1
    plan.truth = {
        "mechanic_concept": concept,
        "segment_concept": ENGAGED_CONCEPT,
        "per_market": per_market,
        "control_market": control,
        "uplift_note": (
            f"the engaged segment over-indexes on the {meaning} product in "
            f"{', '.join(markets)}; each market names the mechanic and segment with its own "
            "local code, so the pattern is one concept only through the ontology"
        ),
    }
    plan.required_evidence = [*game_ids, *(doc.document_id for doc in documents)]


def plant_transferable_campaign(plan: ScenarioPlanter) -> None:
    """SCN-011: a successful cross-sell campaign with a structurally similar target market."""
    instant = _retail_instant_games(plan)
    source, target = plan.rng.sample(sorted(instant), 2)
    source_code = plan.market_code(source)
    source_segment, _casual, _dormant = segments_for(source_code, "ENGAGEMENT")
    target_segment, _casual, _dormant = segments_for(plan.market_code(target), "ENGAGEMENT")
    _require_segment(plan, target, target_segment)
    source_game = plan.rng.choice(instant[source])
    target_game = plan.rng.choice(instant[target])

    first_day, last_day = SCN011_CAMPAIGN_DAYS
    language = MARKET_LANGUAGE[source]
    campaign = CampaignRow(
        campaign_id=plan.next_id("campaigns"),
        market_id=source,
        campaign_name=f"{SCN011_CAMPAIGN_NAMES[language]} {source_code}",
        campaign_type=SCN011_OBJECTIVE,
        start_at=at(first_day),
        end_at=at(last_day),
        budget_amount=SCN011_BUDGET_AMOUNT,
        currency_code=MARKET_CURRENCY[source_code],
        objective_code=SCN011_OBJECTIVE,
    )
    exposure_count = plan.signal_count(
        SCN011_EXPOSURE_BASE, _daily_exposures(plan, source), SCN011_EXPOSURE_SHARE
    )
    pool = _engaged_players(plan, source, source_segment, campaign.start_at)
    exposures = _exposures(plan, campaign, source_game, _spread(plan, pool, exposure_count))
    evaluation = _campaign_evaluation(plan, campaign, source_segment, source_game, exposures)

    plan.add("campaigns", [campaign])
    plan.add(
        "campaign_game_map",
        [CampaignGameMapRow(campaign.campaign_id, source_game.game_id, SCN011_PROMOTION_WEIGHT)],
    )
    plan.add("campaign_exposures", exposures)
    plan.add("documents", [evaluation])
    plan.add("document_chunks", plan.chunk_rows(evaluation))

    plan.affected_markets = [source, target]
    plan.affected_games = sorted((source_game.game_id, target_game.game_id))
    plan.start_date = campaign.start_at.date()
    plan.duration_days = last_day - first_day
    plan.truth = {
        "source_market": source,
        "source_campaign_id": campaign.campaign_id,
        "source_game_id": source_game.game_id,
        "source_segment_id": source_segment,
        "target_market": target,
        "target_game_id": target_game.game_id,
        "target_segment_id": target_segment,
        "concept_chain": list(SCN011_CONCEPT_CHAIN),
        "expected_interpretation": (
            f"campaign {campaign.campaign_id} worked for the engaged segment on the retail "
            f"instant game {source_game.game_id} in {source}; {target} has the same structure "
            f"({target_game.game_id} and {target_segment}), so transferring it is a reasonable "
            "recommendation with moderate confidence, not a certainty"
        ),
    }
    plan.required_evidence = [
        campaign.campaign_id,
        source_game.game_id,
        target_game.game_id,
        evaluation.document_id,
    ]


class _AffinityVolume(NamedTuple):
    tickets: int
    baseline_game_tickets: int
    baseline_engaged_share: float
    market_engaged_share: float
    target_share: float


def _affinity_volume(
    plan: ScenarioPlanter, market: str, game: GameRow, segment: str
) -> _AffinityVolume:
    """Engaged tickets that lift the game's engaged share to the market share plus the lift.

    Shares count identified tickets only (anonymous retail tickets have no
    segment). Solving (s_g n + k) / (n + k) = t for k gives the volume. The
    planted tickets also raise the market's own engaged share, so the target
    is re-derived from the market share including the k planted tickets until
    k stops changing: k only grows and t is capped, so the loop terminates.
    """
    segment_of = {p.player_id: p.engagement_segment for p in plan.tables["players"]}
    identified = [
        t for t in plan.tables["tickets"] if t.market_id == market and t.player_id is not None
    ]
    on_game = [t for t in identified if t.game_id == game.game_id]
    if not on_game:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: {game.game_id} has no identified tickets"
        )
    n, total = len(on_game), len(identified)
    market_share = _segment_share(identified, segment_of, segment)
    game_share = _segment_share(on_game, segment_of, segment)
    lift = SCN010_LIFT_PER_STRENGTH * plan.spec.strength
    tickets, previous = SCN010_MIN_TICKETS, 0
    while tickets != previous:
        previous = tickets
        planted_market_share = (market_share * total + tickets) / (total + tickets)
        target = min(SCN010_MAX_TARGET_SHARE, planted_market_share + lift)
        solved = ceil(n * (target - game_share) / (1 - target)) if target > game_share else 0
        tickets = max(SCN010_MIN_TICKETS, solved)
    return _AffinityVolume(
        tickets=tickets,
        baseline_game_tickets=n,
        baseline_engaged_share=round(game_share, 4),
        market_engaged_share=round(market_share, 4),
        target_share=round(target, 4),
    )


def _segment_share(tickets: list[TicketRow], segment_of: dict[str, str], segment: str) -> float:
    return sum(1 for t in tickets if segment_of[str(t.player_id)] == segment) / len(tickets)


def _games_with_mechanic(
    plan: ScenarioPlanter, local_codes: dict[str, str], launched_by: datetime
) -> dict[str, list[GameRow]]:
    """Per market, games (sorted) carrying the market's local mechanic code."""
    wanted = set(local_codes.values())
    carrying = {
        link.game_id for link in plan.tables["game_mechanic_map"] if link.mechanic_id in wanted
    }
    grouped: dict[str, list[GameRow]] = {}
    for game in sorted(plan.tables["games"], key=lambda g: g.game_id):
        if game.game_id in carrying and game.launch_date <= launched_by.date():
            grouped.setdefault(game.market_id, []).append(game)
    return grouped


def _retail_instant_games(plan: ScenarioPlanter) -> dict[str, list[GameRow]]:
    """Per market, games (sorted) of the market's retail instant family."""
    families = set(SCN011_RETAIL_INSTANT_FAMILY.values())
    grouped: dict[str, list[GameRow]] = {}
    for game in sorted(plan.tables["games"], key=lambda g: g.game_id):
        if game.game_family_id in families:
            grouped.setdefault(game.market_id, []).append(game)
    if len(grouped) < 2:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: fewer than two markets have a retail instant game"
        )
    return grouped


def _require_segment(plan: ScenarioPlanter, market: str, segment: str) -> None:
    if not any(s.segment_id == segment for s in plan.tables["player_segments"]):
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: {market} has no engaged segment {segment}"
        )


def _engaged_players(
    plan: ScenarioPlanter, market: str, segment: str, registered_by: datetime
) -> list[PlayerRow]:
    """Active players of the engaged segment registered before the planted activity."""
    pool = sorted(
        (
            p
            for p in plan.tables["players"]
            if p.market_id == market
            and p.account_status == "ACTIVE"
            and p.engagement_segment == segment
            and p.registration_date <= registered_by.date()
        ),
        key=lambda p: p.player_id,
    )
    if not pool:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: no active {segment} players in {market}"
        )
    return pool


def _spread(plan: ScenarioPlanter, pool: list[PlayerRow], count: int) -> Iterable[PlayerRow]:
    """`count` players: every pool player once in drawn order before any repeats."""
    return islice(cycle(plan.rng.sample(pool, len(pool))), count)


def _draws_by_game(plan: ScenarioPlanter) -> dict[str, list[DrawRow]]:
    grouped: dict[str, list[DrawRow]] = {}
    for draw in sorted(plan.tables["draws"], key=lambda d: d.draw_timestamp):
        grouped.setdefault(draw.game_id, []).append(draw)
    return grouped


def _ticket(
    plan: ScenarioPlanter,
    player: PlayerRow,
    game: GameRow,
    day: datetime,
    draws: dict[str, list[DrawRow]],
) -> TicketRow:
    """One settled ticket on `game` at a random time of `day`."""
    purchased = day + timedelta(seconds=plan.rng.randrange(SECONDS_PER_DAY))
    retail = not game.digital_enabled
    return TicketRow(
        ticket_id=plan.next_id("tickets"),
        player_id=player.player_id,
        game_id=game.game_id,
        market_id=game.market_id,
        draw_id=_entered_draw(plan, game, purchased, draws),
        retailer_id=_retailer(plan, game.market_id, purchased) if retail else None,
        channel_code="RETAIL" if retail else "APP",
        purchase_timestamp=purchased,
        stake_amount=game.ticket_price,
        currency_code=game.currency_code,
        ticket_status="SETTLED",
    )


def _entered_draw(
    plan: ScenarioPlanter, game: GameRow, purchased: datetime, draws: dict[str, list[DrawRow]]
) -> str | None:
    """The draw a ticket enters: the game's first draw at or after purchase; none if drawless."""
    if game.draw_frequency_code == "NONE":
        return None
    entered = next((d for d in draws.get(game.game_id, []) if d.draw_timestamp >= purchased), None)
    if entered is None:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: {game.game_id} has no draw after {purchased}"
        )
    return str(entered.draw_id)


def _retailer(plan: ScenarioPlanter, market: str, moment: datetime) -> str:
    active: list[str] = sorted(
        r.retailer_id
        for r in plan.tables["retailers"]
        if r.market_id == market
        and r.active_from <= moment.date()
        and (r.active_to is None or r.active_to >= moment.date())
    )
    if not active:
        raise RuntimeError(
            f"scenario {plan.spec.scenario_id}: no active retailer in {market} on {moment.date()}"
        )
    return plan.rng.choice(active)


def _daily_exposures(plan: ScenarioPlanter, market: str) -> float:
    """Mean campaign exposures per day for a market's campaigns over the window."""
    campaigns = {c.campaign_id for c in plan.tables["campaigns"] if c.market_id == market}
    count = sum(1 for e in plan.tables["campaign_exposures"] if e.campaign_id in campaigns)
    return count / WINDOW_DAYS


def _exposures(
    plan: ScenarioPlanter, campaign: CampaignRow, game: GameRow, players: Iterable[PlayerRow]
) -> list[CampaignExposureRow]:
    """Exposures with exact engaged and converting shares, in drawn order."""
    audience = list(players)
    engaged = round(len(audience) * SCN011_ENGAGED_SHARE)
    converted = round(engaged * SCN011_CONVERSION_SHARE)
    outcomes = (
        [(True, True)] * converted
        + [(True, False)] * (engaged - converted)
        + [(False, False)] * (len(audience) - engaged)
    )
    plan.rng.shuffle(outcomes)
    span = int((campaign.end_at - campaign.start_at).total_seconds())
    rows: list[CampaignExposureRow] = []
    for player, (is_engaged, is_converted) in zip(audience, outcomes, strict=True):
        exposed_at = campaign.start_at + timedelta(seconds=plan.rng.randrange(span))
        converted_at = (
            min(
                exposed_at + timedelta(hours=plan.rng.randrange(*SCN011_CONVERSION_HOURS)),
                campaign.end_at,
            )
            if is_converted
            else None
        )
        rows.append(
            CampaignExposureRow(
                exposure_id=plan.next_id("campaign_exposures"),
                campaign_id=campaign.campaign_id,
                player_id=player.player_id,
                channel_code=plan.rng.choice(SCN011_EXPOSURE_CHANNELS),
                exposed_at=exposed_at,
                engaged=is_engaged,
                converted_game_id=game.game_id if is_converted else None,
                converted_at=converted_at,
            )
        )
    return rows


def _market_review(
    plan: ScenarioPlanter, market: str, segment: str, game: GameRow, mechanic_code: str
) -> DocumentRow:
    """Monthly review in the market language naming segment, game and mechanic locally."""
    language = MARKET_LANGUAGE[market]
    mechanic = next(m for m in plan.tables["game_mechanics"] if m.mechanic_id == mechanic_code)
    first_day, last_day = SCN010_TICKET_DAYS
    created = at(SCN010_REVIEW_DAY, SCN010_REVIEW_HOUR)
    return DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="MONTHLY_MARKET_REVIEW",
        market_id=market,
        language_code=language,
        title="Monthly Market Review: Reporting Period",
        created_at=created,
        valid_from=created,
        valid_to=None,
        source_system_code="document_store",
        source_record_id="",
        body=SCN010_REVIEW_TEMPLATES[language].format(
            segment=plan.names[("segment", segment)],
            game=game.game_name,
            mechanic=mechanic.description,
            start=at(first_day).date().isoformat(),
            end=at(last_day).date().isoformat(),
        ),
    )


def _campaign_evaluation(
    plan: ScenarioPlanter,
    campaign: CampaignRow,
    segment: str,
    game: GameRow,
    exposures: list[CampaignExposureRow],
) -> DocumentRow:
    """Evaluation in the source language naming segment and game by local name."""
    language = MARKET_LANGUAGE[campaign.market_id]
    engaged = [e for e in exposures if e.engaged]
    converted = [e for e in engaged if e.converted_game_id is not None]
    created = at(SCN011_EVALUATION_DAY, SCN011_EVALUATION_HOUR)
    return DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="CAMPAIGN_EVALUATION",
        market_id=campaign.market_id,
        language_code=language,
        title=f"Campaign Evaluation: {campaign.campaign_name} ({campaign.campaign_id})",
        created_at=created,
        valid_from=created,
        valid_to=None,
        source_system_code="document_store",
        source_record_id=campaign.campaign_id,
        body=SCN011_EVALUATION_TEMPLATES[language].format(
            campaign=campaign.campaign_name,
            game=game.game_name,
            family=plan.names[("family", game.game_family_id)],
            segment=plan.names[("segment", segment)],
            start=campaign.start_at.date().isoformat(),
            end=campaign.end_at.date().isoformat(),
            engaged=round(100 * len(engaged) / len(exposures)),
            converted=round(100 * len(converted) / len(engaged)),
        ),
    )
