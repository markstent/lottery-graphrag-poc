"""CLI entry point: ``uv run python -m app.datasets``.

Generates one deterministic world, validates it and writes Parquet datasets
plus a reproducibility manifest under data/generated/.
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

_ALLOWED_PROFILES = ("tiny", "dev")  # demo/stress scaling requires HITL-03 approval


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.datasets", description=__doc__)
    parser.add_argument("--profile", choices=_ALLOWED_PROFILES, default="dev")
    parser.add_argument("--world-seed", type=int, default=2026)
    parser.add_argument("--scenario-seed", type=int, default=0)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for generated datasets and the manifest.",
    )
    args = parser.parse_args(argv)

    if args.profile not in PROFILES:
        parser.error(f"unknown profile {args.profile}")
    if args.profile in ("demo", "stress"):
        parser.error("demo and stress profiles require HITL-03 approval (scaling is gated)")

    config = GenerationConfig(
        profile=args.profile, world_seed=args.world_seed, scenario_seed=args.scenario_seed
    )
    world = build_world(config)

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

    print(f"generated {config.profile} world seed={config.world_seed} into {world_dir}")
    for name in sorted(world.tables):
        print(f"  {name}: {len(world.tables[name])} rows")
    print(f"manifest: {manifest_path}")
    print(f"data dictionary: {dictionary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
