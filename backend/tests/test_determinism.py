"""Deterministic generation contract (docs/reference/01 section 4)."""

from __future__ import annotations

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.world import build_world


@pytest.fixture(scope="module")
def world_config() -> GenerationConfig:
    return GenerationConfig(profile="tiny", world_seed=42, scenario_seed=7)


def test_identical_seeds_reproduce_identical_worlds(world_config: GenerationConfig) -> None:
    first = build_world(world_config)
    second = build_world(world_config)

    assert first.tables == second.tables
    assert first.manifest["row_counts"] == second.manifest["row_counts"]
    assert first.manifest["provenance"] == second.manifest["provenance"]


def test_manifest_records_full_determinism_metadata(world_config: GenerationConfig) -> None:
    world = build_world(world_config)

    assert world.manifest["generator_version"]
    assert world.manifest["profile"] == "tiny"
    assert world.manifest["world_seed"] == 42
    assert world.manifest["scenario_seed"] == 7


def test_different_seed_changes_activity(world_config: GenerationConfig) -> None:
    first = build_world(world_config)
    second = build_world(GenerationConfig(profile="tiny", world_seed=43, scenario_seed=7))

    assert first.tables["tickets"] != second.tables["tickets"]
    # Master data is fixed and must not drift between worlds.
    assert first.tables["markets"] == second.tables["markets"]
    assert first.tables["games"] == second.tables["games"]


def test_profiles_scale_operational_volumes() -> None:
    from app.datasets.config import DEMO, DEV, TINY

    assert (TINY.incidents, TINY.campaigns_per_market, TINY.experiments) == (25, 3, 6)
    assert DEV.incidents > TINY.incidents
    assert DEMO.incidents > DEV.incidents


def test_generator_version_is_v2() -> None:
    from app.datasets.config import GENERATOR_VERSION

    assert GENERATOR_VERSION == "0.2.0"
