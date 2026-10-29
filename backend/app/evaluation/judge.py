"""The blinded, versioned LLM judge (benchmark v2, docs/reference/05 section 9).

The judge scores one answer on five dimensions (0 wrong or absent, 1 partly,
2 fully) beside the deterministic scores; it never replaces them. It sees
the question, the expected answer, the claim statements, the text of the
context blocks the generator was shown and the answer, blinded: the blocks
are shuffled by a hashed seed and renumbered, the answer's citations are
rewritten to the new numbers, and the prompt never names the pipeline or
how the context was retrieved.

The judge reads each block's ``ShownBlock.judge_text``: the
rendered prompt block less a document chunk's title line. A record reads
the same in A, B and C (its facts heading, source and facts), so record
blocks carry no tell of their own. Two tells remain, both declared (D-085):
a graph record reached by a walk ends with its "reached from" path line,
which only B and C show; and a graph node without a record block, which
only B and C can select. Such a node shows exactly "<Label> <id>" (for
example "Device DEV_UK_000009", as the v0.2 judge saw it), followed in C by
a concept's ontology text for a BusinessConcept node, and by its path line
when it was reached by a walk. The judge is secondary to the deterministic
scores (D-031).

A judge failure (gateway error or unusable reply) is recorded as
a verdict without scores.

`GatewayJudge` calls the model through the one model gateway; `FakeJudge`
is deterministic plumbing for smoke runs and CI and measures nothing.
The judge settings (`JudgeSettings`, `judge_settings_from_env`) live in
`app.config`, because the models route reports the judge model too.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import time
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from app.config import FAKE_JUDGE_MODEL, JudgeSettings
from app.evaluation.checks import is_abstention
from app.models.gateway import (
    Completion,
    CompletionRequest,
    GatewayError,
    complete,
)
from app.retrieval.standard.generation import CITATION, FENCED_JSON

if TYPE_CHECKING:
    from app.evaluation.runner import RunScore, ShownBlock

# 1.2.0 (D-096): the judge reads the whole answer, as the scorer does; 1.1.0
# capped it at 2,400 characters. The answer is bounded by the answer model's
# output limit (max_tokens, recorded with every run).
JUDGE_PROMPT_VERSION = "1.2.0"
JUDGE_DIMENSIONS = (
    "correctness",
    "completeness",
    "faithfulness",
    "citation_accuracy",
    "abstention",
)
JUDGE_MAX_TOKENS = 300
JUDGE_TIMEOUT_S = 120.0

JUDGE_SYSTEM_PROMPT = (
    "You grade one answer to a question about an enterprise. You are given the "
    "question, a reference answer, the key facts a complete answer states, the "
    "numbered context sources the answerer was shown, and the answer, which cites "
    "sources as [n]; [?] marks a citation of a source that was not shown. Score "
    "five dimensions, each 0, 1 or 2, where 0 means wrong or absent, 1 means "
    "partly and 2 means fully. "
    "correctness: the answer agrees with the reference answer; an answer that says the "
    "sources do not answer scores 0 when the reference answer gives an answer. "
    "completeness: the answer states the key facts. "
    "faithfulness: every statement in the answer is supported by the context sources. "
    "citation_accuracy: each citation points at a source that supports the "
    "statement it is attached to. "
    "abstention: 2 when the answer correctly says the context does not answer the "
    "question, or answers when the context does; 0 when it guesses without support "
    "in the context; 1 otherwise. "
    "Judge only from what is given here. Respond with exactly one JSON object and "
    'nothing else: {"correctness": <0, 1 or 2>, "completeness": <0, 1 or 2>, '
    '"faithfulness": <0, 1 or 2>, "citation_accuracy": <0, 1 or 2>, '
    '"abstention": <0, 1 or 2>}.'
)

# The user message of one judged repeat, filled by build_judge_prompt; part
# of the prompt hash, so a layout change shows in the record.
JUDGE_USER_TEMPLATE = (
    "Question: {question}\n\n"
    "Reference answer: {expected_answer}\n\n"
    "Key facts a complete answer states:\n{facts}\n\n"
    "Context sources the answerer was shown:\n{sources}\n\n"
    "Answer to grade:\n{answer}\n\n"
    "Sources the answer cites: {cited}"
)

# Any bracket holding a digit: a citation marker or a malformed one.
_DIGIT_BRACKET = re.compile(r"\[[^\[\]]*\d[^\[\]]*\]")
_IDENTIFIER = re.compile(r"\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b")


class JudgeParseError(ValueError):
    """Raised when a judge reply is not the five-score JSON object."""


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
    """What the judge sees of one repeat, before blinding."""

    question: str
    expected_answer: str
    claim_statements: tuple[str, ...]
    blocks: tuple[ShownBlock, ...]
    answer: str
    cited_blocks: tuple[int, ...]
    blind_seed: str


class Judge(Protocol):
    model_name: str
    model_family: str | None
    # The gateway reasoning mode and temperature; None when the judge calls no model.
    reasoning: str | None
    temperature: float | None

    def judge(self, item: JudgeItem) -> JudgeVerdict: ...


def _blinding(item: JudgeItem) -> tuple[list[int], dict[int, int]]:
    """The shown order (original 0-based indexes, shuffled by the hashed
    seed) and the renumbering from original to shown 1-based numbers."""
    seed = int(hashlib.sha256(item.blind_seed.encode("utf-8")).hexdigest()[:16], 16)
    order = list(range(len(item.blocks)))
    random.Random(seed).shuffle(order)
    return order, {old + 1: new for new, old in enumerate(order, start=1)}


def blind(item: JudgeItem) -> tuple[list[ShownBlock], str]:
    """The blocks in shuffled order and the answer, blinded."""
    order, renumber = _blinding(item)
    return [item.blocks[old] for old in order], _blind_answer(item.answer, renumber)


def _blind_answer(answer: str, renumber: dict[int, int]) -> str:
    """Rewrite every [n] and [n, m] marker to the shown numbers ([?] for a
    block that was not shown) and every other bracket holding a digit, such
    as [1-3], to [?], so no stale number points at a reshuffled block. The
    whole answer is kept (judge prompt 1.2.0, D-096)."""

    def rewrite(match: re.Match[str]) -> str:
        citation = CITATION.fullmatch(match.group(0))
        if citation is None:
            return "[?]"
        numbers = (renumber.get(int(part)) for part in citation.group(1).split(","))
        return "[" + ", ".join("?" if n is None else str(n) for n in numbers) + "]"

    return _DIGIT_BRACKET.sub(rewrite, answer)


def build_judge_prompt(item: JudgeItem) -> tuple[str, str]:
    """(system, user) for one blinded item: each block's shown text (no
    document title line), and nothing that names how the context was
    retrieved beyond the declared tells in the module docstring."""
    order, renumber = _blinding(item)
    shown = [item.blocks[old] for old in order]
    answer = _blind_answer(item.answer, renumber)
    facts = "\n".join(f"- {statement}" for statement in item.claim_statements) or "- (none)"
    sources = (
        "\n\n".join(f"[{n}] {block.judge_text}" for n, block in enumerate(shown, start=1))
        or "(no context was shown)"
    )
    cited = [str(renumber[n]) for n in item.cited_blocks if n in renumber]
    user = JUDGE_USER_TEMPLATE.format(
        question=item.question,
        expected_answer=item.expected_answer,
        facts=facts,
        sources=sources,
        answer=answer,
        cited=", ".join(cited) or "none",
    )
    return JUDGE_SYSTEM_PROMPT, user


def judge_prompt_hash() -> str:
    """The sha256 of the system prompt, its version and the user-message
    template, for the record."""
    text = JUDGE_SYSTEM_PROMPT + JUDGE_PROMPT_VERSION + JUDGE_USER_TEMPLATE
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_judge(raw: str) -> JudgeScores:
    """Read the five scores from strict JSON, else from the first fenced
    JSON object (as `parse_answer` does)."""
    payload = _json_object(raw)
    if payload is None:
        payload = next(
            (
                found
                for block in FENCED_JSON.finditer(raw)
                if (found := _json_object(block.group(1)))
            ),
            None,
        )
    if payload is None:
        raise JudgeParseError("the judge reply is not a JSON object")
    values: dict[str, int] = {}
    for dimension in JUDGE_DIMENSIONS:
        if dimension not in payload:
            raise JudgeParseError(f"the judge reply has no {dimension} score")
        value = payload[dimension]
        # bool is an int subclass; true is not a score.
        if type(value) is not int or not 0 <= value <= 2:
            raise JudgeParseError(
                f"the judge reply gives {dimension}={value!r}; expected an integer 0, 1 or 2"
            )
        values[dimension] = value
    return JudgeScores(**values)


def _json_object(text: str) -> dict[str, object] | None:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


class GatewayJudge:
    """The judge model, called through the model gateway."""

    def __init__(
        self,
        settings: JudgeSettings,
        gateway: Callable[[CompletionRequest], Completion] = complete,
    ) -> None:
        if settings.provider != "litellm":
            raise ValueError(
                f"a gateway judge needs JUDGE_PROVIDER=litellm, got {settings.provider!r}"
            )
        self.settings = settings
        self.model_name = settings.model
        self.model_family = settings.model_family
        self.reasoning: str | None = settings.reasoning
        self.temperature: float | None = settings.temperature
        self._gateway = gateway

    def judge(self, item: JudgeItem) -> JudgeVerdict:
        system, user = build_judge_prompt(item)
        request = CompletionRequest(
            model=self.settings.model,
            system=system,
            user=user,
            temperature=self.settings.temperature,
            max_tokens=JUDGE_MAX_TOKENS,
            api_base=self.settings.api_base,
            timeout_s=JUDGE_TIMEOUT_S,
            reasoning=self.settings.reasoning,
        )
        started = time.perf_counter()
        try:
            scores = parse_judge(self._gateway(request).text)
        except (GatewayError, JudgeParseError) as error:
            latency_ms = (time.perf_counter() - started) * 1000
            return JudgeVerdict(None, str(error), self.model_name, latency_ms)
        return JudgeVerdict(scores, None, self.model_name, (time.perf_counter() - started) * 1000)


class FakeJudge:
    """Deterministic plumbing for smoke runs and CI; it measures nothing.

    Correctness is 2 when every identifier-like token of the expected answer
    occurs in the answer, 1 when some do and 0 when none do; every other
    dimension is 1.
    """

    model_name = FAKE_JUDGE_MODEL
    model_family: str | None = None
    reasoning: str | None = None
    temperature: float | None = None

    def judge(self, item: JudgeItem) -> JudgeVerdict:
        identifiers = set(_IDENTIFIER.findall(item.expected_answer))
        found = {token for token in identifiers if token in item.answer}
        correctness = 2 if found == identifiers else 1 if found else 0
        return JudgeVerdict(JudgeScores(correctness, 1, 1, 1, 1), None, self.model_name, 0.0)


def check_families(generation_family: str | None, judge_family: str | None) -> None:
    """Refuse a judge of the generation model's own family, or an unknown family."""
    if not generation_family or not judge_family:
        raise ValueError(
            "an official run needs the model family of both the generator and the "
            "judge (GENERATION_MODEL_FAMILY, JUDGE_MODEL_FAMILY)"
        )
    if generation_family.casefold() == judge_family.casefold():
        raise ValueError(
            f"the judge must be of another model family than the generator; both are "
            f"{generation_family!r}"
        )


def answer_level(score: float) -> int:
    """The deterministic answer score on the judge's three levels: 0 when
    it is 0, 2 when it is exactly 1, and 1 for anything between."""
    if score == 0:
        return 0
    return 2 if score == 1 else 1


@dataclass(frozen=True, slots=True)
class Agreement:
    """Agreement of the judge's correctness with the answer level over
    ``n`` judged repeats: exact three-level agreement and the linearly
    weighted kappa; None where it is undefined."""

    n: int
    agreement: float | None
    weighted_kappa: float | None


def agreement(pairs: Sequence[tuple[int, int]]) -> Agreement:
    """Exact agreement and Cohen's kappa with linear weights over the
    levels 0, 1 and 2 of (answer level, judge correctness) pairs.

    The kappa is computed as one minus observed over expected linear
    disagreement (|i - j|), which equals the agreement-weight form with
    weights 1 - |i - j| / 2. It is None when the expected disagreement is
    0, which happens when both raters use one and the same level. The
    sums are integers, so that test is exact.
    """
    n = len(pairs)
    if n == 0:
        return Agreement(0, None, None)
    observed = sum(a == b for a, b in pairs) / n
    levels_a = Counter(a for a, _ in pairs)
    levels_b = Counter(b for _, b in pairs)
    expected = sum(
        count_a * count_b * abs(a - b)
        for a, count_a in levels_a.items()
        for b, count_b in levels_b.items()
    )
    if expected == 0:
        return Agreement(n, observed, None)
    disagreement = n * sum(abs(a - b) for a, b in pairs)
    return Agreement(n, observed, 1 - disagreement / expected)


def judge_pairs(
    results: Iterable[tuple[str, RunScore | None]],
) -> dict[str, list[tuple[int, int]]]:
    """(answer level, judge correctness) for every judged repeat with a
    deterministic answer score, keyed "answered" or "abstained" by its
    verdict; a repeat without a score (failed generation) is left out."""
    pairs: dict[str, list[tuple[int, int]]] = {"answered": [], "abstained": []}
    for verdict, score in results:
        if (
            score is None
            or score.answer is None
            or score.judge is None
            or score.judge.scores is None
        ):
            continue
        key = "abstained" if is_abstention(verdict) else "answered"
        pairs[key].append((answer_level(score.answer), score.judge.scores.correctness))
    return pairs
