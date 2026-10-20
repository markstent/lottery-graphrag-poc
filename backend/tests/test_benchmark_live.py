"""Benchmark v2 smoke run against the live services.

Opt-in: GRAPH_E2E=1, VECTOR_E2E=1 and LIVE_WORLD_E2E=1.

Runs :func:`run_benchmark` as ``make run-smoke`` does, on the presentation
world (seed 2026) only and one instance per logical question, so every
stratum is represented: Ollama embeds the queries, Qdrant serves the
collection, Neo4j holds the graph, and the fake generator and fake judge
answer. The run must write its three files, label itself a scorer smoke
test, publish the summary v2 schema, and leave the presentation graph in
Neo4j. The presentation world, its collection and its frozen bank must
exist (``make generate-dev-data ingest-graph index-vector ground-bank``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.config import GraphConfig
from app.evaluation.official import PRESENTATION_SEED, run_benchmark, world_paths
from app.evaluation.report import OVERALL, SMOKE_HEADLINE, STRATUM_KEYS, SUMMARY_SCHEMA_VERSION
from app.evaluation.runner import PIPELINES, SMOKE_LABEL
from app.graph.statements import label_count_statement
from neo4j import GraphDatabase

from tests import live

# It re-ingests Neo4j and needs the presentation world, its bank and Ollama.
pytestmark = live.only_with(live.GRAPH, live.VECTOR, live.WORLD)

LIMIT = 1


@pytest.fixture(scope="module")
def smoke_run(tmp_path_factory: pytest.TempPathFactory) -> Path:
    paths = world_paths(PRESENTATION_SEED)
    live.require_paths(paths.world_dir, paths.ledger_path, paths.bank_path)
    live.require_neo4j()
    out = tmp_path_factory.mktemp("smoke-live") / "run"
    run_benchmark("smoke", (PRESENTATION_SEED,), repeats=1, out_dir=out, limit=LIMIT)
    return out


def _read(path: Path) -> dict[str, Any]:
    payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return payload


def test_smoke_run_writes_its_files(smoke_run: Path) -> None:
    for name in ("results.json", "summary.json", "report.md"):
        assert (smoke_run / name).stat().st_size > 0
    assert SMOKE_LABEL in (smoke_run / "report.md").read_text(encoding="utf-8")


def test_summary_is_schema_v2_and_labelled(smoke_run: Path) -> None:
    summary = _read(smoke_run / "summary.json")
    assert summary["schema_version"] == SUMMARY_SCHEMA_VERSION
    assert summary["run_kind"] == "smoke"
    assert summary["label"] == SMOKE_LABEL
    assert summary["headlines"] == [SMOKE_HEADLINE]
    assert summary["worlds"] == [PRESENTATION_SEED]
    assert summary["selection"] == {"strata": None, "limit": LIMIT}
    assert summary["anchor_resolution_basis"] == {
        "A": "selection",
        "B": "resolution",
        "C": "resolution",
    }

    counts = summary["instances"]["per_world"][str(PRESENTATION_SEED)]
    assert summary["instances"]["total"] == counts
    assert set(counts) == {*STRATUM_KEYS, OVERALL}
    assert counts[OVERALL] == sum(counts[key] for key in STRATUM_KEYS)
    for key in STRATUM_KEYS:
        assert counts[key] >= 1, f"stratum {key} has no instance"

    assert set(summary["metrics"]) == {*STRATUM_KEYS, OVERALL}
    overall = summary["metrics"][OVERALL]
    for metric in ("evidence_f1", "answer", "latency_ms", "context_tokens"):
        assert set(overall[metric]) == set(PIPELINES)
    # Every repeat has a latency and a context size; evidence F1 skips the
    # single-fact stratum, whose answers carry no evidence claims.
    for tag in PIPELINES:
        assert overall["latency_ms"][tag]["n"] == counts[OVERALL]
        assert overall["context_tokens"][tag]["n"] == counts[OVERALL]

    failures = summary["failures"]
    assert failures["repeats"] == dict.fromkeys(PIPELINES, counts[OVERALL])
    assert failures["generation"] == dict.fromkeys(PIPELINES, 0)
    assert failures["judge"] == dict.fromkeys(PIPELINES, 0)

    record = summary["reproducibility"]
    assert record["run"]["git_sha"]
    assert record["run"]["started_at"]
    assert [world["world_seed"] for world in record["worlds"]] == [PRESENTATION_SEED]
    assert json.loads(json.dumps(summary, allow_nan=False)) == summary


def test_presentation_graph_is_restored(smoke_run: Path) -> None:
    expected = _read(world_paths(PRESENTATION_SEED).world_dir / "_graph_stats.json")["nodes"]
    config = GraphConfig.from_env()
    with GraphDatabase.driver(config.uri, auth=(config.user, config.password)) as driver:
        found = {
            label: driver.execute_query(
                label_count_statement(label), database_=config.database
            ).records[0]["count"]
            for label in expected
        }
        records, _, _ = driver.execute_query(
            "MATCH (n) RETURN count(n) AS nodes", database_=config.database
        )
    assert found == expected
    assert records[0]["nodes"] == sum(expected.values())
