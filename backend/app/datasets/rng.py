"""Deterministic random streams.

Each table generator draws from its own stream seeded by a structured string.
CPython seeds ``random.Random`` from strings via a stable hash, so streams are
reproducible across runs and platforms for a given generator_version.
"""

from __future__ import annotations

import random

from app.datasets.config import GENERATOR_VERSION


def stream(world_seed: int, name: str) -> random.Random:
    """Independent stable RNG stream for one generator component."""
    return random.Random(f"scx:{GENERATOR_VERSION}:{world_seed}:{name}")
