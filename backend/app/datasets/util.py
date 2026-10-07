"""Small deterministic helpers shared by the generators."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

MONEY_QUANTUM = Decimal("0.01")


def money(minor_units: int) -> Decimal:
    """Convert integer minor units to a decimal amount."""
    return (Decimal(minor_units) / 100).quantize(MONEY_QUANTUM)


def chunk_text(body: str, sentences_per_chunk: int = 2) -> list[str]:
    """Split document text into sentence-grouped chunks."""
    sentences = [s.strip() for s in body.split(".") if s.strip()]
    chunks = [
        ". ".join(sentences[i : i + sentences_per_chunk]) + "."
        for i in range(0, len(sentences), sentences_per_chunk)
    ]
    return chunks if chunks else [body]


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
