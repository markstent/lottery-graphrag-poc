"""Truth-ledger construction and writing (docs/04 section 19, ADR-008).

The ledger is written once per generation to ``DEFAULT_TRUTH_PATH``
(gitignored) and is the only artefact that carries scenario truth. This
module is the single sanctioned writer; only the evaluator package may load
the file back (enforced by the truth-ledger isolation tests).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.datasets.config import REPO_ROOT
from app.datasets.world import World
from app.scenarios.engine import ScenarioOutcome

LEDGER_VERSION = "2"
DEFAULT_TRUTH_PATH = REPO_ROOT / "data" / "truth" / "ledger.json"


def build_ledger(outcomes: list[ScenarioOutcome], world: World) -> dict[str, Any]:
    """Evaluator-only truth records for one generated world."""
    return {
        "ledger_version": LEDGER_VERSION,
        "scenario_seed": world.config.scenario_seed,
        "world": {
            "profile": world.config.profile,
            "world_seed": world.config.world_seed,
            "generator_version": world.manifest["generator_version"],
        },
        "scenarios": [
            {
                "scenario_id": outcome.spec.scenario_id,
                "scenario_type": outcome.spec.scenario_type,
                "enabled": True,
                "strength": outcome.spec.strength,
                "noise_level": outcome.spec.noise_level,
                "start_date": outcome.start_date.isoformat(),
                "duration_days": outcome.duration_days,
                "affected_markets": list(outcome.affected_markets),
                "affected_games": list(outcome.affected_games),
                "affected_segments": [],
                "expected_signals": list(outcome.spec.expected_signals),
                "benchmark_questions": list(outcome.spec.benchmark_questions),
                "required_evidence": list(outcome.required_evidence),
                "truth": outcome.truth,
            }
            for outcome in outcomes
        ],
    }


def write_ledger(path: Path, ledger: dict[str, Any]) -> Path:
    """Write the ledger to the evaluator-only truth directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path
