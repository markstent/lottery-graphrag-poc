"""The blinded LLM judge's contract (benchmark v2).

These are the types the runner records a judgement with. The judge
implementations, blinding and prompt are Task 8 of the Phase 3 plan; until
then no run is judged and every ``RunScore.judge`` is None.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.evaluation.runner import ShownBlock


@dataclass(frozen=True, slots=True)
class JudgeScores:
    """One judgement on the 0 (wrong or absent), 1 (partly), 2 (fully) rubric."""

    correctness: int
    completeness: int
    faithfulness: int
    citation_accuracy: int
    abstention: int


@dataclass(frozen=True, slots=True)
class JudgeVerdict:
    """The scores of one judged repeat, or why the judge gave none."""

    scores: JudgeScores | None
    failure: str | None
    model: str
    latency_ms: float


@dataclass(frozen=True, slots=True)
class JudgeItem:
    """What the judge sees of one repeat."""

    question: str
    expected_answer: str
    claim_statements: tuple[str, ...]
    blocks: tuple[ShownBlock, ...]
    answer: str
    cited_blocks: tuple[int, ...]
    blind_seed: str


class Judge(Protocol):
    model_name: str

    def judge(self, item: JudgeItem) -> JudgeVerdict: ...
