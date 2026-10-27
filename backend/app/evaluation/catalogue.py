"""The question catalogue the Help screen shows, and each question's scores.

:func:`question_catalogue` lists every instance of a frozen bank with what
its question tests, its answer key and, for a planted pattern (H5), the
hidden truth of its scenario. The ledger has no single narrative field:
some scenarios carry an interpretation, others a note or none. So the hidden
truth is one sentence per scenario built from the ledger's own truth values
(the planted ids, then the ledger's own interpretation or note where it has
one); no part of it is written by hand.

:func:`instance_scores` reads a run's ``results.json`` payload for the same
bank: per instance and pipeline, the mean answer and evidence F1 over the
repeats that were scored.

Evaluator-only (ADR-008): retrieval code never imports this module; the API
reaches it only through its benchmark routes.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.evaluation.bank import question_by_id
from app.evaluation.grounders import render_list
from app.evaluation.grounding import FrozenBank
from app.evaluation.official import instance_means
from app.evaluation.runner import PIPELINES
from app.evaluation.truth_ledger import TruthScenario, load_ledger


class LedgerMismatch(ValueError):
    """The ledger is not the one the frozen bank was grounded on."""


@dataclass(frozen=True, slots=True)
class QuestionCard:
    """One bank instance as the Help screen shows it."""

    question_id: str
    instance_id: str
    text: str
    tests: str
    stratum: str
    scenario_id: str | None
    ontology_dependent: bool
    expected_answer: str
    hidden_truth: str | None


@dataclass(frozen=True, slots=True)
class PipelineMeans:
    """One pipeline's means over the scored repeats of one instance; None
    where no scored repeat defines the metric."""

    answer: float | None
    evidence_f1: float | None


def question_catalogue(bank: FrozenBank, ledger_path: Path) -> list[QuestionCard]:
    """Every instance of ``bank`` in bank order, with hidden truths read from
    the ledger the bank was grounded on; any other ledger is refused."""
    if hashlib.sha256(ledger_path.read_bytes()).hexdigest() != bank.ledger_hash:
        raise LedgerMismatch(
            f"the ledger {ledger_path} is not the one the bank of world seed "
            f"{bank.world_seed} was grounded on; ground the bank again"
        )
    scenarios = {scenario.scenario_id: scenario for scenario in load_ledger(ledger_path).scenarios}
    cards = []
    for instance in bank.instances:
        question = question_by_id(instance.question_id)
        scenario_id = question.scenario_id
        cards.append(
            QuestionCard(
                question_id=instance.question_id,
                instance_id=instance.instance_id,
                text=instance.text,
                tests=question.tests,
                stratum=instance.stratum,
                scenario_id=scenario_id,
                ontology_dependent=instance.ontology_dependent,
                expected_answer=instance.expected_answer,
                hidden_truth=None if scenario_id is None else hidden_truth(scenarios[scenario_id]),
            )
        )
    return cards


def instance_scores(
    results: Mapping[str, Any], bank: FrozenBank
) -> dict[str, dict[str, PipelineMeans]]:
    """Per instance id of ``bank``, each pipeline's means in the run's
    ``results.json``. Only the run's world grounded on this very bank (same
    seed, same bank hash) counts, so a run over a re-grounded bank gives none."""
    worlds = [
        world
        for world in results["worlds"]
        if world["world_seed"] == bank.world_seed and world["bank_hash"] == bank.bank_hash
    ]
    means = instance_means({**results, "worlds": worlds}, ("answer", "evidence_f1"))
    return {
        instance_id: {
            tag: PipelineMeans(values.get((tag, "answer")), values.get((tag, "evidence_f1")))
            for tag in PIPELINES
        }
        for instance_id, (_key, _cluster, values) in means.items()
    }


def hidden_truth(scenario: TruthScenario) -> str:
    """One plain sentence of the scenario's planted truth, from ledger values only."""
    return _SENTENCES[scenario.scenario_type](scenario.truth) + "."


def _ids(truth: Mapping[str, Any], key: str) -> str:
    return render_list([str(value) for value in truth[key]])


def _was(items: Sequence[object]) -> str:
    return "was" if len(items) == 1 else "were"


def _note(facts: str, note: str) -> str:
    """The facts, then the ledger's own interpretation or note."""
    return f"{facts}; {note.rstrip('.')}"


def _app_release(truth: Mapping[str, Any]) -> str:
    return _note(
        f"Incident {truth['incident_id']} in {truth['market']} traces to app release "
        f"{truth['app_version_id']} on {truth['device_family']} devices (release note "
        f"{truth['release_note_id']}, incident report {truth['incident_report_id']})",
        truth["expected_interpretation"],
    )


def _shared_devices(truth: Mapping[str, Any]) -> str:
    window = truth["coordination_window"]
    return _note(
        f"Players {_ids(truth, 'cluster_players')} in {truth['market']} share devices "
        f"{_ids(truth, 'shared_devices')} and bought {truth['planted_ticket_count']} tickets "
        f"for {truth['game']} within {window['minutes']} minutes from {window['start']}",
        truth["expected_interpretation"],
    )


def _shared_payments(truth: Mapping[str, Any]) -> str:
    return _note(
        f"Players {_ids(truth, 'cluster_players')} in {truth['market']} share payment "
        f"instruments {_ids(truth, 'shared_instruments')}",
        truth["expected_interpretation"],
    )


def _platform_incident(truth: Mapping[str, Any]) -> str:
    return _note(
        f"Platform version {truth['root_cause_entity']} links incidents in primary market "
        f"{truth['primary_market']} and in {_ids(truth, 'related_markets')}, while "
        f"{_ids(truth, 'unaffected_markets')} {_was(truth['unaffected_markets'])} unaffected",
        truth["unaffected_explanation"],
    )


def _provider(truth: Mapping[str, Any]) -> str:
    days = truth["active_days"]
    return _note(
        f"Payment provider {truth['provider_id']} degraded on {len(days)} days from {days[0]} "
        f"to {days[-1]} in {_ids(truth, 'affected_markets')}",
        truth["expected_interpretation"],
    )


def _mechanic_affinity(truth: Mapping[str, Any]) -> str:
    games = [
        f"{cell['game_id']} in {market}" for market, cell in sorted(truth["per_market"].items())
    ]
    return _note(
        f"The {truth['segment_concept']} segment over-indexes on the "
        f"{truth['mechanic_concept']} mechanic in {render_list(games)}, with "
        f"{truth['control_market']} as the control market",
        truth["uplift_note"],
    )


def _campaign(truth: Mapping[str, Any]) -> str:
    return _note(
        f"Campaign {truth['source_campaign_id']} ran on game {truth['source_game_id']} for "
        f"segment {truth['source_segment_id']} in {truth['source_market']}, and its transfer "
        f"target is game {truth['target_game_id']} for segment {truth['target_segment_id']} "
        f"in {truth['target_market']}",
        truth["expected_interpretation"],
    )


def _document_conflict(truth: Mapping[str, Any]) -> str:
    return _note(
        f"The authoritative ticket price is {truth['authoritative_price']} "
        f"({truth['authoritative_source']}), while document {truth['conflicting_document']} "
        f"states {truth['stale_price']}",
        truth["validity_note"],
    )


# One sentence builder per scenario type of the catalogue (docs/reference/04).
_SENTENCES: dict[str, Callable[[Mapping[str, Any]], str]] = {
    "app_release_conversion_failure": _app_release,
    "shared_device_cluster": _shared_devices,
    "shared_payment_cluster": _shared_payments,
    "cross_market_platform_incident": _platform_incident,
    "payment_provider_degradation": _provider,
    "game_mechanic_affinity": _mechanic_affinity,
    "transferable_campaign": _campaign,
    "document_structured_conflict": _document_conflict,
}
