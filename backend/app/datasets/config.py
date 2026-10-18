"""Generation configuration and dataset profiles.

Profiles and volumes are specified in docs/01-synthetic-data-spec.md section 3.
Determinism contract (docs/01 section 4): identical
generator_version + world_seed + scenario_seed + configuration
must reproduce an equivalent dataset.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

GENERATOR_VERSION = "0.2.0"

# Repository layout anchors data at the repository root (ADR-006), independent
# of the process working directory.
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "data" / "generated"

# Fixed generation window. All business timestamps fall inside it, which makes
# generated worlds comparable and keeps regeneration deterministic.
WINDOW_START = date(2025, 1, 1)
WINDOW_DAYS = 365


@dataclass(frozen=True, slots=True)
class ProfileVolumes:
    """Row-count targets for one generated world."""

    players: int
    tickets: int
    sessions: int
    campaign_exposures: int
    retailers: int
    devices: int
    support_cases: int
    documents: int
    games_expected: int
    incidents: int
    campaigns_per_market: int
    experiments: int


# The game catalogue is canonical master data (5 families x 4 markets), so
# every profile expects 20 games; scaling a profile grows activity volume,
# never the catalogue. Demo scaling is approved (HITL-03); stress stays gated.
TINY = ProfileVolumes(200, 2_000, 800, 800, 40, 240, 60, 24, 20, 25, 3, 6)
DEV = ProfileVolumes(10_000, 250_000, 100_000, 100_000, 500, 12_000, 2_000, 250, 20, 40, 4, 8)
DEMO = ProfileVolumes(
    100_000, 5_000_000, 2_000_000, 3_000_000, 5_000, 120_000, 50_000, 2_000, 20, 120, 6, 12
)
STRESS = ProfileVolumes(
    1_000_000,
    50_000_000,
    20_000_000,
    30_000_000,
    20_000,
    1_000_000,
    500_000,
    10_000,
    20,
    400,
    8,
    16,
)

PROFILES: dict[str, ProfileVolumes] = {
    "tiny": TINY,
    "dev": DEV,
    "demo": DEMO,
    "stress": STRESS,
}


@dataclass(frozen=True, slots=True)
class GenerationConfig:
    """Full determinism record for one generated world."""

    profile: str
    world_seed: int
    # Reserved for the Phase 5 scenario engine. Recorded from day one so the
    # determinism contract never changes shape.
    scenario_seed: int = 0
