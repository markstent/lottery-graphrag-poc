"""Deterministic answer checks and citation metrics (benchmark v2).

Number, set and token checks read the verdict and the answer together, so a
fact stated only in the verdict counts; the verdict check reads the verdict
only. Every check scores 0..1 from the text alone: no model is involved.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast

from app.evaluation.claims import Claim

_CITATION_PATTERN = re.compile(r"\[\d+(?:\s*,\s*\d+)*\]")
_IDENTIFIER_PATTERN = re.compile(r"\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b")
_DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+)?")
_NUMBER_PATTERN = re.compile(r"\d+(?:[.,]\d+)?")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+")
_UNIT_SYMBOLS = {"GBP": "£", "EUR": "€", "CZK": "Kč", "%": "%"}


@dataclass(frozen=True, slots=True)
class NumberCheck:
    """The answer states `value`, read next to `unit` when the answer uses it."""

    value: str
    unit: str | None

    def to_payload(self) -> dict[str, object]:
        return {"kind": "number", "value": self.value, "unit": self.unit}


@dataclass(frozen=True, slots=True)
class SetCheck:
    """The answer names exactly `expected` out of `universe` (id to aliases)."""

    expected: frozenset[str]
    universe: Mapping[str, tuple[str, ...]]

    def to_payload(self) -> dict[str, object]:
        return {
            "kind": "set",
            "expected": sorted(self.expected),
            "universe": {key: list(aliases) for key, aliases in sorted(self.universe.items())},
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
        universe = cast(dict[str, list[str]], payload["universe"])
        return SetCheck(
            frozenset(cast(list[str], payload["expected"])),
            {key: tuple(aliases) for key, aliases in universe.items()},
        )
    if kind == "token":
        return TokenCheck(str(payload["expected"]), tuple(cast(list[str], payload["aliases"])))
    if kind == "verdict":
        return VerdictCheck(cast(Literal["yes", "no"], payload["expected"]))
    raise ValueError(f"unknown check kind: {kind!r}")


def check_score(check: Check, verdict: str, answer: str) -> float:
    """Score one check against an answer (0..1)."""
    if isinstance(check, VerdictCheck):
        pattern = r"\s*" + re.escape(check.expected) + r"\b"
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
        _normalise_number(match.group())
        for match in _NUMBER_PATTERN.finditer(_strip_non_numbers(text))
    ]


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
    numeric = [sentence for sentence in _SENTENCE_BREAK.split(answer) if scored_numbers(sentence)]
    rate = None
    if numeric:
        rate = sum(1 for s in numeric if _CITATION_PATTERN.search(s)) / len(numeric)
    return CitationMetrics(accuracy=accuracy, numeric_citation_rate=rate)


def _number_score(check: NumberCheck, text: str) -> float:
    cleaned = _strip_non_numbers(text)
    matches = list(_NUMBER_PATTERN.finditer(cleaned))
    if check.unit is not None:
        adjacent = [match for match in matches if _unit_adjacent(cleaned, match, check.unit)]
        matches = adjacent or matches
    candidates = {_normalise_number(match.group()) for match in matches}
    if _normalise_number(check.value) not in candidates:
        return 0.0
    return 1.0 if len(candidates) == 1 else 0.5


def _unit_adjacent(text: str, match: re.Match[str], unit: str) -> bool:
    units = "|".join(re.escape(form) for form in {unit, _UNIT_SYMBOLS.get(unit, unit)})
    after = re.compile(rf" ?(?:{units})(?![A-Za-z])")
    before = re.compile(rf"(?<![A-Za-z])(?:{units}) ?$")
    return bool(after.match(text, match.end()) or before.search(text, 0, match.start()))


def _strip_non_numbers(text: str) -> str:
    for pattern in (_CITATION_PATTERN, _IDENTIFIER_PATTERN, _DATE_PATTERN):
        text = pattern.sub(" ", text)
    return text


def _set_score(check: SetCheck, text: str) -> float:
    predicted = {
        key
        for key, aliases in check.universe.items()
        if any(_mentions(text, name) for name in (key, *aliases))
    }
    hits = len(predicted & check.expected)
    if not hits:
        return 0.0
    precision = hits / len(predicted)
    recall = hits / len(check.expected)
    return 2 * precision * recall / (precision + recall)


def _mentions(text: str, name: str) -> bool:
    pattern = r"(?<![A-Za-z0-9_])" + re.escape(name) + r"(?![A-Za-z0-9_])"
    return re.search(pattern, text, flags=re.IGNORECASE) is not None


def _normalise_number(text: str) -> str:
    normalised = text.replace(",", ".").rstrip("%")
    try:
        number = float(normalised)
    except ValueError:
        return normalised
    if number == int(number):
        return str(int(number))
    return f"{number:g}"
