"""Deterministic grounding of the benchmark bank into one generated world.

Grounding turns each logical question into a concrete question text plus
expected answer checks and required evidence ids, computed from the
generated parquet world and (for planted scenarios) the truth ledger.
Everything in this module is evaluator-only (ADR-008): retrieval code never
imports it.

Rules are deliberately boring and fully deterministic:

- Selected entities are resolved by documented conventions (family +
  market + lowest id, or ledger truth for planted scenarios) and validated
  against the world; a missing anchor raises ``GroundingError``.
- Base questions anchor to ``REPORTING_DATE``; scenario questions anchor to
  their scenario's planted window.
- Questions whose home scenario is not planted in this world ground to
  ``NOT_PLANTED``: reported, never scored.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb

from app.evaluation.bank import BankQuestion
from app.evaluation.truth_ledger import TruthScenario, load_ledger
from app.graph.mapping import DIGITAL_PLATFORMS, RETAIL_PLATFORMS

# Reporting anchor for base-world questions (mid-world, documented).
REPORTING_DATE = date(2025, 6, 30)


# Primary-key column per world table (docs/01 naming: <entity>_id).
KEY_COLUMNS: dict[str, str] = {
    "incidents": "incident_id",
    "documents": "document_id",
    "games": "game_id",
    "players": "player_id",
}


class GroundingError(RuntimeError):
    """A question's anchor is missing from the world; fail loudly."""


# Expected-answer checks (docs/05 section 8: deterministic evaluation).
# ("number", "2.5") passes when the number appears in the answer text;
# ("token", "INC_009") passes on a case-insensitive word match; ("set", ...)
# scores |found| / |expected|.
Check = tuple[str, str | frozenset[str]]


@dataclass(frozen=True, slots=True)
class GroundedQuestion:
    """One benchmark question grounded into a concrete world."""

    question: BankQuestion
    text: str
    checks: tuple[Check, ...]
    required_evidence: tuple[str, ...]
    required_concepts: tuple[str, ...] = ()
    status: str = "ok"  # ok | not_planted | not_grounded
    note: str = ""


@dataclass(slots=True)
class WorldGrounding:
    """Grounds the bank against one generated world + truth ledger."""

    world_dir: Path
    ledger_path: Path | None = None
    _con: duckdb.DuckDBPyConnection = field(init=False, repr=False)
    _ledger_scenarios: dict[str, TruthScenario] = field(init=False, repr=False)
    _selections: dict[str, object] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        self._con = duckdb.connect()
        self._ledger_scenarios = {
            scenario.scenario_id: scenario for scenario in load_ledger(self.ledger_path).scenarios
        }

    # -- plumbing ---------------------------------------------------------

    def q(self, sql: str) -> list[tuple[object, ...]]:
        table = sql.format(world=self._world)
        return self._con.execute(table).fetchall()

    def q1(self, sql: str) -> object:
        rows = self.q(sql)
        if not rows:
            raise GroundingError(f"query returned no rows: {sql[:90]}")
        return rows[0][0]

    @property
    def _world(self) -> str:
        return f"{self.world_dir.as_posix().rstrip('/')}/"

    def _scenario(self, scenario_id: str) -> TruthScenario:
        scenario = self._ledger_scenarios.get(scenario_id)
        if scenario is None or not scenario.enabled:
            raise GroundingError(f"scenario {scenario_id} is not planted in this world")
        return scenario

    def _require_world_record(self, table: str, record_id: str) -> None:
        column = KEY_COLUMNS.get(table)
        if column is None:
            raise GroundingError(f"no key column known for table {table}")
        rows = self.q(
            f"SELECT count(*) FROM '{{world}}{table}.parquet' WHERE {column} = '{record_id}'"
        )
        if not rows or int(str(rows[0][0])) == 0:
            raise GroundingError(f"{table} record {record_id} is not present in this world")

    def close(self) -> None:
        self._con.close()

    # -- selections (documented deterministic conventions) ----------------

    def _sel(self, key: str) -> object:
        if key not in self._selections:
            self._selections[key] = getattr(self, f"_select_{key}")()
        return self._selections[key]

    def _select_uk_flagship(self) -> str:
        return str(
            self.q1(
                "SELECT min(game_id) FROM '{world}games.parquet' "
                "WHERE market_id = 'MKT_UK' AND game_family_id = 'FAM_UK_NATIONAL_DRAW'"
            )
        )

    def _select_uk_annuity(self) -> str:
        return str(
            self.q1(
                "SELECT min(game_id) FROM '{world}games.parquet' "
                "WHERE market_id = 'MKT_UK' AND game_family_id = 'FAM_UK_ANNUITY'"
            )
        )

    def _select_gr_high_frequency(self) -> str:
        return str(
            self.q1(
                "SELECT min(game_id) FROM '{world}games.parquet' "
                "WHERE market_id = 'MKT_GR' AND game_family_id = 'FAM_GR_SYCHNES_KLIROSEIS'"
            )
        )

    def _select_at_digital(self) -> str:
        return str(
            self.q1(
                "SELECT min(game_id) FROM '{world}games.parquet' "
                "WHERE market_id = 'MKT_AT' AND digital_enabled"
            )
        )

    def _select_at_campaign_game(self) -> str:
        return str(
            self.q1(
                "SELECT g.game_id FROM '{world}games.parquet' g "
                "JOIN '{world}campaign_game_map.parquet' m ON m.game_id = g.game_id "
                "WHERE g.market_id = 'MKT_AT' "
                "GROUP BY g.game_id ORDER BY count(*) DESC, g.game_id LIMIT 1"
            )
        )

    def _select_cz_selected(self) -> str:
        try:
            scenario = self._scenario("SCN-002")
            return str(scenario.affected_games[0])
        except GroundingError:
            return str(
                self.q1(
                    "SELECT min(game_id) FROM '{world}games.parquet' WHERE market_id = 'MKT_CZ'"
                )
            )

    def _planted_incident_ids(self) -> list[str]:
        return sorted(
            {
                str(incident_id)
                for scenario in self._ledger_scenarios.values()
                for incident_id in scenario.truth.get("planted_ids", {}).get("incidents", [])
            }
        )

    def _select_uk_incident(self) -> str:
        planted = self._planted_incident_ids()
        return str(
            self.q1(
                "SELECT incident_id FROM '{world}incidents.parquet' "
                "WHERE market_id = 'MKT_UK' AND platform_id IS NOT NULL "
                f"AND incident_id NOT IN ({_in(planted) if planted else "''"}) "
                "ORDER BY started_at, incident_id LIMIT 1"
            )
        )

    def _select_scn7(self) -> TruthScenario:
        return self._scenario("SCN-007")

    def _select_gr_incident(self) -> str:
        scenario = self._select_scn7()
        incidents = scenario.truth["planted_ids"]["incidents"]
        if not incidents:
            raise GroundingError("SCN-007 has no planted incident in its primary market")
        return str(incidents[0])

    def _game_platforms(self, game_id: str) -> list[str]:
        rows = self.q(
            "SELECT digital_enabled, retail_enabled FROM '{world}games.parquet' "
            f"WHERE game_id = '{game_id}'"
        )
        digital, retail = bool(rows[0][0]), bool(rows[0][1])
        platforms = [*DIGITAL_PLATFORMS] if digital else []
        if retail:
            platforms.extend(RETAIL_PLATFORMS)
        return sorted(set(platforms))

    # -- grounding --------------------------------------------------------

    def ground(self, question: BankQuestion) -> GroundedQuestion:
        if question.scenario_id is not None and question.scenario_id not in self._ledger_scenarios:
            return GroundedQuestion(
                question,
                _unresolved_text(question.template),
                (),
                (),
                status="not_planted",
                note=f"scenario {question.scenario_id} is not planted in this world",
            )
        try:
            grounder = getattr(self, f"_ground_{question.question_id.lower()}")
        except AttributeError:
            return GroundedQuestion(
                question,
                _unresolved_text(question.template),
                (),
                (),
                status="not_grounded",
                note=(
                    f"bank 1.0 has no grounding rule for {question.question_id}; "
                    "replaced by bank 2.0.0 in Phase 3"
                ),
            )
        try:
            grounded: GroundedQuestion = grounder(question)
            return grounded
        except GroundingError as error:
            return GroundedQuestion(
                question,
                _unresolved_text(question.template),
                (),
                (),
                status="not_grounded",
                note=str(error),
            )

    def _ground_q01(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("uk_flagship"))
        price = self.q1(
            f"SELECT ticket_price FROM '{{world}}games.parquet' WHERE game_id = '{game}'"
        )
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("number", _num(price)),),
            (game,),
        )

    def _ground_q02(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("gr_high_frequency"))
        channels = self._game_channels(game)
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(channels)),),
            (game,),
        )

    def _game_channels(self, game_id: str) -> list[str]:
        rows = self.q(
            "SELECT digital_enabled, retail_enabled FROM '{world}games.parquet' "
            f"WHERE game_id = '{game_id}'"
        )
        channels = ["APP", "WEB"] if rows[0][0] else []
        if rows[0][1]:
            channels.append("RETAIL")
        return channels

    def _ground_q03(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("at_digital"))
        platforms = self._game_platforms(game)
        # One current version per platform: the latest released among those
        # active at the reporting date (generated worlds overlap versions).
        versions = sorted(
            str(row[0])
            for row in self.q(
                "SELECT arg_max(v.platform_version_id, v.released_at) AS current_id "
                "FROM '{world}platform_versions.parquet' v "
                f"WHERE v.platform_id IN ({_in(platforms)}) "
                f"AND v.released_at <= '{REPORTING_DATE}' "
                f"AND (v.retired_at IS NULL OR v.retired_at > '{REPORTING_DATE}') "
                "GROUP BY v.platform_id"
            )
        )
        if not versions:
            raise GroundingError(f"no active platform version for {game} at {REPORTING_DATE}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})", target_date=REPORTING_DATE.isoformat()),
            (("set", frozenset(versions)),),
            (game, *versions),
        )

    def _ground_q04(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("cz_selected"))
        rows = self.q(
            "SELECT date_trunc('week', opened_at) AS week, count(*) AS cases "
            f"FROM '{{world}}support_cases.parquet' WHERE game_id = '{game}' "
            "GROUP BY week ORDER BY cases DESC, week LIMIT 1"
        )
        if not rows:
            raise GroundingError(f"no support cases for {game}")
        week_start, count = rows[0]
        cases = int(str(count))
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})", week_start=str(week_start)[:10]),
            (("number", str(cases)),),
            (game,),
        )

    def _ground_q05(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("uk_annuity"))
        mechanics = self._mechanics(game)
        if not mechanics:
            raise GroundingError(f"no mechanics recorded for {game}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (),
            (game,),
            note="answer graded on evidence only; mechanics recorded for analysis",
        )

    def _mechanics(self, game_id: str) -> list[str]:
        return [
            str(row[0])
            for row in self.q(
                "SELECT mechanic_id FROM '{world}game_mechanic_map.parquet' "
                f"WHERE game_id = '{game_id}'"
            )
        ]

    def _ground_q06(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("gr_high_frequency"))
        # "Support documents relevant to checkout problems": support
        # summaries discussing payment incidents in the game's market.
        payment_incidents = [
            str(row[0])
            for row in self.q(
                "SELECT incident_id FROM '{world}incidents.parquet' "
                "WHERE market_id = 'MKT_GR' AND incident_type = 'ITYPE_GR_PLIROMES'"
            )
        ]
        docs: list[str] = []
        for incident in payment_incidents:
            docs.extend(
                str(row[0])
                for row in self.q(
                    "SELECT document_id FROM '{world}documents.parquet' "
                    "WHERE market_id = 'MKT_GR' AND document_type = 'SUPPORT_SUMMARY' "
                    f"AND body ILIKE '%{incident}%'"
                )
            )
        docs = sorted(set(docs))
        if not docs:
            raise GroundingError("no GR support documents discuss payment incidents")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(docs)),),
            tuple(docs),
        )

    def _docs_any(self, market: str, doc_type: str, needles: tuple[str, ...]) -> list[str]:
        clauses = " OR ".join(
            f"(title ILIKE '%{needle}%' OR body ILIKE '%{needle}%')" for needle in needles
        )
        return [
            str(row[0])
            for row in self.q(
                "SELECT document_id FROM '{world}documents.parquet' "
                f"WHERE market_id = '{market}' AND document_type = '{doc_type}' "
                f"AND ({clauses})"
            )
        ]

    def _ground_q07(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("at_digital"))
        docs = self._docs_any("MKT_AT", "RELEASE_NOTE", ("mobile", "app"))
        if not docs:
            raise GroundingError("no AT release notes mentioning mobile or app flows")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(docs)),),
            tuple(docs),
        )

    def _ground_q08(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("cz_selected"))
        experiment = self.q1(
            "SELECT min(experiment_id) FROM '{world}experiments.parquet' WHERE market_id = 'MKT_CZ'"
        )
        docs = [
            str(row[0])
            for row in self.q(
                "SELECT document_id FROM '{world}documents.parquet' "
                f"WHERE title ILIKE '%{experiment}%' OR body ILIKE '%{experiment}%'"
            )
        ]
        if not docs:
            raise GroundingError(f"no documents reference experiment {experiment}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(docs)),),
            tuple(docs),
        )

    def _ground_q09(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("uk_flagship"))
        segment = self.q1(
            "SELECT p.value_segment FROM '{world}tickets.parquet' t "
            "JOIN '{world}players.parquet' p ON p.player_id = t.player_id "
            f"WHERE t.game_id = '{game}' "
            "GROUP BY p.value_segment ORDER BY count(*) DESC, p.value_segment LIMIT 1"
        )
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("token", str(segment)),),
            (game,),
        )

    def _ground_q10(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("gr_high_frequency"))
        platforms = self._game_platforms(game)
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(platforms)),),
            (game, *platforms),
        )

    def _ground_q11(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("at_campaign_game"))
        campaigns = [
            str(row[0])
            for row in self.q(
                "SELECT campaign_id FROM '{world}campaign_game_map.parquet' "
                f"WHERE game_id = '{game}'"
            )
        ]
        if not campaigns:
            raise GroundingError(f"no campaigns target {game}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(campaigns)),),
            (game, *campaigns),
        )

    def _ground_q12(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("cz_selected"))
        platforms = self._game_platforms(game)
        incidents = self._incidents_on(platforms)
        if not incidents:
            raise GroundingError(f"no incidents on platforms of {game}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({', '.join(platforms)})"),
            (("set", frozenset(incidents)),),
            tuple(incidents),
        )

    def _incidents_on(self, platforms: list[str]) -> list[str]:
        return [
            str(row[0])
            for row in self.q(
                "SELECT incident_id FROM '{world}incidents.parquet' "
                f"WHERE platform_id IN ({_in(platforms)}) ORDER BY incident_id"
            )
        ]

    def _ground_q13(self, question: BankQuestion) -> GroundedQuestion:
        incident = str(self._sel("uk_incident"))
        platform = str(
            self.q1(
                "SELECT platform_id FROM '{world}incidents.parquet' "
                f"WHERE incident_id = '{incident}'"
            )
        )
        games = self._games_on_platform(platform)
        games.discard(incident)
        if not games:
            raise GroundingError(f"no games run on {platform}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({incident})"),
            (("set", frozenset(games)),),
            (incident, *sorted(games)),
        )

    def _games_on_platform(self, platform: str) -> set[str]:
        """Games whose channel mix includes the platform (graph mapping rule).

        Mirrors ``app.graph.mapping``: digital channels imply the digital
        platform set, retail implies the retail set, and PLT_DRAW belongs to
        both. Built from the mapping constants so the two can never diverge.
        """
        branches: list[str] = []
        for platform_id in DIGITAL_PLATFORMS:
            condition = (
                "digital_enabled OR retail_enabled"
                if platform_id == "PLT_DRAW"
                else "digital_enabled"
            )
            branches.append(
                f"SELECT game_id, '{platform_id}' AS platform_match "
                f"FROM '{{world}}games.parquet' WHERE {condition}"
            )
        for platform_id in RETAIL_PLATFORMS:
            if platform_id == "PLT_DRAW":
                continue
            branches.append(
                f"SELECT game_id, '{platform_id}' AS platform_match "
                f"FROM '{{world}}games.parquet' WHERE retail_enabled"
            )
        sql = (
            "SELECT DISTINCT game_id FROM ("
            + " UNION ALL ".join(branches)
            + f") WHERE platform_match = '{platform}'"
        )
        return {str(row[0]) for row in self.q(sql)}

    def _ground_q15(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("at_campaign_game"))
        campaigns = [
            str(row[0])
            for row in self.q(
                "SELECT campaign_id FROM '{world}campaign_game_map.parquet' "
                f"WHERE game_id = '{game}'"
            )
        ]
        games = [
            str(row[0])
            for row in self.q(
                "SELECT game_id FROM '{world}campaign_game_map.parquet' "
                f"WHERE campaign_id IN ({_in(campaigns)}) AND game_id <> '{game}'"
            )
        ]
        mechanic_sets = [set(self._mechanics(other)) for other in games]
        shared = set.intersection(*mechanic_sets) if mechanic_sets else set()
        if not shared:
            raise GroundingError(f"no mechanics shared across campaign games of {game}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(shared)),),
            (game, *games),
        )

    def _ground_q16(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("cz_selected"))
        incidents = sorted(self._game_incidents(game))
        if not incidents:
            raise GroundingError(f"no incidents affect {game}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(incidents)),),
            (game, *incidents),
            note=(
                "graded on the incidents behind the support cases; individual "
                "case ids sit below the traversal fan-out cut"
            ),
        )

    def _ground_q18(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("at_digital"))
        platforms = self._game_platforms(game)
        others = self._games_on_platforms(platforms) - {game}
        incidents = set(self._incidents_on(platforms))
        affected = {other for other in others if self._game_incidents(other) & incidents}
        if not affected:
            raise GroundingError(f"no other products share incident-linked platforms with {game}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(affected)),),
            (game, *sorted(affected)),
        )

    def _games_on_platforms(self, platforms: list[str]) -> set[str]:
        games: set[str] = set()
        for platform in platforms:
            games |= self._games_on_platform(platform)
        return games

    def _game_incidents(self, game_id: str) -> set[str]:
        return {
            str(row[0])
            for row in self.q(
                "SELECT incident_id FROM '{world}incident_game_map.parquet' "
                f"WHERE game_id = '{game_id}'"
            )
        }

    def _ground_q21(self, question: BankQuestion) -> GroundedQuestion:
        scenario = self._select_scn7()
        incident = str(self._sel("gr_incident"))
        planted = [str(i) for i in scenario.truth["planted_ids"]["incidents"]]
        for record in planted:
            self._require_world_record("incidents", record)
        first_support = self.q1(
            "SELECT min(opened_at) FROM '{world}support_cases.parquet' "
            f"WHERE incident_id IN ({_in(planted)})"
        )
        start = datetime.fromisoformat(str(scenario.start_date))
        if not isinstance(first_support, datetime) or first_support > start + timedelta(days=1):
            raise GroundingError("support signal does not precede KPI reporting")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({incident})"),
            (("token", "yes"),),
            tuple(sorted(planted)),
        )

    def _ground_q25(self, question: BankQuestion) -> GroundedQuestion:
        scenario = self._select_scn7()
        incident = str(self._sel("gr_incident"))
        planted_ids = scenario.truth["planted_ids"]
        siblings = sorted(str(i) for i in planted_ids["incidents"] if str(i) != incident)
        for record in siblings:
            self._require_world_record("incidents", record)
        evidence = [
            str(incident),
            str(scenario.truth["root_cause_entity"]),
            *(str(i) for i in planted_ids.get("documents", [])),
        ]
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({incident})"),
            (("set", frozenset(siblings)),),
            tuple(evidence) or tuple(siblings),
        )

    def _ground_q26(self, question: BankQuestion) -> GroundedQuestion:
        flagship = str(self._sel("uk_flagship"))
        winner = self._most_similar("MKT_AT", flagship)
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({flagship})"),
            (("token", winner),),
            (flagship, winner),
            required_concepts=("CONCEPT_NATIONAL_DRAW",),
        )

    def _ground_q27(self, question: BankQuestion) -> GroundedQuestion:
        game = str(self._sel("gr_high_frequency"))
        family = str(
            self.q1(f"SELECT game_family_id FROM '{{world}}games.parquet' WHERE game_id = '{game}'")
        )
        comparable = [
            str(row[0])
            for row in self.q(
                "SELECT game_id FROM '{world}games.parquet' "
                f"WHERE market_id = 'MKT_CZ' AND game_family_id = '{family}' "
                "ORDER BY game_id"
            )
        ]
        if not comparable:
            raise GroundingError(f"no CZ game shares family {family} with {game}")
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({game})"),
            (("set", frozenset(comparable)),),
            (game, *comparable),
            required_concepts=("CONCEPT_HIGH_FREQUENCY_GAME",),
        )

    def _ground_q28(self, question: BankQuestion) -> GroundedQuestion:
        players: set[str] = set()
        for scenario_id in ("SCN-002", "SCN-003"):
            scenario = self._scenario(scenario_id)
            cluster = [str(p) for p in scenario.truth["cluster_players"]]
            for player in cluster:
                self._require_world_record("players", player)
            players.update(cluster)
        if not players:
            raise GroundingError("no cluster players recorded")
        # The question anchors on one case account per planted cluster
        # (the tickets an analyst would have open). Only the trigger
        # accounts are revealed; cluster membership stays evaluator-only,
        # mirroring the trace questions that anchor the SCN-007 incident.
        anchors = sorted(
            str(self._scenario(sid).truth["cluster_players"][0]) for sid in ("SCN-002", "SCN-003")
        )
        for player in anchors:
            self._require_world_record("players", player)
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({', '.join(anchors)})"),
            (("set", frozenset(players)),),
            tuple(sorted(players)),
            note=(
                "cluster accounts via shared devices (SCN-002) and payment "
                f"instruments (SCN-003); anchored on trigger accounts {anchors}"
            ),
        )

    def _ground_q30(self, question: BankQuestion) -> GroundedQuestion:
        scenario = self._scenario("SCN-015")
        price = _num(scenario.truth["authoritative_price"])
        document = str(scenario.truth["conflicting_document"])
        # Truth stores namespaced source ids (warehouse:games:<game_id>);
        # answers and graph evidence use the bare record id.
        source = str(scenario.truth["authoritative_source"]).split(":")[-1]
        self._require_world_record("games", source)
        self._require_world_record("documents", document)
        return GroundedQuestion(
            question,
            question.template.format(anchor=f"({source})"),
            (("number", price), ("token", source)),
            tuple(scenario.required_evidence) or (source, document),
        )

    # -- structural similarity (graph mapping rule, evaluator-side) -------

    def _most_similar(self, market: str, target: str) -> str:
        rows = self.q(
            "SELECT g.game_id, g.game_family_id, g.game_category_code, m.mechanic_id "
            f"FROM '{{world}}games.parquet' g LEFT JOIN '{{world}}game_mechanic_map.parquet' m "
            "ON m.game_id = g.game_id "
            f"WHERE g.market_id = '{market}' AND g.game_id <> '{target}'"
        )
        target_family = str(
            self.q1(
                f"SELECT game_family_id FROM '{{world}}games.parquet' WHERE game_id = '{target}'"
            )
        )
        target_category = str(
            self.q1(
                "SELECT game_category_code FROM '{world}games.parquet' "
                f"WHERE game_id = '{target}'"
            )
        )
        target_mechanics = set(self._mechanics(target))
        games: dict[str, tuple[str, str, set[str]]] = {}
        for game_id, family, category, mechanic in rows:
            entry = games.setdefault(str(game_id), (str(family), str(category), set()))
            if mechanic is not None:
                entry[2].add(str(mechanic))
        best_id, best_score = "", -1.0
        for game_id, (family, category, mechanics) in sorted(games.items()):
            union = target_mechanics | mechanics
            mechanic_score = len(target_mechanics & mechanics) / len(union) if union else 0.0
            score = (
                0.4 * (family == target_family)
                + 0.2 * (category == target_category)
                + 0.4 * mechanic_score
            )
            if score > best_score:
                best_id, best_score = game_id, score
        if not best_id:
            raise GroundingError(f"no {market} games to compare against {target}")
        return best_id


def _unresolved_text(template: str) -> str:
    """Render a template with every placeholder unresolved (ungrounded questions)."""
    return template.format_map(defaultdict(lambda: "the selected record"))


def _num(value: object) -> str:
    """Normalise a numeric literal for deterministic text matching."""
    number = float(value)  # type: ignore[arg-type]
    if number == int(number):
        return str(int(number))
    return f"{number:g}"


def _in(values: list[str]) -> str:
    return ", ".join(f"'{value}'" for value in values)
