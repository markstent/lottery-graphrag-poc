"""CLI entry point: ``uv run python -m app.datasets``.

Generates one deterministic world, plants the enabled scenarios, validates
the combined world and writes Parquet datasets plus a reproducibility
manifest under data/generated/. The evaluator-only ledger is written by the
scenario package into the isolated truth directory (ADR-008); this module
never reads it back.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.datasets.config import DEFAULT_OUTPUT_DIR, PROFILES, GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.validation import validate_world
from app.datasets.world import TABLE_SCHEMAS, build_data_dictionary, build_world
from app.scenarios.engine import apply_scenarios
from app.scenarios.ledger import DEFAULT_TRUTH_PATH, build_ledger, write_ledger

_ALLOWED_PROFILES = ("tiny", "dev", "demo")  # stress scaling remains gated

# Demo worlds must not overwrite the development world's evaluator ledger;
# generate them with make generate-demo-data (separate --truth-path).


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.datasets", description=__doc__)
    parser.add_argument("--profile", choices=_ALLOWED_PROFILES, default="dev")
    parser.add_argument("--world-seed", type=int, default=2026)
    parser.add_argument("--scenario-seed", type=int, default=2026)
    parser.add_argument(
        "--no-scenarios",
        action="store_true",
        help="Generate the baseline world without planted scenarios.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for generated datasets and the manifest.",
    )
    parser.add_argument(
        "--truth-path",
        type=Path,
        default=DEFAULT_TRUTH_PATH,
        help=argparse.SUPPRESS,  # evaluator-only location; surfaced for tests
    )
    args = parser.parse_args(argv)

    if args.profile not in PROFILES:
        parser.error(f"unknown profile {args.profile}")
    if args.profile == "stress":
        parser.error("the stress profile is still gated (not needed for the POC)")
    if args.profile == "demo" and args.truth_path == DEFAULT_TRUTH_PATH:
        parser.error(
            "demo generation must write a separate evaluator ledger via "
            "--truth-path (see make generate-demo-data)"
        )

    config = GenerationConfig(
        profile=args.profile, world_seed=args.world_seed, scenario_seed=args.scenario_seed
    )
    world = build_world(config)

    applied = [] if args.no_scenarios else apply_scenarios(world)

    errors = validate_world(world)
    if errors:
        for error in errors[:20]:
            print(f"validation error: {error}", file=sys.stderr)
        print(f"validation failed with {len(errors)} errors; nothing written", file=sys.stderr)
        return 1

    world_dir = args.output_dir / f"{config.profile}-seed{config.world_seed}"
    write_world(world_dir, TABLE_SCHEMAS, world.tables)
    manifest_path = world_dir / "_manifest.json"
    manifest_path.write_text(json.dumps(world.manifest, indent=2, sort_keys=True) + "\n")
    dictionary_path = world_dir / "_data_dictionary.json"
    dictionary_path.write_text(json.dumps(build_data_dictionary(), indent=2) + "\n")

    ledger_path = None
    if applied:
        ledger_path = write_ledger(args.truth_path, build_ledger(applied, world))

    print(f"generated {config.profile} world seed={config.world_seed} into {world_dir}")
    for name in sorted(world.tables):
        print(f"  {name}: {len(world.tables[name])} rows")
    for outcome in applied:
        print(f"  scenario {outcome.spec.scenario_id}: {outcome.spec.scenario_type} planted")
    print(f"manifest: {manifest_path}")
    print(f"data dictionary: {dictionary_path}")
    if ledger_path is not None:
        print(f"truth ledger (evaluator only): {ledger_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
