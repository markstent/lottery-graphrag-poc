"""Grounding the bank into one generated world (benchmark v2).

A structural question grounds to up to ``ANCHORS_PER_QUESTION`` concrete
instances: the grounder in ``app.evaluation.grounders`` lists every eligible
anchor, :func:`sample_anchors` picks a stable hash order of them, and each
picked anchor becomes a :class:`BankInstance` whose claims carry the records
and chunks that state its answer, minus the anchor itself. A planted question
grounds to one instance read from its scenario's ledger truth
(``app.evaluation.planted``).

:func:`freeze_bank` grounds the whole bank into a hashed :class:`FrozenBank`
that records the world, ledger and record serialiser it was built from.

Everything here is evaluator-only (ADR-008): retrieval code never imports
this package. Identical world, ledger and bank version give identical output.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import cast

import duckdb

from app.datasets.schema import TABLE_SCHEMAS
from app.evaluation.bank import ANCHORS_PER_QUESTION, BANK, BANK_VERSION, LogicalQuestion
from app.evaluation.checks import Check, check_from_payload
from app.evaluation.claims import (
    CarrierIndex,
    Claim,
    ClaimSpec,
    claim_from_payload,
    exclude_anchor,
)
from app.evaluation.grounders import GROUNDERS, Draft, World, load_world
from app.evaluation.planted import PLANTED_GROUNDERS
from app.evaluation.truth_ledger import load_ledger
from app.ontology.loader import load_ontology
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION

SCENARIO_NOT_PLANTED = "scenario not planted"
NO_ELIGIBLE_ANCHOR = "no eligible anchor"

# Strata whose instances score discoveries: an instance with no claim left
# after excluding the anchor cannot, so its anchor is ineligible.
DISCOVERY_STRATA = frozenset({"H1", "H2"})


class GroundingError(RuntimeError):
    """A question cannot be grounded as specified; fail loudly."""


@dataclass(frozen=True, slots=True)
class BankInstance:
    """One logical question grounded to one anchor of one world."""

    instance_id: str
    question_id: str
    stratum: str
    sub_stratum: str | None
    ontology_dependent: bool
    world_seed: int
    anchor_id: str
    text: str
    expected_answer: str
    checks: tuple[Check, ...]
    claims: tuple[Claim, ...]

    def to_payload(self) -> dict[str, object]:
        return {
            "instance_id": self.instance_id,
            "question_id": self.question_id,
            "stratum": self.stratum,
            "sub_stratum": self.sub_stratum,
            "ontology_dependent": self.ontology_dependent,
            "world_seed": self.world_seed,
            "anchor_id": self.anchor_id,
            "text": self.text,
            "expected_answer": self.expected_answer,
            "checks": [check.to_payload() for check in self.checks],
            "claims": [claim.to_payload() for claim in self.claims],
        }


def instance_from_payload(payload: Mapping[str, object]) -> BankInstance:
    sub_stratum = payload["sub_stratum"]
    return BankInstance(
        instance_id=str(payload["instance_id"]),
        question_id=str(payload["question_id"]),
        stratum=str(payload["stratum"]),
        sub_stratum=None if sub_stratum is None else str(sub_stratum),
        ontology_dependent=bool(payload["ontology_dependent"]),
        world_seed=int(str(payload["world_seed"])),
        anchor_id=str(payload["anchor_id"]),
        text=str(payload["text"]),
        expected_answer=str(payload["expected_answer"]),
        checks=tuple(
            check_from_payload(c) for c in cast(list[Mapping[str, object]], payload["checks"])
        ),
        claims=tuple(
            claim_from_payload(c) for c in cast(list[Mapping[str, object]], payload["claims"])
        ),
    )


@dataclass(frozen=True, slots=True)
class GroundingOutcome:
    """The sampled instances, how many anchors were eligible, and a note for the report."""

    instances: tuple[BankInstance, ...]
    eligible: int
    note: str


def sample_anchors(
    question_id: str, eligible: Sequence[str], k: int = ANCHORS_PER_QUESTION
) -> list[str]:
    """The first ``k`` anchors in sha256 order of ``"{BANK_VERSION}:{question_id}:{anchor}"``."""

    def digest(anchor: str) -> str:
        return hashlib.sha256(f"{BANK_VERSION}:{question_id}:{anchor}".encode()).hexdigest()

    return sorted(eligible, key=digest)[:k]


def name_anchor_order(question_id: str, drafts: Sequence[Draft]) -> list[Draft]:
    """One draft per concept, spread over languages, in pick order.

    Concepts are walked in the hash order of their first code. Each concept
    picks its first code in hash order whose language no earlier pick used;
    when every language it binds is used, it falls back to its first code.
    The name-anchored sub-stratum tests local-language resolution, so its
    instances never share an answer and avoid sharing a language.
    """
    by_anchor = {draft.anchor_id: draft for draft in drafts}
    ordered = [by_anchor[a] for a in sample_anchors(question_id, list(by_anchor), len(by_anchor))]
    codes: dict[str | None, list[Draft]] = {}
    for draft in ordered:
        codes.setdefault(draft.concept, []).append(draft)
    used: set[str | None] = set()
    picks: list[Draft] = []
    for candidates in codes.values():
        pick = next((d for d in candidates if d.language not in used), candidates[0])
        used.add(pick.language)
        picks.append(pick)
    return picks


class WorldGrounding:
    """Grounds bank questions against one generated world and its truth ledger.

    Holds one DuckDB connection whose views name the world's Parquet tables;
    call :meth:`close` when done.
    """

    def __init__(self, world_dir: Path, ledger_path: Path) -> None:
        self.world_dir = world_dir
        ledger = load_ledger(ledger_path)
        self.world_seed = ledger.world.world_seed
        self._scenarios = {s.scenario_id: s for s in ledger.scenarios if s.enabled}
        self._connection = duckdb.connect()
        try:
            for table in TABLE_SCHEMAS:
                path = (world_dir / f"{table}.parquet").as_posix().replace("'", "''")
                self._connection.execute(
                    f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{path}')"
                )
            self._world: World = load_world(self._connection, load_ontology())
            self._index = CarrierIndex.build(world_dir)
        except BaseException:
            self._connection.close()
            raise

    def close(self) -> None:
        self._connection.close()

    def ground(self, question: LogicalQuestion) -> GroundingOutcome:
        if question.scenario_id is not None:
            return self._ground_planted(question, question.scenario_id)
        grounder = GROUNDERS.get(question.question_id)
        if grounder is None:
            raise GroundingError(f"no structural grounder for {question.question_id}")
        drafts = grounder(self._world)
        if question.stratum in DISCOVERY_STRATA:
            drafts = [draft for draft in drafts if self._has_discovery(draft)]
        by_anchor = {draft.anchor_id: draft for draft in drafts}
        if len(by_anchor) != len(drafts):
            raise GroundingError(f"{question.question_id} lists an anchor twice")
        note = f"{len(drafts)} eligible anchors"
        if any(draft.concept is not None for draft in drafts):
            picks = name_anchor_order(question.question_id, drafts)
            chosen = [draft.anchor_id for draft in picks[:ANCHORS_PER_QUESTION]]
            note = f"{len(picks)} eligible anchors (one per concept, of {len(drafts)} codes)"
            eligible = len(picks)
        else:
            chosen = sample_anchors(question.question_id, list(by_anchor))
            eligible = len(drafts)
        if eligible < ANCHORS_PER_QUESTION:
            note += f", fewer than the {ANCHORS_PER_QUESTION} the bank asks for"
        instances = tuple(self._instance(question, by_anchor[anchor]) for anchor in chosen)
        return GroundingOutcome(instances, eligible, note)

    def _ground_planted(self, question: LogicalQuestion, scenario_id: str) -> GroundingOutcome:
        """One instance from the scenario's truth; none when the world did not plant it."""
        scenario = self._scenarios.get(scenario_id)
        if scenario is None:
            return GroundingOutcome((), 0, SCENARIO_NOT_PLANTED)
        grounder = PLANTED_GROUNDERS.get(question.question_id)
        if grounder is None:
            raise GroundingError(f"no planted grounder for {question.question_id}")
        try:
            draft = grounder(scenario, self._world, self._connection)
        except ValueError as error:
            raise GroundingError(f"{question.question_id}: {error}") from error
        return GroundingOutcome((self._instance(question, draft),), 1, f"planted by {scenario_id}")

    def _instance(self, question: LogicalQuestion, draft: Draft) -> BankInstance:
        claims = exclude_anchor([self._claim(spec) for spec in draft.specs], draft.anchor_id)
        return BankInstance(
            instance_id=f"{question.question_id}-{self.world_seed}-{draft.anchor_id}",
            question_id=question.question_id,
            stratum=question.stratum,
            sub_stratum=question.sub_stratum,
            ontology_dependent=question.ontology_dependent,
            world_seed=self.world_seed,
            anchor_id=draft.anchor_id,
            text=question.template.format(anchor=draft.slot, anchor_name=draft.slot),
            expected_answer=draft.expected_answer,
            checks=draft.checks,
            claims=claims,
        )

    def _claim(self, spec: ClaimSpec) -> Claim:
        try:
            carriers = self._index.carriers(spec)
        except ValueError as error:
            raise GroundingError(str(error)) from error
        return Claim(spec.claim_id, spec.statement, carriers)

    def _has_discovery(self, draft: Draft) -> bool:
        """Whether any claim keeps a carrier besides the anchor.

        A declared record other than the anchor, or a declared document,
        settles it without scanning; otherwise the carriers are resolved.
        """
        if any(
            spec.document_ids or any(r != draft.anchor_id for r in spec.record_ids)
            for spec in draft.specs
        ):
            return True
        return any(self._claim(spec).carriers - {draft.anchor_id} for spec in draft.specs)


@dataclass(frozen=True, slots=True)
class Unavailable:
    """A bank question this world cannot ground, and why."""

    question_id: str
    reason: str


@dataclass(frozen=True, slots=True)
class FrozenBank:
    """The bank grounded into one world, with the hashes of what it was built from.

    ``bank_hash`` is the sha256 of the canonical JSON of every other field,
    so any edit to a written bank is detected on load.
    """

    bank_version: str
    world_seed: int
    world_manifest_hash: str
    record_serialiser_version: str
    ledger_hash: str
    instances: tuple[BankInstance, ...]
    unavailable: tuple[Unavailable, ...]
    bank_hash: str


def freeze_bank(world_dir: Path, ledger_path: Path) -> FrozenBank:
    """Ground every bank question, in bank order, into one hashed bank."""
    grounding = WorldGrounding(world_dir, ledger_path)
    instances: list[BankInstance] = []
    unavailable: list[Unavailable] = []
    try:
        for question in BANK:
            outcome = grounding.ground(question)
            instances.extend(outcome.instances)
            if not outcome.instances:
                reason = SCENARIO_NOT_PLANTED if question.scenario_id else NO_ELIGIBLE_ANCHOR
                unavailable.append(Unavailable(question.question_id, reason))
    finally:
        grounding.close()
    unhashed = FrozenBank(
        bank_version=BANK_VERSION,
        world_seed=grounding.world_seed,
        world_manifest_hash=_sha256((world_dir / "_manifest.json").read_bytes()),
        record_serialiser_version=RECORD_SERIALISER_VERSION,
        ledger_hash=_sha256(ledger_path.read_bytes()),
        instances=tuple(instances),
        unavailable=tuple(unavailable),
        bank_hash="",
    )
    return seal_bank(unhashed)


def seal_bank(bank: FrozenBank) -> FrozenBank:
    """The bank with ``bank_hash`` set to the hash of its content."""
    return replace(bank, bank_hash=_content_hash(_content(bank)))


def write_frozen_bank(bank: FrozenBank, path: Path) -> None:
    """Write the bank as canonical JSON (sorted keys, two-space indent, trailing newline)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_canonical({**_content(bank), "bank_hash": bank.bank_hash}), encoding="utf-8")


def load_frozen_bank(path: Path) -> FrozenBank:
    """Read a written bank; raises :class:`GroundingError` when its hash does not match."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or "bank_hash" not in payload:
        raise GroundingError(f"{path} is not a frozen bank")
    recorded = payload.pop("bank_hash")
    actual = _content_hash(payload)
    if recorded != actual:
        raise GroundingError(f"{path} has bank hash {recorded} but its content hashes to {actual}")
    return _bank_from_content(payload, actual)


def _content(bank: FrozenBank) -> dict[str, object]:
    """Every field but ``bank_hash``, as JSON-ready values."""
    return {
        "bank_version": bank.bank_version,
        "world_seed": bank.world_seed,
        "world_manifest_hash": bank.world_manifest_hash,
        "record_serialiser_version": bank.record_serialiser_version,
        "ledger_hash": bank.ledger_hash,
        "instances": [instance.to_payload() for instance in bank.instances],
        "unavailable": [
            {"question_id": u.question_id, "reason": u.reason} for u in bank.unavailable
        ],
    }


def _bank_from_content(content: Mapping[str, object], bank_hash: str) -> FrozenBank:
    return FrozenBank(
        bank_version=str(content["bank_version"]),
        world_seed=int(str(content["world_seed"])),
        world_manifest_hash=str(content["world_manifest_hash"]),
        record_serialiser_version=str(content["record_serialiser_version"]),
        ledger_hash=str(content["ledger_hash"]),
        instances=tuple(
            instance_from_payload(p) for p in cast(list[Mapping[str, object]], content["instances"])
        ),
        unavailable=tuple(
            Unavailable(str(u["question_id"]), str(u["reason"]))
            for u in cast(list[Mapping[str, object]], content["unavailable"])
        ),
        bank_hash=bank_hash,
    )


def _canonical(payload: Mapping[str, object]) -> str:
    return json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def _content_hash(content: Mapping[str, object]) -> str:
    return _sha256(_canonical(content).encode("utf-8"))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
