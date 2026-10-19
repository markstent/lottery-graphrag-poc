"""Grounding the bank into one generated world (benchmark v2).

A logical question grounds to up to ``ANCHORS_PER_QUESTION`` concrete
instances: the grounder in ``app.evaluation.grounders`` lists every eligible
anchor, :func:`sample_anchors` picks a stable hash order of them, and each
picked anchor becomes a :class:`BankInstance` whose claims carry the records
and chunks that state its answer, minus the anchor itself.

Everything here is evaluator-only (ADR-008): retrieval code never imports
this package. Identical world, ledger and bank version give identical output.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import duckdb

from app.datasets.schema import TABLE_SCHEMAS
from app.evaluation.bank import ANCHORS_PER_QUESTION, BANK_VERSION, LogicalQuestion
from app.evaluation.checks import Check, check_from_payload
from app.evaluation.claims import (
    CarrierIndex,
    Claim,
    ClaimSpec,
    claim_from_payload,
    exclude_anchor,
)
from app.evaluation.grounders import GROUNDERS, Draft, World, load_world
from app.evaluation.truth_ledger import load_ledger
from app.ontology.loader import load_ontology

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


def _one_per_concept(question_id: str, by_anchor: Mapping[str, Draft]) -> dict[str, Draft]:
    """The first anchor in hash order for each concept, so no two instances share an answer."""
    kept: dict[str, Draft] = {}
    concepts: set[str | None] = set()
    for anchor in sample_anchors(question_id, list(by_anchor), k=len(by_anchor)):
        draft = by_anchor[anchor]
        if draft.concept not in concepts:
            concepts.add(draft.concept)
            kept[anchor] = draft
    return kept


class WorldGrounding:
    """Grounds bank questions against one generated world and its truth ledger.

    Holds one DuckDB connection whose views name the world's Parquet tables;
    call :meth:`close` when done.
    """

    def __init__(self, world_dir: Path, ledger_path: Path) -> None:
        self.world_dir = world_dir
        self.world_seed = load_ledger(ledger_path).world.world_seed
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
            by_anchor = _one_per_concept(question.question_id, by_anchor)
            note = f"{len(by_anchor)} eligible anchors (one per concept, of {len(drafts)} codes)"
        if len(by_anchor) < ANCHORS_PER_QUESTION:
            note += f", fewer than the {ANCHORS_PER_QUESTION} the bank asks for"
        chosen = sample_anchors(question.question_id, list(by_anchor))
        instances = tuple(self._instance(question, by_anchor[anchor]) for anchor in chosen)
        return GroundingOutcome(instances, len(by_anchor), note)

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
