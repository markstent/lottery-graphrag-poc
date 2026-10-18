"""CLI entry point: ``uv run python -m app.graph``.

Ingests a generated dataset into Neo4j with provenance and idempotent
merges, then writes ``_graph_stats.json`` beside the dataset. Requires a
reachable Neo4j instance (``make services-up``).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from neo4j.exceptions import Neo4jError, ServiceUnavailable

from app.graph import mapping
from app.graph.config import DEFAULT_DATASET_DIR, from_env
from app.graph.ingest import ingest

GRAPH_STATS_FILE = "_graph_stats.json"


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

    stats_path = args.dataset / GRAPH_STATS_FILE
    stats_path.write_text(json.dumps(stats.to_json(), indent=2) + "\n", encoding="utf-8")

    print(
        f"ingestion {stats.ingestion_version} (labels {stats.label_version}, "
        f"ontology {stats.ontology_version}) from {args.dataset}"
    )
    for label in sorted(stats.nodes):
        print(f"  nodes {label}: {stats.nodes[label]}")
    for rel_type, label_a, label_b, count in sorted(stats.relationships):
        print(f"  rels ({label_a})-[:{rel_type}]->({label_b}): {count}")
    print(f"stats written to {stats_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
