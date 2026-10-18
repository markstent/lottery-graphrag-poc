"""Scenario application orchestration.

Runs the enabled injectors in fixed catalogue order, each with its own RNG
stream keyed by ``scenario_seed + scenario_id``, records planted row counts
for volume validation and planted ids per table in the truth, and publishes
the applied configuration (not the truth) into the dataset manifest.
After all injectors, daily KPIs are re-derived from the planted tables and
every manifest row count is refreshed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from app.datasets.rng import stream
from app.datasets.world import World, derive_kpis
from app.scenarios.catalogue import BY_ID, ENABLED, ScenarioSpec
from app.scenarios.plant import PLANTERS
from app.scenarios.planter import ScenarioPlanter


@dataclass(frozen=True, slots=True)
class ScenarioOutcome:
    """One applied scenario: configuration plus evaluator-only truth."""

    spec: ScenarioSpec
    truth: dict[str, Any]
    required_evidence: tuple[str, ...]
    affected_markets: tuple[str, ...]
    affected_games: tuple[str, ...]
    start_date: date
    duration_days: int
    planted_rows: dict[str, int]


def apply_scenarios(world: World) -> list[ScenarioOutcome]:
    """Plant every enabled scenario into the world, in catalogue order."""
    outcomes: list[ScenarioOutcome] = []
    for scenario_id in ENABLED:
        spec = BY_ID[scenario_id]
        planter = PLANTERS.get(scenario_id)
        if planter is None:
            raise RuntimeError(
                f"scenario {scenario_id} is enabled in the catalogue but has no injector"
            )
        rng = stream(world.config.scenario_seed, f"scenario-{scenario_id}")
        plan = ScenarioPlanter(world, rng, spec)
        planter(plan)
        for table, count in plan.planted_rows.items():
            world.planted[table] = world.planted.get(table, 0) + count
        outcomes.append(
            ScenarioOutcome(
                spec=spec,
                truth={**plan.truth, "planted_ids": plan.planted_ids},
                required_evidence=tuple(plan.required_evidence),
                affected_markets=tuple(plan.affected_markets),
                affected_games=tuple(plan.affected_games),
                start_date=plan.start_date,
                duration_days=plan.duration_days,
                planted_rows=dict(plan.planted_rows),
            )
        )

    baseline_kpi_rows = world.manifest["row_counts"]["kpi_daily"]
    derive_kpis(world)
    world.planted["kpi_daily"] = len(world.tables["kpi_daily"]) - baseline_kpi_rows
    world.manifest["row_counts"] = {name: len(rows) for name, rows in world.tables.items()}

    world.manifest["scenarios"] = {
        "scenario_seed": world.config.scenario_seed,
        "applied": [
            {
                "scenario_id": outcome.spec.scenario_id,
                "scenario_type": outcome.spec.scenario_type,
                "strength": outcome.spec.strength,
                "noise_level": outcome.spec.noise_level,
                "planted_rows": outcome.planted_rows,
            }
            for outcome in outcomes
        ],
    }
    return outcomes
