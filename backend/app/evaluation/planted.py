"""Planted grounders: one function per planted-pattern question (H5).

Each grounder reads one scenario of the evaluator truth ledger and returns
the single :class:`Draft` of that world: the anchor and the answer come from
the ledger truth, never from searching the world. The world snapshot supplies
only what the truth names by id (an incident's market, a game's currency) and
the answer universes. Claims are the scenario's required evidence.

Evaluator-only (ADR-008): retrieval code never imports this module.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from decimal import Decimal

import duckdb

from app.evaluation.checks import Check, NumberCheck, SetCheck, TokenCheck, normalise
from app.evaluation.claims import ClaimSpec
from app.evaluation.grounders import Draft, World, price_forms, render_list, without
from app.evaluation.truth_ledger import TruthScenario

PlantedGrounder = Callable[[TruthScenario, World, duckdb.DuckDBPyConnection], Draft]

# A device or payment instrument counts as shared when this many players use it.
MIN_SHARING_PLAYERS = 2

# Required-evidence items naming a KPI series ("kpi:MKT_GR:session_completion")
# have no record or chunk to carry them, so they make no claim.
KPI_EVIDENCE_PREFIX = "kpi:"


def ground_l15(scenario: TruthScenario, world: World, _: duckdb.DuckDBPyConnection) -> Draft:
    incident = _text(scenario, "incident_id")
    release = _text(scenario, "app_version_id")
    answer = f"Incident {incident} was caused by app release {release}."
    return _draft(scenario, world, incident, answer, (TokenCheck(release),))


def ground_l16(
    scenario: TruthScenario, world: World, connection: duckdb.DuckDBPyConnection
) -> Draft:
    return _cluster(
        scenario, world, connection, "player_device", "device_id", "shared_devices", "device"
    )


def ground_l17(
    scenario: TruthScenario, world: World, connection: duckdb.DuckDBPyConnection
) -> Draft:
    return _cluster(
        scenario,
        world,
        connection,
        "player_payment_method",
        "payment_method_id",
        "shared_instruments",
        "payment instrument",
    )


def ground_l18(scenario: TruthScenario, world: World, _: duckdb.DuckDBPyConnection) -> Draft:
    primary = _text(scenario, "primary_market")
    planted = sorted(_texts(scenario, "planted_ids", "incidents"))
    anchor = next(
        (i for i in planted if i in world.incidents and world.incidents[i].market_id == primary),
        None,
    )
    if anchor is None:
        raise ValueError(f"{scenario.scenario_id} plants no incident in {primary}")
    related = sorted(_texts(scenario, "related_markets"))
    unaffected = _texts(scenario, "unaffected_markets")[0]
    answer = (
        f"Incidents on the same platform version as {anchor} were seen in"
        f" {render_list(related)}, and {unaffected} was unaffected."
    )
    checks = (
        SetCheck.of(related, without(world.markets, primary, unaffected)),
        TokenCheck(unaffected, _aliases(world.markets, unaffected)),
    )
    return _draft(scenario, world, anchor, answer, checks)


def ground_l19(scenario: TruthScenario, world: World, _: duckdb.DuckDBPyConnection) -> Draft:
    anchor = sorted(_texts(scenario, "planted_ids", "support_cases"))[0]
    provider = _text(scenario, "provider_id")
    markets = sorted(_texts(scenario, "affected_markets"))
    answer = (
        f"Support case {anchor} traces to payment provider {provider},"
        f" which affects {render_list(markets)}."
    )
    checks = (TokenCheck(provider), SetCheck.of(markets, world.markets))
    return _draft(scenario, world, anchor, answer, checks)


def ground_l20(scenario: TruthScenario, world: World, _: duckdb.DuckDBPyConnection) -> Draft:
    control = _text(scenario, "control_market")
    per_market = _value(scenario, "per_market")
    if not isinstance(per_market, Mapping):
        raise ValueError(f"{scenario.scenario_id} truth per_market is not a mapping")
    games = sorted(
        _text(scenario, "per_market", str(market), "game_id")
        for market in per_market
        if market != control
    )
    if len(games) < 2:
        raise ValueError(f"{scenario.scenario_id} plants fewer than two games")
    anchor, others = games[0], games[1:]
    answer = (
        f"The games in other markets with the same mechanic affinity as {anchor}"
        f" are {render_list(others)}."
    )
    check = SetCheck.of(others, without(world.game_universe(), anchor))
    return _draft(scenario, world, anchor, answer, (check,))


def ground_l21(scenario: TruthScenario, world: World, _: duckdb.DuckDBPyConnection) -> Draft:
    campaign = _text(scenario, "source_campaign_id")
    target = _text(scenario, "target_game_id")
    answer = f"The best transfer target for campaign {campaign} is game {target}."
    check = TokenCheck(target, _aliases(world.game_universe(), target))
    return _draft(scenario, world, campaign, answer, (check,))


def ground_l22(scenario: TruthScenario, world: World, _: duckdb.DuckDBPyConnection) -> Draft:
    if not scenario.affected_games:
        raise ValueError(f"{scenario.scenario_id} affects no game")
    game_id = scenario.affected_games[0]
    if game_id not in world.games:
        raise ValueError(f"{scenario.scenario_id} names game {game_id}, absent from the world")
    currency = world.games[game_id].currency
    price, shortest = price_forms(Decimal(normalise(_number(scenario, "authoritative_price"))))
    document = _text(scenario, "conflicting_document")
    # The stale price is not quoted: a second number would halve the number check.
    answer = (
        f"The current ticket price of {game_id} is {price} {currency};"
        f" rules document {document}, which states a different price, is superseded."
    )
    return _draft(scenario, world, game_id, answer, (NumberCheck(shortest, currency),))


PLANTED_GROUNDERS: dict[str, PlantedGrounder] = {
    "L15": ground_l15,
    "L16": ground_l16,
    "L17": ground_l17,
    "L18": ground_l18,
    "L19": ground_l19,
    "L20": ground_l20,
    "L21": ground_l21,
    "L22": ground_l22,
}


# ---------------------------------------------------------------- shared helpers


def _draft(
    scenario: TruthScenario, world: World, anchor: str, answer: str, checks: tuple[Check, ...]
) -> Draft:
    return Draft(anchor, anchor, answer, checks, evidence_specs(scenario, world, anchor))


def evidence_specs(scenario: TruthScenario, world: World, anchor: str) -> tuple[ClaimSpec, ...]:
    """One claim per required-evidence item besides the anchor and KPI series.

    A document is carried by its chunks and a game by its own record only
    (dozens of records name a game, so its id alone states nothing about the
    pattern); any other item by its own record and every record or chunk
    that names it.
    """
    specs = []
    for item in scenario.required_evidence:
        if item == anchor or item.startswith(KPI_EVIDENCE_PREFIX):
            continue
        statement = f"{item} is evidence of the planted pattern."
        if item.startswith("DOC_"):
            specs.append(ClaimSpec(item, statement, (), (), (item,)))
        elif item in world.games:
            specs.append(ClaimSpec(item, statement, (item,), ()))
        else:
            specs.append(ClaimSpec(item, statement, (item,), ((item,),)))
    return tuple(specs)


def _cluster(
    scenario: TruthScenario,
    world: World,
    connection: duckdb.DuckDBPyConnection,
    table: str,
    column: str,
    shared_key: str,
    shared_kind: str,
) -> Draft:
    """A cluster question: the anchor is the first cluster player by id.

    The shared items come from the ledger and their links from the world
    tables. The expected set is every other player linked to a shared item
    the anchor uses (the planted cluster plus any baseline user), so the
    answer is literally true. The universe is every player, minus the
    anchor, linked to any item that two or more players share anywhere in
    the world: the distractors a careless retriever is likely to name.
    """
    anchor = sorted(_texts(scenario, "cluster_players"))[0]
    shared = _texts(scenario, shared_key)
    placeholders = ", ".join("?" for _ in shared)
    links = [
        (str(player), str(item))
        for player, item in connection.execute(
            f"SELECT DISTINCT player_id, {column} FROM {table} WHERE {column} IN ({placeholders})",
            shared,
        ).fetchall()
    ]
    used = {item for player, item in links if player == anchor}
    if not used:
        raise ValueError(f"{scenario.scenario_id} anchor {anchor} uses no shared {shared_kind}")
    expected = sorted({player for player, item in links if item in used} - {anchor})
    sharing = connection.execute(
        f"SELECT DISTINCT player_id FROM {table} WHERE {column} IN"
        f" (SELECT {column} FROM {table} GROUP BY {column}"
        " HAVING COUNT(DISTINCT player_id) >= ?) ORDER BY player_id",
        [MIN_SHARING_PLAYERS],
    ).fetchall()
    universe = {str(row[0]): () for row in sharing if str(row[0]) != anchor}
    answer = f"Player {anchor} shares a {shared_kind} with {render_list(expected)}."
    return _draft(scenario, world, anchor, answer, (SetCheck.of(expected, universe),))


def _aliases(universe: Mapping[str, Sequence[str]], key: str) -> tuple[str, ...]:
    return tuple(universe.get(key, ()))


def _value(scenario: TruthScenario, *path: str) -> object:
    value: object = scenario.truth
    for key in path:
        if not isinstance(value, Mapping) or key not in value:
            raise ValueError(f"{scenario.scenario_id} truth has no {'.'.join(path)}")
        value = value[key]
    return value


def _text(scenario: TruthScenario, *path: str) -> str:
    value = _value(scenario, *path)
    if not isinstance(value, str):
        raise ValueError(f"{scenario.scenario_id} truth {'.'.join(path)} is not text")
    return value


def _texts(scenario: TruthScenario, *path: str) -> list[str]:
    value = _value(scenario, *path)
    if not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value):
        raise ValueError(f"{scenario.scenario_id} truth {'.'.join(path)} is not a list of ids")
    return [str(v) for v in value]


def _number(scenario: TruthScenario, *path: str) -> int | float:
    value = _value(scenario, *path)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{scenario.scenario_id} truth {'.'.join(path)} is not a number")
    return value
