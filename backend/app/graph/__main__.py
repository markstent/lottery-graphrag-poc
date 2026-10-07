"""CLI entry point: ``uv run python -m app.graph``.

Ingests a generated dataset into Neo4j with provenance and idempotent
merges. Requires a reachable Neo4j instance (``make services-up``).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from neo4j.exceptions import Neo4jError, ServiceUnavailable

from app.graph import mapping
from app.graph.config import DEFAULT_DATASET_DIR, from_env
from app.graph.ingest import ingest


def main(argv: list[str] | None = None) -> int:
    """Run one ingestion and print the resulting counts."""
    parser = argparse.ArgumentParser(prog="app.graph", description=__doc__)
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET_DIR,
        help="Generated dataset directory (Parquet tables + manifest).",
    )
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Delete all existing graph content before ingesting.",
    )
    args = parser.parse_args(argv)

    config = from_env()
    version = mapping.ingestion_version_now()
    try:
        stats = ingest(args.dataset, config, ingestion_version=version, wipe=args.wipe)
    except (ServiceUnavailable, Neo4jError) as error:
        print(f"ingestion failed: {error}", file=sys.stderr)
        return 1

    print(f"ingestion {stats.ingestion_version} from {args.dataset}")
    for label in sorted(stats.nodes):
        print(f"  nodes {label}: {stats.nodes[label]}")
    for rel_type, label_a, label_b, count in sorted(stats.relationships):
        print(f"  rels ({label_a})-[:{rel_type}]->({label_b}): {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
