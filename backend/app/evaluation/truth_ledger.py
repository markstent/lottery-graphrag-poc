"""Evaluator-only truth-ledger loader (ADR-008).

The only sanctioned reader of ``data/truth/ledger.json``. Retrieval, API,
dataset, scenario and graph modules must never import this package; the
boundary is enforced by a static scan in tests/test_truth_ledger_isolation.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.scenarios.ledger import DEFAULT_TRUTH_PATH


class WorldRef(BaseModel):
    """The world a ledger belongs to (reproducibility record)."""

    profile: str
    world_seed: int
    generator_version: str


class TruthScenario(BaseModel):
    """One scenario's truth record (docs/04 sections 2 and 19)."""

    scenario_id: str
    scenario_type: str
    enabled: bool
    strength: float
    noise_level: str
    start_date: str
    duration_days: int
    affected_markets: list[str]
    affected_games: list[str]
    affected_segments: list[str]
    expected_signals: list[str]
    benchmark_questions: list[str]
    required_evidence: list[str]
    truth: dict[str, Any]


class TruthLedger(BaseModel):
    """Root of the evaluator-only truth ledger."""

    ledger_version: str
    scenario_seed: int
    world: WorldRef
    scenarios: list[TruthScenario] = Field(default_factory=list)


def load_ledger(path: Path | None = None) -> TruthLedger:
    """Load and validate the truth ledger. Evaluator use only."""
    ledger_path = path or DEFAULT_TRUTH_PATH
    payload = json.loads(ledger_path.read_text(encoding="utf-8"))
    return TruthLedger.model_validate(payload)
