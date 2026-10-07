"""Evaluation-only namespace (ADR-008).

Nothing outside this package may import these modules. The truth-ledger
loader lives here so retrieval code has no sanctioned path to evaluator
truth; tests/test_truth_ledger_isolation.py enforces the boundary.
"""

from app.evaluation.truth_ledger import TruthLedger, TruthScenario, load_ledger

__all__ = ["TruthLedger", "TruthScenario", "load_ledger"]
