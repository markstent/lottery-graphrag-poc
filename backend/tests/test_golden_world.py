"""Cross-process determinism: a fresh interpreter must reproduce the committed hashes.

Regenerate the fixture deliberately with:
    uv run python -m scripts.golden --profile tiny --world-seed 7 --scenario-seed 7 \
        --out tests/fixtures/golden/tiny-seed7.json
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pyarrow.parquet as pq
from app.datasets.config import GENERATOR_VERSION
from app.datasets.parquet import write_world
from app.ontology import ONTOLOGY_VERSION
from app.scenarios.ledger import LEDGER_VERSION
from scripts.golden import world_hashes

BACKEND = Path(__file__).resolve().parent.parent
FIXTURE = BACKEND / "tests" / "fixtures" / "golden" / "tiny-seed7.json"


def test_fresh_process_regeneration_matches_golden_hashes(tmp_path: Path) -> None:
    golden = json.loads(FIXTURE.read_text())
    assert golden["generator_version"] == GENERATOR_VERSION, (
        "bump the fixture with scripts/golden.py when the generator changes"
    )
    assert golden["ontology_version"] == ONTOLOGY_VERSION, "regenerate with scripts/golden.py"
    assert golden["ledger_version"] == LEDGER_VERSION, "regenerate with scripts/golden.py"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "app.datasets",
            "--profile",
            "tiny",
            "--world-seed",
            "7",
            "--scenario-seed",
            "7",
            "--output-dir",
            str(tmp_path),
            "--truth-path",
            str(tmp_path / "ledger.json"),
        ],
        check=True,
        cwd=BACKEND,
        capture_output=True,
    )
    world_dir = tmp_path / "tiny-seed7"
    actual = world_hashes(world_dir, tmp_path / "ledger.json")
    expected_tables, actual_tables = set(golden["tables"]), set(actual["tables"])
    assert actual_tables == expected_tables, (
        f"missing: {sorted(expected_tables - actual_tables)}, "
        f"unexpected: {sorted(actual_tables - expected_tables)}"
    )
    for table, digest in golden["tables"].items():
        assert actual["tables"][table] == digest, (
            f"{table}: expected {digest}, got {actual['tables'][table]}"
        )
    assert actual["manifest_excluding_generated_at"] == golden["manifest_excluding_generated_at"]
    assert actual["ledger"] == golden["ledger"]


def test_parquet_is_written_with_a_platform_independent_codec(tmp_path: Path) -> None:
    # Snappy, DuckDB's default, writes different bytes on macOS and Linux for the
    # same rows, which broke the golden hashes across platforms; ZSTD does not.
    schema = "region_id VARCHAR, population INTEGER"
    (path,) = write_world(tmp_path, {"regions": schema}, {"regions": [("UK_NORTH", 7)]})
    row_group = pq.read_metadata(path).row_group(0)
    codecs = {row_group.column(i).compression for i in range(row_group.num_columns)}
    assert codecs == {"ZSTD"}
