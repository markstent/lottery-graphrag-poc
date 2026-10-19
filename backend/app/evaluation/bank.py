"""Benchmark bank 2.0.0: the 22 logical questions.

Questions fall into four strata, one per hypothesis that needs questions of
its own: H1 multi-hop, H2 ontology-dependent (id-anchored and name-anchored),
H3 single facts and H5 planted patterns. H4 (citations, explainability), H6
(latency, context efficiency) and H7 (model size) are metrics or run kinds over
every question, not strata.

Each template has one slot: ``{anchor}`` takes a record id and
``{anchor_name}`` a local-language name. Grounding a question to concrete
anchors for one generated world happens in ``app.evaluation.grounding``; the
evaluator truth ledger is only ever consulted there, never by retrieval.
"""

from __future__ import annotations

from dataclasses import dataclass

BANK_VERSION = "2.0.0"
ANCHORS_PER_QUESTION = 3

STRATA: dict[str, str] = {
    "H1": "multi-hop questions",
    "H2": "ontology-dependent questions",
    "H3": "single facts",
    "H5": "planted patterns",
}
NAME_ANCHORED = "entity resolution through the ontology"


@dataclass(frozen=True, slots=True)
class LogicalQuestion:
    """One logical question; grounding fills the template slot per world."""

    question_id: str
    stratum: str
    # "id_anchored" or "name_anchored" for H2, None elsewhere.
    sub_stratum: str | None
    template: str
    tests: str
    anchor_kind: str
    # Scenario whose planted truth the question needs (H5 only).
    scenario_id: str | None
    ontology_dependent: bool


def _q(
    question_id: str,
    stratum: str,
    template: str,
    tests: str,
    anchor_kind: str,
    *,
    sub_stratum: str | None = None,
    scenario_id: str | None = None,
    ontology: bool = False,
) -> LogicalQuestion:
    return LogicalQuestion(
        question_id, stratum, sub_stratum, template, tests, anchor_kind, scenario_id, ontology
    )


_ID = "id_anchored"
_NAME = "name_anchored"

BANK: tuple[LogicalQuestion, ...] = (
    _q(
        "L01",
        "H3",
        "What is the ticket price of game {anchor}?",
        "Reads one price from one record.",
        "game",
    ),
    _q(
        "L02",
        "H3",
        "Which platform version was incident {anchor} seen on?",
        "Reads one link from one record.",
        "incident",
    ),
    _q(
        "L03",
        "H3",
        "When does campaign {anchor} end?",
        "Reads one date from one record.",
        "campaign",
    ),
    _q(
        "L04",
        "H3",
        "Is game {anchor} available on digital channels?",
        "Reads one flag and answers yes or no.",
        "game",
    ),
    _q(
        "L05",
        "H1",
        "Which other markets had incidents on the same platform version as incident {anchor}?",
        "Follows incident to version to other incidents.",
        "incident",
    ),
    _q(
        "L06",
        "H1",
        "Which game mechanics do the games affected by incident {anchor} use?",
        "Follows incident to games to mechanics.",
        "incident",
    ),
    _q(
        "L07",
        "H1",
        "Which platform version is behind the incident linked to support case {anchor}?",
        "Follows case to incident to version.",
        "support_case",
    ),
    _q(
        "L08",
        "H1",
        "Which games were affected by incidents on platform version {anchor}?",
        "Follows version to incidents to games.",
        "platform_version",
    ),
    _q(
        "L09",
        "H2",
        "Which games in other markets belong to the same kind of game family as game {anchor}?",
        "Needs family equivalence across markets.",
        "game",
        sub_stratum=_ID,
        ontology=True,
    ),
    _q(
        "L10",
        "H2",
        "Which incidents in other markets are the same kind of incident as incident {anchor}?",
        "Needs incident-type equivalence across markets.",
        "incident",
        sub_stratum=_ID,
        ontology=True,
    ),
    _q(
        "L11",
        "H2",
        "Which player segments in other markets correspond to segment {anchor}?",
        "Needs segment equivalence across markets.",
        "segment",
        sub_stratum=_ID,
        ontology=True,
    ),
    _q(
        "L12",
        "H2",
        (
            "Which games in other markets use the same kind of mechanic as "
            "the main mechanic of game {anchor}?"
        ),
        "Needs mechanic equivalence across markets.",
        "game",
        sub_stratum=_ID,
        ontology=True,
    ),
    _q(
        "L13",
        "H2",
        'Which games, in any market, belong to the kind of game family called "{anchor_name}"?',
        "Needs a local-language family name resolved to a concept.",
        "family",
        sub_stratum=_NAME,
        ontology=True,
    ),
    _q(
        "L14",
        "H2",
        'Which games, in any market, use the kind of mechanic called "{anchor_name}"?',
        "Needs a local-language mechanic name resolved to a concept.",
        "mechanic",
        sub_stratum=_NAME,
        ontology=True,
    ),
    _q(
        "L15",
        "H5",
        "What caused incident {anchor}?",
        "Finds the app release behind a checkout failure.",
        "incident",
        scenario_id="SCN-001",
    ),
    _q(
        "L16",
        "H5",
        "Which other players share a device with player {anchor}?",
        "Finds a shared-device cluster.",
        "player",
        scenario_id="SCN-002",
    ),
    _q(
        "L17",
        "H5",
        "Which other accounts share a payment instrument with player {anchor}?",
        "Finds a shared-payment cluster.",
        "player",
        scenario_id="SCN-003",
    ),
    _q(
        "L18",
        "H5",
        (
            "Which other markets saw incidents on the same platform version as "
            "incident {anchor}, and which market was unaffected?"
        ),
        "Finds a cross-market incident and its exception.",
        "incident",
        scenario_id="SCN-007",
    ),
    _q(
        "L19",
        "H5",
        "Which payment provider is behind support case {anchor}, and which markets are affected?",
        "Finds a degraded provider behind support cases.",
        "support_case",
        scenario_id="SCN-009",
    ),
    _q(
        "L20",
        "H5",
        "Which games in other markets show the same mechanic affinity as game {anchor}?",
        "Finds a planted cross-market mechanic affinity.",
        "game",
        scenario_id="SCN-010",
        ontology=True,
    ),
    _q(
        "L21",
        "H5",
        "Which game in another market is the best transfer target for campaign {anchor}?",
        "Finds a planted transferable campaign.",
        "campaign",
        scenario_id="SCN-011",
        ontology=True,
    ),
    _q(
        "L22",
        "H5",
        (
            "What is the current ticket price of game {anchor}, and is the rules "
            "document that states a different price still valid?"
        ),
        "Prefers the record over a stale document.",
        "game",
        scenario_id="SCN-015",
    ),
)

_BY_ID = {q.question_id: q for q in BANK}


def question_by_id(question_id: str) -> LogicalQuestion:
    """Return the bank question with this id; raises KeyError if absent."""
    return _BY_ID[question_id]
