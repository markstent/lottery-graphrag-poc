"""Structural grounders: one function per logical question (H1, H2, H3).

Each grounder reads a :class:`World` snapshot of one generated world and
returns a :class:`Draft` for every eligible anchor: the slot text, the
expected answer, the answer checks and the claim specs. Eligibility bounds
are those of the Phase 3 plan; a grounder never widens one. Sampling,
carrier resolution and anchor exclusion happen in ``app.evaluation.grounding``.

An incident's markets are its own market when set, otherwise the markets of
the games it affects; incidents without a market of their own are never
anchors of the cross-market questions (L05, L10).

Taxonomy names (families, mechanics, segments) come from
``local_name_variants()``; the world tables say which records exist. Ontology
equivalence comes from ``load_ontology()`` bindings; Neo4j is never read.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import duckdb

from app.datasets.document_templates import MARKET_NAMES
from app.datasets.taxonomies import MARKET_LANGUAGE, local_name_variants
from app.evaluation.checks import (
    UNIT_SYMBOLS,
    Check,
    NumberCheck,
    SetCheck,
    TokenCheck,
    VerdictCheck,
)
from app.evaluation.claims import ClaimSpec
from app.ontology.model import Ontology

# Every answer set holds between these many members once the anchor is excluded.
MIN_SET = 1
MAX_SET = 6
# L06: an incident qualifies when it affects this many games.
MAX_L06_GAMES = 4
# L11: a segment concept binds segments in this many other markets.
MAX_L11_MARKETS = 3
# L13 and L14: a name-anchored answer set holds at least this many games.
MIN_NAMED_SET = 2
# L13: the family concept binds families in at least this many markets.
MIN_L13_MARKETS = 2


@dataclass(frozen=True, slots=True)
class Game:
    market_id: str
    name: str
    family_id: str
    price: Decimal
    currency: str
    digital: bool


@dataclass(frozen=True, slots=True)
class Incident:
    # None for a corporate incident, which belongs to no market of its own.
    market_id: str | None
    platform_version_id: str | None
    incident_type: str
    started_on: date
    # The incident's markets: its own market when set, otherwise the
    # markets of the games it affects (empty when it affects none).
    markets: frozenset[str]


@dataclass(frozen=True, slots=True)
class Version:
    """A platform version or an app release: its label ("2024.3.0", "5.3.1")
    and the names of what it belongs to (a platform's name and id, or a
    market's names and id)."""

    label: str
    owners: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MechanicUse:
    game_id: str
    mechanic_id: str
    weight: float
    valid_from: date | None
    valid_to: date | None

    def valid_on(self, day: date) -> bool:
        """Inclusive bounds; a null bound is open-ended."""
        return (self.valid_from is None or self.valid_from <= day) and (
            self.valid_to is None or day <= self.valid_to
        )


@dataclass(frozen=True, slots=True)
class World:
    """The records of one world the structural grounders read."""

    markets: Mapping[str, tuple[str, ...]]
    games: Mapping[str, Game]
    incidents: Mapping[str, Incident]
    platform_versions: Mapping[str, Version]
    app_releases: Mapping[str, Version]
    incident_games: Mapping[str, tuple[str, ...]]
    mechanic_uses: tuple[MechanicUse, ...]
    mechanic_markets: Mapping[str, str]
    family_markets: Mapping[str, str]
    segment_markets: Mapping[str, str]
    campaign_ends: Mapping[str, tuple[str, date]]
    case_incidents: Mapping[str, str]
    names: Mapping[tuple[str, str], tuple[str, ...]]
    ontology: Ontology

    def name(self, kind: str, code: str) -> str:
        """The display name of a taxonomy code (a mechanic's is its code)."""
        return self.names[(kind, code)][0]

    def concept(self, kind: str, code: str) -> str | None:
        return self.ontology.concept_for(kind, code)

    def label(self, concept_id: str) -> str:
        return self.ontology.concept(concept_id).labels["en"]

    def game_universe(self) -> dict[str, tuple[str, ...]]:
        return {game_id: (game.name,) for game_id, game in self.games.items()}

    def uses_of(self, game_id: str) -> list[MechanicUse]:
        return [use for use in self.mechanic_uses if use.game_id == game_id]


def load_world(connection: duckdb.DuckDBPyConnection, ontology: Ontology) -> World:
    """Read the snapshot through a connection whose views name the world tables."""

    def rows(sql: str) -> list[tuple[object, ...]]:
        return connection.execute(sql).fetchall()

    markets: dict[str, tuple[str, ...]] = {}
    for market_id, name in rows("SELECT market_id, market_name FROM markets ORDER BY 1"):
        market = str(market_id)
        local = MARKET_NAMES[MARKET_LANGUAGE[market]][market]
        markets[market] = tuple(dict.fromkeys((str(name), local)))
    games = {
        str(r[0]): Game(str(r[1]), str(r[2]), str(r[3]), _decimal(r[4]), str(r[5]), bool(r[6]))
        for r in rows(
            "SELECT game_id, market_id, game_name, game_family_id, ticket_price, currency_code,"
            " digital_enabled FROM games ORDER BY 1"
        )
    }
    incident_games: dict[str, list[str]] = defaultdict(list)
    for incident_id, game_id in rows(
        "SELECT DISTINCT incident_id, game_id FROM incident_game_map ORDER BY 1, 2"
    ):
        incident_games[str(incident_id)].append(str(game_id))
    incidents: dict[str, Incident] = {}
    for r in rows(
        "SELECT incident_id, market_id, platform_version_id, incident_type,"
        " CAST(started_at AS DATE) FROM incidents ORDER BY 1"
    ):
        incident_id, market_id = str(r[0]), _text(r[1])
        affected = {games[game_id].market_id for game_id in incident_games[incident_id]}
        belongs = frozenset({market_id} if market_id is not None else affected)
        incidents[incident_id] = Incident(market_id, _text(r[2]), str(r[3]), _date(r[4]), belongs)
    platform_versions = {
        str(r[0]): Version(str(r[1]), (str(r[2]), str(r[3])))
        for r in rows(
            "SELECT v.platform_version_id, v.version_label, p.platform_name, p.platform_id"
            " FROM platform_versions v JOIN platforms p ON p.platform_id = v.platform_id"
            " ORDER BY 1"
        )
    }
    app_releases = {
        str(r[0]): Version(str(r[1]), (*markets[str(r[2])], str(r[2])))
        for r in rows(
            "SELECT app_version_id, version_label, market_id FROM app_versions ORDER BY 1"
        )
    }
    uses = tuple(
        MechanicUse(
            str(r[0]), str(r[1]), float(str(r[2])), _optional_date(r[3]), _optional_date(r[4])
        )
        for r in rows(
            "SELECT game_id, mechanic_id, importance_weight, valid_from, valid_to"
            " FROM game_mechanic_map ORDER BY 1, 2, 4"
        )
    )
    return World(
        markets=markets,
        games=games,
        incidents=incidents,
        platform_versions=platform_versions,
        app_releases=app_releases,
        incident_games={key: tuple(value) for key, value in incident_games.items()},
        mechanic_uses=uses,
        mechanic_markets=_pairs(rows("SELECT mechanic_id, market_id FROM game_mechanics")),
        family_markets=_pairs(rows("SELECT family_id, market_id FROM game_families")),
        segment_markets=_pairs(rows("SELECT segment_id, market_id FROM player_segments")),
        campaign_ends={
            str(r[0]): (str(r[1]), _date(r[2]))
            for r in rows(
                "SELECT campaign_id, campaign_name, CAST(end_at AS DATE) FROM campaigns"
                " WHERE end_at IS NOT NULL ORDER BY 1"
            )
        },
        case_incidents=_pairs(
            rows(
                "SELECT s.support_case_id, s.incident_id FROM support_cases s"
                " JOIN incidents i ON i.incident_id = s.incident_id"
                " WHERE i.platform_version_id IS NOT NULL ORDER BY 1"
            )
        ),
        names=local_name_variants(),
        ontology=ontology,
    )


@dataclass(frozen=True, slots=True)
class Draft:
    """One eligible anchor before sampling and carrier resolution."""

    anchor_id: str
    # What fills the template slot: the anchor id, or a local name (L13, L14).
    slot: str
    expected_answer: str
    checks: tuple[Check, ...]
    specs: tuple[ClaimSpec, ...]
    # Name-anchored drafts sharing a concept share an answer; grounding keeps
    # one anchor per concept and spreads the picks over languages. Both are
    # None for every other draft.
    concept: str | None = None
    language: str | None = None


Grounder = Callable[[World], list[Draft]]


# ---------------------------------------------------------------- H3 single facts


def ground_l01(world: World) -> list[Draft]:
    drafts = []
    for game_id, game in world.games.items():
        two_decimal, shortest = price_forms(game.price)
        statement = f"The ticket price of {game_id} is {two_decimal} {game.currency}."
        # The shortest form alone matches scores and version labels ("1.0" in
        # "2024.1.0"), so a carrier must state the two-decimal price and its currency.
        currency = tuple(dict.fromkeys((game.currency, UNIT_SYMBOLS[game.currency])))
        markers = ((game_id, game.name), (two_decimal,), currency)
        drafts.append(
            Draft(
                game_id,
                game_id,
                statement,
                (NumberCheck(shortest, game.currency),),
                (ClaimSpec("price", statement, (), markers),),
            )
        )
    return drafts


def ground_l02(world: World) -> list[Draft]:
    drafts = []
    for incident_id, incident in world.incidents.items():
        version = incident.platform_version_id
        if version is None:
            continue
        statement = f"Incident {incident_id} was seen on platform version {version}."
        spec = ClaimSpec("version", statement, (incident_id,), ((incident_id,), (version,)))
        drafts.append(
            Draft(
                incident_id,
                incident_id,
                statement,
                (version_check(world.platform_versions, version),),
                (spec,),
            )
        )
    return drafts


def version_check(versions: Mapping[str, Version], version_id: str) -> TokenCheck:
    """The check of an answer that is a version: its id, or its label beside
    what it belongs to (scorer 2.2.0, D-095)."""
    return TokenCheck(version_id, qualified=version_label_alias(versions, version_id))


def version_label_alias(
    versions: Mapping[str, Version], version_id: str
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """Scorer 2.2.0 (D-095): a version's label counts beside a name of what
    it belongs to (a platform's name or id, a market's name or id) when label
    and that name identify this one version in the world. Platforms and
    markets share labels ("2024.3.0", "5.3.1"), so the label alone never
    counts; a name with which the label still fits two versions is no
    qualifier, and with no qualifier left there is no alias.
    """
    fits = Counter(
        (version.label, name.casefold()) for version in versions.values() for name in version.owners
    )
    version = versions[version_id]
    qualifiers = tuple(
        name for name in version.owners if fits[(version.label, name.casefold())] == 1
    )
    return ((version.label, qualifiers),) if qualifiers else ()


def ground_l03(world: World) -> list[Draft]:
    drafts = []
    for campaign_id, (name, end) in world.campaign_ends.items():
        day = end.isoformat()
        statement = f"Campaign {campaign_id} ends on {day}."
        spec = ClaimSpec("end", statement, (), ((campaign_id, name), (day,)))
        drafts.append(Draft(campaign_id, campaign_id, statement, (TokenCheck(day),), (spec,)))
    return drafts


def ground_l04(world: World) -> list[Draft]:
    drafts = []
    for game_id, game in world.games.items():
        if game.digital:
            statement = f"Yes, game {game_id} is available on digital channels."
        else:
            statement = f"No, game {game_id} is not available on digital channels."
        # Record blocks never state the flag as a word, so only the record
        # carries it; that is the anchor, so L04 scores the answer alone.
        spec = ClaimSpec("digital", statement, (game_id,), ())
        check = VerdictCheck("yes" if game.digital else "no")
        drafts.append(Draft(game_id, game_id, statement, (check,), (spec,)))
    return drafts


# ---------------------------------------------------------------- H1 multi-hop


def ground_l05(world: World) -> list[Draft]:
    drafts = []
    for incident_id, incident in world.incidents.items():
        version = incident.platform_version_id
        if version is None or incident.market_id is None:
            continue
        others = [
            (other_id, sorted(found))
            for other_id, other in world.incidents.items()
            if other.platform_version_id == version and (found := _other_markets(incident, other))
        ]
        markets = sorted({market for _, found in others for market in found})
        if not MIN_SET <= len(markets) <= MAX_SET:
            continue
        answer = (
            f"Incidents on platform version {version}, the version of incident {incident_id},"
            f" were also seen in {render_list(markets)}."
        )
        specs = tuple(
            ClaimSpec(
                other_id,
                f"Incident {other_id} in {render_list(found)}"
                f" was seen on platform version {version}.",
                (other_id,),
                ((other_id,), (version,)),
            )
            for other_id, found in others
        )
        drafts.append(
            Draft(incident_id, incident_id, answer, (SetCheck.of(markets, world.markets),), specs)
        )
    return drafts


def ground_l06(world: World) -> list[Draft]:
    mechanic_universe = {m: world.names[("mechanic", m)] for m in world.mechanic_markets}
    drafts = []
    for incident_id, incident in world.incidents.items():
        game_ids = world.incident_games.get(incident_id, ())
        if not MIN_SET <= len(game_ids) <= MAX_L06_GAMES:
            continue
        uses = [
            use
            for game_id in game_ids
            for use in world.uses_of(game_id)
            if use.valid_on(incident.started_on)
        ]
        mechanics = sorted({use.mechanic_id for use in uses})
        if not MIN_SET <= len(mechanics) <= MAX_SET:
            continue
        answer = (
            f"The games affected by incident {incident_id} ({render_list(list(game_ids))})"
            f" use the mechanics {render_list(mechanics)}."
        )
        mechanic_specs = [
            ClaimSpec(
                f"{game_id}:{mechanic_id}",
                f"Game {game_id} uses mechanic {mechanic_id}.",
                (game_id,),
                (
                    (game_id, world.games[game_id].name),
                    (mechanic_id, world.name("mechanic", mechanic_id)),
                ),
            )
            for game_id, mechanic_id in sorted({(u.game_id, u.mechanic_id) for u in uses})
        ]
        game_specs = [
            ClaimSpec(
                f"{incident_id}:{game_id}",
                f"Incident {incident_id} affected game {game_id}.",
                (incident_id,),
                ((incident_id,), (game_id,)),
            )
            for game_id in game_ids
        ]
        check = SetCheck.of(mechanics, mechanic_universe)
        drafts.append(
            Draft(incident_id, incident_id, answer, (check,), (*mechanic_specs, *game_specs))
        )
    return drafts


def ground_l07(world: World) -> list[Draft]:
    drafts = []
    for case_id, incident_id in world.case_incidents.items():
        version = world.incidents[incident_id].platform_version_id
        if version is None:
            continue
        answer = (
            f"Support case {case_id} is linked to incident {incident_id},"
            f" which was seen on platform version {version}."
        )
        specs = (
            ClaimSpec(
                "case_incident",
                f"Support case {case_id} is linked to incident {incident_id}.",
                (case_id,),
                ((case_id,), (incident_id,)),
            ),
            ClaimSpec(
                "incident_version",
                f"Incident {incident_id} was seen on platform version {version}.",
                (incident_id,),
                ((incident_id,), (version,)),
            ),
        )
        check = version_check(world.platform_versions, version)
        drafts.append(Draft(case_id, case_id, answer, (check,), specs))
    return drafts


def ground_l08(world: World) -> list[Draft]:
    by_version: dict[str, list[str]] = defaultdict(list)
    for incident_id, incident in world.incidents.items():
        if incident.platform_version_id is not None:
            by_version[incident.platform_version_id].append(incident_id)
    drafts = []
    for version in sorted(by_version):
        pairs = [
            (incident_id, game_id)
            for incident_id in by_version[version]
            for game_id in world.incident_games.get(incident_id, ())
        ]
        games = sorted({game_id for _, game_id in pairs})
        if not MIN_SET <= len(games) <= MAX_SET:
            continue
        answer = f"Incidents on platform version {version} affected {render_list(games)}."
        specs = tuple(
            ClaimSpec(
                f"{incident_id}:{game_id}",
                f"Incident {incident_id} on platform version {version} affected game {game_id}.",
                (incident_id,),
                ((incident_id,), (game_id, world.games[game_id].name)),
            )
            for incident_id, game_id in pairs
        )
        check = SetCheck.of(games, world.game_universe())
        drafts.append(Draft(version, version, answer, (check,), specs))
    return drafts


# ---------------------------------------------------------------- H2 ontology-dependent


def ground_l09(world: World) -> list[Draft]:
    drafts = []
    for game_id, game in world.games.items():
        concept = world.concept("family", game.family_id)
        if concept is None:
            continue
        others = sorted(
            other_id
            for other_id, other in world.games.items()
            if other.market_id != game.market_id
            and world.concept("family", other.family_id) == concept
        )
        if not MIN_SET <= len(others) <= MAX_SET:
            continue
        answer = (
            f"The games in other markets whose family is the same kind as that of {game_id}"
            f" ({world.label(concept)}) are {render_list(others)}."
        )
        specs = tuple(_family_spec(world, other_id) for other_id in others)
        check = SetCheck.of(others, without(world.game_universe(), game_id))
        drafts.append(Draft(game_id, game_id, answer, (check,), specs))
    return drafts


def ground_l10(world: World) -> list[Draft]:
    universe: dict[str, tuple[str, ...]] = {incident_id: () for incident_id in world.incidents}
    drafts = []
    for incident_id, incident in world.incidents.items():
        concept = world.concept("incident_type", incident.incident_type)
        if concept is None or incident.market_id is None:
            continue
        others = sorted(
            other_id
            for other_id, other in world.incidents.items()
            if _other_markets(incident, other)
            and world.concept("incident_type", other.incident_type) == concept
        )
        if not MIN_SET <= len(others) <= MAX_SET:
            continue
        answer = (
            f"The incidents in other markets of the same kind as {incident_id}"
            f" ({world.label(concept)}) are {render_list(others)}."
        )
        specs = tuple(
            ClaimSpec(
                other_id,
                f"Incident {other_id} has incident type {world.incidents[other_id].incident_type}.",
                (other_id,),
                ((other_id,), (world.incidents[other_id].incident_type,)),
            )
            for other_id in others
        )
        drafts.append(
            Draft(
                incident_id,
                incident_id,
                answer,
                (SetCheck.of(others, without(universe, incident_id)),),
                specs,
            )
        )
    return drafts


def ground_l11(world: World) -> list[Draft]:
    universe = {s: world.names[("segment", s)] for s in world.segment_markets}
    drafts = []
    for segment_id, market_id in world.segment_markets.items():
        concept = world.concept("segment", segment_id)
        if concept is None:
            continue
        others = sorted(
            other_id
            for other_id, other_market in world.segment_markets.items()
            if other_market != market_id and world.concept("segment", other_id) == concept
        )
        markets = {world.segment_markets[other_id] for other_id in others}
        if not MIN_SET <= len(markets) <= MAX_L11_MARKETS:
            continue
        answer = (
            f"The segments in other markets that correspond to {segment_id}"
            f" ({world.label(concept)}) are {render_list(others)}."
        )
        specs = tuple(
            ClaimSpec(
                other_id,
                f"Segment {other_id} is a {world.label(concept)} segment.",
                (other_id,),
                (),
            )
            for other_id in others
        )
        drafts.append(
            Draft(
                segment_id,
                segment_id,
                answer,
                (SetCheck.of(others, without(universe, segment_id)),),
                specs,
            )
        )
    return drafts


def ground_l12(world: World) -> list[Draft]:
    drafts = []
    for game_id, game in world.games.items():
        uses = world.uses_of(game_id)
        if not uses:
            continue
        main = min(uses, key=lambda use: (-use.weight, use.mechanic_id)).mechanic_id
        concept = world.concept("mechanic", main)
        if concept is None:
            continue
        others = [
            other_id
            for other_id in _games_using(world, concept)
            if world.games[other_id].market_id != game.market_id
        ]
        if not MIN_SET <= len(others) <= MAX_SET:
            continue
        answer = (
            f"The games in other markets that use the same kind of mechanic as {game_id}'s"
            f" main mechanic {main} ({world.label(concept)}) are {render_list(others)}."
        )
        specs = tuple(_mechanic_spec(world, other_id, concept) for other_id in others)
        check = SetCheck.of(others, without(world.game_universe(), game_id))
        drafts.append(Draft(game_id, game_id, answer, (check,), specs))
    return drafts


def ground_l13(world: World) -> list[Draft]:
    drafts = []
    for family_id in sorted(world.family_markets):
        concept = world.concept("family", family_id)
        if concept is None:
            continue
        bound = {b.code for b in world.ontology.codes_for(concept, "family")}
        markets = {world.family_markets[code] for code in bound if code in world.family_markets}
        games = sorted(g for g, game in world.games.items() if game.family_id in bound)
        if len(markets) < MIN_L13_MARKETS or not MIN_NAMED_SET <= len(games) <= MAX_SET:
            continue
        name = world.name("family", family_id)
        answer = (
            f'The games in the kind of game family called "{name}" ({world.label(concept)})'
            f" are {render_list(games)}."
        )
        specs = tuple(_family_spec(world, game_id) for game_id in games)
        check = SetCheck.of(games, world.game_universe())
        language = MARKET_LANGUAGE[world.family_markets[family_id]]
        drafts.append(Draft(family_id, name, answer, (check,), specs, concept, language))
    return drafts


def ground_l14(world: World) -> list[Draft]:
    drafts = []
    for mechanic_id in sorted(world.mechanic_markets):
        concept = world.concept("mechanic", mechanic_id)
        if concept is None:
            continue
        games = _games_using(world, concept)
        if not MIN_NAMED_SET <= len(games) <= MAX_SET:
            continue
        description = world.names[("mechanic", mechanic_id)][-1]
        answer = (
            f'The games that use the kind of mechanic called "{description}"'
            f" ({world.label(concept)}) are {render_list(games)}."
        )
        specs = tuple(_mechanic_spec(world, game_id, concept) for game_id in games)
        check = SetCheck.of(games, world.game_universe())
        language = MARKET_LANGUAGE[world.mechanic_markets[mechanic_id]]
        drafts.append(Draft(mechanic_id, description, answer, (check,), specs, concept, language))
    return drafts


GROUNDERS: dict[str, Grounder] = {
    "L01": ground_l01,
    "L02": ground_l02,
    "L03": ground_l03,
    "L04": ground_l04,
    "L05": ground_l05,
    "L06": ground_l06,
    "L07": ground_l07,
    "L08": ground_l08,
    "L09": ground_l09,
    "L10": ground_l10,
    "L11": ground_l11,
    "L12": ground_l12,
    "L13": ground_l13,
    "L14": ground_l14,
}


# ---------------------------------------------------------------- shared helpers


def _other_markets(incident: Incident, other: Incident) -> frozenset[str]:
    """`other`'s markets besides `incident`'s.

    A corporate incident (no market of its own) counts in the markets of the
    games it affects. Anchors of the cross-market questions always have a market.
    """
    return other.markets - incident.markets


def _family_spec(world: World, game_id: str) -> ClaimSpec:
    family_id = world.games[game_id].family_id
    return ClaimSpec(
        game_id,
        f"Game {game_id} belongs to game family {family_id}.",
        (game_id,),
        ((game_id, world.games[game_id].name), (family_id, world.name("family", family_id))),
    )


def _bound_mechanics(world: World, concept: str) -> set[str]:
    return {b.code for b in world.ontology.codes_for(concept, "mechanic")}


def _games_using(world: World, concept: str) -> list[str]:
    """Games with any mechanic mapping bound to the concept, sorted."""
    bound = _bound_mechanics(world, concept)
    return sorted({use.game_id for use in world.mechanic_uses if use.mechanic_id in bound})


def _mechanic_spec(world: World, game_id: str, concept: str) -> ClaimSpec:
    bound = _bound_mechanics(world, concept)
    mechanics = sorted({u.mechanic_id for u in world.uses_of(game_id) if u.mechanic_id in bound})
    words = (*mechanics, *(world.name("mechanic", m) for m in mechanics))
    return ClaimSpec(
        game_id,
        f"Game {game_id} uses mechanic {render_list(mechanics)}.",
        (game_id,),
        ((game_id, world.games[game_id].name), words),
    )


def without(universe: Mapping[str, tuple[str, ...]], *keys: str) -> dict[str, tuple[str, ...]]:
    """The universe minus `keys`: ids an expected answer names besides its
    set (the anchor, a market it rules out) never count as predictions."""
    return {key: aliases for key, aliases in universe.items() if key not in keys}


def price_forms(price: Decimal) -> tuple[str, str]:
    """The two-decimal and the shortest written forms of a price ("2.50", "2.5")."""
    return f"{price:.2f}", format(price.normalize(), "f")


def render_list(items: Sequence[str]) -> str:
    """'A', 'A and B', 'A, B and C'."""
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _pairs(rows: Iterable[tuple[object, ...]]) -> dict[str, str]:
    return {str(key): str(value) for key, value in sorted(rows, key=lambda r: str(r[0]))}


def _decimal(value: object) -> Decimal:
    if not isinstance(value, Decimal):
        raise TypeError(f"expected a decimal, got {value!r}")
    return value


def _date(value: object) -> date:
    if not isinstance(value, date):
        raise TypeError(f"expected a date, got {value!r}")
    return value


def _optional_date(value: object) -> date | None:
    return None if value is None else _date(value)


def _text(value: object) -> str | None:
    return None if value is None else str(value)
