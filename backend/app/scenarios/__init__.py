"""Scenario engine (Phase 5, docs/reference/04-scenario-catalogue.md).

Plants deterministic hidden patterns into a generated world and produces the
evaluator-only truth ledger. The catalogue and the applied scenario
configuration are not secret (they are recorded in the dataset manifest);
only the truth ledger itself is evaluator-only (docs/reference/04 section 19, ADR-008).
"""

from app.scenarios.catalogue import SCENARIO_CATALOGUE, ScenarioSpec
from app.scenarios.engine import ScenarioOutcome, apply_scenarios

__all__ = ["SCENARIO_CATALOGUE", "ScenarioOutcome", "ScenarioSpec", "apply_scenarios"]
