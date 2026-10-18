"""Small deterministic helpers shared by the generators."""

from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

from app.datasets.distributions import CHUNK_MAX_WORDS, CHUNK_OVERLAP_SENTENCES

MONEY_QUANTUM = Decimal("0.01")

_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=\S)")
_OPENERS = "\"'([\u201c\u2018\u00ab"


def money(minor_units: int) -> Decimal:
    """Convert integer minor units to a decimal amount."""
    return (Decimal(minor_units) / 100).quantize(MONEY_QUANTUM)


def split_sentences(body: str) -> list[str]:
    """Split text at ``.``, ``!`` or ``?`` followed by whitespace and a sentence start.

    A sentence start is an uppercase letter, a digit, or an opening quote or
    bracket. Decimals and version labels contain no whitespace after the dot,
    and a lowercase continuation (``e.g. the``) is never a boundary.
    """
    text = body.strip()
    sentences: list[str] = []
    start = 0
    for match in _SENTENCE_BOUNDARY.finditer(text):
        following = text[match.end()]
        if following.isupper() or following.isdigit() or following in _OPENERS:
            sentences.append(text[start : match.start()])
            start = match.end()
    if text:
        sentences.append(text[start:])
    return sentences


def chunk_text(
    body: str,
    max_words: int = CHUNK_MAX_WORDS,
    overlap_sentences: int = CHUNK_OVERLAP_SENTENCES,
) -> list[str]:
    """Pack whole sentences into windows of at most ``max_words`` words.

    Consecutive windows share up to ``overlap_sentences`` trailing sentences.
    A sentence longer than ``max_words`` becomes its own chunk.
    """
    sentences = split_sentences(body)
    if not sentences:
        return [body]
    chunks: list[str] = []
    window: list[str] = []
    for sentence in sentences:
        words = word_count(sentence)
        if window and _window_words(window) + words > max_words:
            chunks.append(" ".join(window))
            window = window[len(window) - overlap_sentences :] if overlap_sentences else []
            while window and _window_words(window) + words > max_words:
                window.pop(0)
        window.append(sentence)
    chunks.append(" ".join(window))
    return chunks


def _window_words(window: list[str]) -> int:
    return sum(word_count(s) for s in window)


def word_count(text: str) -> int:
    return len(text.split())


def to_json(payload: dict[str, Any]) -> str:
    """Deterministic JSON serialisation for stored payloads."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def split_columns(ddl: str) -> list[tuple[str, str]]:
    """Split a DDL string into (column_name, type_text) pairs.

    Commas inside parameterised types such as DECIMAL(12,2) are not
    column separators.
    """
    depth = 0
    parts: list[str] = []
    current: list[str] = []
    for char in ddl:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    columns: list[tuple[str, str]] = []
    for part in parts:
        name, type_text = part.strip().split(" ", 1)
        columns.append((name.strip(), type_text.strip()))
    return columns
