"""Deterministic answer checks and citation metrics (benchmark v2).

Number, set and token checks read the verdict and the answer together, so a
fact stated only in the verdict counts; the verdict check reads the verdict
only. Every check scores 0..1 from the text alone: no model is involved.

Scorer 2.1.0 adds one rule: a token whose whole text is an ISO date also
matches when a time follows it ("2025-10-07T09:30"). `is_abstention` reads a
verdict that opens with the word "unknown". `groundedness` (D-088) is a
descriptive measure of whether the ids, dates and numbers an answer states
come from the blocks it cites; it reads no answer key.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal, cast

from app.evaluation.claims import Claim, word_pattern

_CITATION = r"\[\d+(?:\s*,\s*\d+)*\]"
_CITATION_PATTERN = re.compile(_CITATION)
_CITATIONS_ONLY = re.compile(rf"(?:\s*{_CITATION})+\s*")
_IDENTIFIER_PATTERN = re.compile(r"\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b")
_MONTH = (
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December"
    r"|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?"
)
# Month number by the first three letters of any name `_MONTH` accepts.
_MONTH_NUMBERS = {
    name: number
    for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1
    )
}
_MONTH_WORD = re.compile(r"[a-z]{3,}")
_DAY = r"\d{1,2}(?:st|nd|rd|th)?"
_DATE_PATTERNS = (
    re.compile(
        r"\d{4}-\d{2}-\d{2}"
        r"(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?"
    ),
    re.compile(rf"(?<!\w){_DAY}\s+{_MONTH},?\s+\d{{4}}(?!\w)", re.IGNORECASE),
    re.compile(rf"(?<!\w){_MONTH}\s+{_DAY},?\s+\d{{4}}(?!\w)", re.IGNORECASE),
)
# A number is bounded by non-word characters; a hyphen between word characters
# joins a word ("REC-1234"); a "-" right before the digits after start, space or
# "(" is a sign. The atomic group stops "2.50GBP" backtracking into "2".
_NUMBER_PATTERN = re.compile(
    r"(?:(?<![^\s(])-|(?<![\w.])(?<!\w-))(?>\d+(?:,\d{3}(?!\d))*(?:[.,]\d+)?)(?!\w)"
)
_THOUSANDS_SEPARATOR = re.compile(r",(?=\d{3}(?!\d))")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+|\s*\n\s*")
UNIT_SYMBOLS = {"GBP": "£", "EUR": "€", "CZK": "Kč", "%": "%"}
_VERDICTS = ("yes", "no")
_ABSTENTION_PATTERN = re.compile(r"unknown(?!\w)")
# Scorer 2.1.0: an expected ISO date token also matches when a time follows it
# ("2025-10-07T00:00:00"), on casefolded text; every 2.0.0 match still matches.
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_TIME_SUFFIX = r"(?:t\d{2}:\d{2}(?::\d{2})?(?!\d))?"


@dataclass(frozen=True, slots=True)
class NumberCheck:
    """The answer states `value`, read next to `unit` when the answer uses it."""

    value: str
    unit: str | None

    def to_payload(self) -> dict[str, object]:
        return {"kind": "number", "value": self.value, "unit": self.unit}


@dataclass(frozen=True, slots=True)
class SetCheck:
    """The answer names exactly `expected` out of `universe` ((id, aliases) by id)."""

    expected: frozenset[str]
    universe: tuple[tuple[str, tuple[str, ...]], ...]

    @classmethod
    def of(cls, expected: Iterable[str], universe: Mapping[str, Sequence[str]]) -> SetCheck:
        return cls(
            frozenset(expected),
            tuple((key, tuple(aliases)) for key, aliases in sorted(universe.items())),
        )

    def to_payload(self) -> dict[str, object]:
        return {
            "kind": "set",
            "expected": sorted(self.expected),
            "universe": {key: list(aliases) for key, aliases in self.universe},
        }


@dataclass(frozen=True, slots=True)
class TokenCheck:
    """The answer names `expected` or one of its aliases."""

    expected: str
    aliases: tuple[str, ...] = ()

    def to_payload(self) -> dict[str, object]:
        return {"kind": "token", "expected": self.expected, "aliases": list(self.aliases)}


@dataclass(frozen=True, slots=True)
class VerdictCheck:
    """The verdict opens with `expected`."""

    expected: Literal["yes", "no"]

    def to_payload(self) -> dict[str, object]:
        return {"kind": "verdict", "expected": self.expected}


Check = NumberCheck | SetCheck | TokenCheck | VerdictCheck


@dataclass(frozen=True, slots=True)
class CitationMetrics:
    """Share of citations that point at a claim carrier, and share of
    number-bearing sentences that carry a citation; None when undefined."""

    accuracy: float | None
    numeric_citation_rate: float | None


def check_from_payload(payload: Mapping[str, object]) -> Check:
    kind = payload["kind"]
    if kind == "number":
        unit = payload["unit"]
        return NumberCheck(str(payload["value"]), None if unit is None else str(unit))
    if kind == "set":
        return SetCheck.of(
            cast(list[str], payload["expected"]),
            cast(dict[str, list[str]], payload["universe"]),
        )
    if kind == "token":
        return TokenCheck(str(payload["expected"]), tuple(cast(list[str], payload["aliases"])))
    if kind == "verdict":
        expected = payload["expected"]
        if expected not in _VERDICTS:
            raise ValueError(f"verdict check expects 'yes' or 'no', got {expected!r}")
        return VerdictCheck(cast(Literal["yes", "no"], expected))
    raise ValueError(f"unknown check kind: {kind!r}")


def check_score(check: Check, verdict: str, answer: str) -> float:
    """Score one check against an answer (0..1)."""
    if isinstance(check, VerdictCheck):
        pattern = r"\W*" + re.escape(check.expected) + r"(?!\w)"
        return 1.0 if re.match(pattern, verdict.casefold()) else 0.0
    text = verdict + "\n" + answer
    if isinstance(check, NumberCheck):
        return _number_score(check, text)
    if isinstance(check, TokenCheck):
        names = (check.expected, *check.aliases)
        return 1.0 if any(_mentions(text, name) for name in names) else 0.0
    return _set_score(check, text)


def answer_score(checks: Sequence[Check], verdict: str, answer: str) -> float | None:
    """Mean check score; None when the question has no answer checks."""
    if not checks:
        return None
    return sum(check_score(check, verdict, answer) for check in checks) / len(checks)


def scored_numbers(text: str) -> list[str]:
    """Normalised numbers in `text`, ignoring citations, identifiers and dates."""
    return [
        normalise(match.group()) for match in _NUMBER_PATTERN.finditer(_strip_non_numbers(text))
    ]


@dataclass(frozen=True, slots=True)
class GroundednessScore:
    """Whether an answer's checkable atoms (ids, dates, numbers) come from the
    blocks it cites; descriptive, model-free, and blind to the answer key.

    An atom counts once per sentence that states it. The shares are None when
    the answer states no atom outside the question: no atoms is never grounded.
    """

    atoms: int
    supported_share: float | None
    unsupported_share: float | None
    abstained: bool


def groundedness(
    question: str, verdict: str, answer: str, block_texts: Sequence[str]
) -> GroundednessScore:
    """Groundedness of `answer` over the shown blocks (block n is `block_texts[n - 1]`).

    A sentence's atoms are supported when a block that sentence cites holds
    them, and unsupported when no shown block holds them; a sentence without
    a citation inherits none. Atoms the question states are not counted.
    """
    asked = _atoms(question)
    held = [_atoms(text) for text in block_texts]
    shown = frozenset[tuple[str, str]]().union(*held)
    atoms = supported = unsupported = 0
    for sentence in _sentences(answer):
        cited = {
            int(number)
            for marker in _CITATION_PATTERN.findall(sentence)
            for number in re.findall(r"\d+", marker)
        }
        in_cited = frozenset[tuple[str, str]]().union(
            *(held[n - 1] for n in cited if 1 <= n <= len(held))
        )
        for atom in _atoms(sentence) - asked:
            atoms += 1
            supported += atom in in_cited
            unsupported += atom not in shown
    return GroundednessScore(
        atoms=atoms,
        supported_share=supported / atoms if atoms else None,
        unsupported_share=unsupported / atoms if atoms else None,
        abstained=is_abstention(verdict) and atoms == 0,
    )


def _atoms(text: str) -> frozenset[tuple[str, str]]:
    """The ids, dates (as YYYY-MM-DD) and numbers in `text`, read as the scorer reads them."""
    text = _CITATION_PATTERN.sub(" ", text)
    ids = {("id", match) for match in _IDENTIFIER_PATTERN.findall(text)}
    dates = {
        ("date", _iso_date(match.group()))
        for pattern in _DATE_PATTERNS
        for match in pattern.finditer(text)
    }
    numbers = {("number", number) for number in scored_numbers(text)}
    return frozenset(ids | dates | numbers)


def _iso_date(text: str) -> str:
    """A date matched by `_DATE_PATTERNS` as YYYY-MM-DD."""
    if _ISO_DATE.match(text):
        return text[:10]
    month = _MONTH_WORD.search(text.casefold())
    if month is None:
        raise ValueError(f"not a date: {text!r}")
    day, year = re.findall(r"\d+", text)
    return f"{year}-{_MONTH_NUMBERS[month.group()[:3]]:02d}-{int(day):02d}"


def citation_metrics(
    answer: str,
    cited_blocks: Sequence[int],
    block_carriers: Sequence[frozenset[str]],
    claims: Sequence[Claim],
) -> CitationMetrics:
    """Citation accuracy and numeric citation rate for one answer.

    `cited_blocks` are the 1-based context block numbers the answer cites;
    a citation to a block outside the context counts as inaccurate.
    """
    accuracy = None
    if cited_blocks and claims:
        carriers = frozenset[str]().union(*(claim.carriers for claim in claims))
        accurate = sum(
            1
            for block in cited_blocks
            if 1 <= block <= len(block_carriers) and block_carriers[block - 1] & carriers
        )
        accuracy = accurate / len(cited_blocks)
    numeric = [sentence for sentence in _sentences(answer) if scored_numbers(sentence)]
    rate = None
    if numeric:
        rate = sum(1 for s in numeric if _CITATION_PATTERN.search(s)) / len(numeric)
    return CitationMetrics(accuracy=accuracy, numeric_citation_rate=rate)


def _sentences(answer: str) -> list[str]:
    """Sentences and lines; a segment of citation markers only joins the one before."""
    sentences: list[str] = []
    for segment in _SENTENCE_BREAK.split(answer):
        if sentences and _CITATIONS_ONLY.fullmatch(segment):
            sentences[-1] += " " + segment
        elif segment:
            sentences.append(segment)
    return sentences


def _number_score(check: NumberCheck, text: str) -> float:
    cleaned = _strip_non_numbers(text)
    matches = list(_NUMBER_PATTERN.finditer(cleaned))
    if check.unit is not None:
        adjacent = [match for match in matches if _unit_adjacent(cleaned, match, check.unit)]
        matches = adjacent or matches
    candidates = {normalise(match.group()) for match in matches}
    if normalise(check.value) not in candidates:
        return 0.0
    return 1.0 if len(candidates) == 1 else 0.5


def _unit_adjacent(text: str, match: re.Match[str], unit: str) -> bool:
    forms = sorted({unit, UNIT_SYMBOLS.get(unit, unit)})
    units = "|".join(re.escape(form) for form in forms)
    after = re.compile(rf" ?(?:{units})(?!\w)")
    before = re.compile(rf"(?<!\w)(?:{units}) ?$")
    return bool(after.match(text, match.end()) or before.search(text, 0, match.start()))


def _strip_non_numbers(text: str) -> str:
    for pattern in (_CITATION_PATTERN, _IDENTIFIER_PATTERN, *_DATE_PATTERNS):
        text = pattern.sub(" ", text)
    return text


def _set_score(check: SetCheck, text: str) -> float:
    alias_owners = Counter(
        alias for _, aliases in check.universe for alias in {a.casefold() for a in aliases}
    )
    predicted = {
        key
        for key, aliases in check.universe
        if _mentions(text, key)
        or any(alias_owners[a.casefold()] == 1 and _mentions(text, a) for a in aliases)
    }
    hits = len(predicted & check.expected)
    if not hits:
        return 0.0
    precision = hits / len(predicted)
    recall = hits / len(check.expected)
    return 2 * precision * recall / (precision + recall)


def is_abstention(verdict: str) -> bool:
    """True when the verdict opens with the whole word "unknown"."""
    return _ABSTENTION_PATTERN.match(verdict.strip().casefold()) is not None


def _mentions(text: str, name: str) -> bool:
    if _ISO_DATE.fullmatch(name):
        pattern = re.compile(rf"(?<!\w){re.escape(name)}{_TIME_SUFFIX}(?!\w)")
    else:
        pattern = word_pattern(name)
    return pattern.search(text.casefold()) is not None


def normalise(number: str | int | float | Decimal) -> str:
    """Canonical form of a number or its text: a comma before exactly three
    digits groups thousands, any other comma is a decimal point; trailing
    zeros are dropped ("2.50" and 2.5 both give "2.5")."""
    text = str(number)
    plain = _THOUSANDS_SEPARATOR.sub("", text).replace(",", ".")
    try:
        number = Decimal(plain)
    except InvalidOperation:
        raise ValueError(f"not a number: {text!r}") from None
    return format(number.normalize(), "f")
