"""Cross-process determinism: a fresh interpreter must reproduce the committed hashes.

Regenerate the fixture deliberately with:
    uv run python -m scripts.golden --profile tiny --world-seed 7 --scenario-seed 7 \
        --out tests/fixtures/golden/tiny-seed7.json
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from app.datasets.config import GENERATOR_VERSION

BACKEND = Path(__file__).resolve().parent.parent
FIXTURE = BACKEND / "tests" / "fixtures" / "golden" / "tiny-seed7.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest_sha256(path: Path) -> str:
    manifest = json.loads(path.read_text())
    manifest.pop("generated_at")  # wall-clock, legitimately differs per run
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()


def test_fresh_process_regeneration_matches_golden_hashes(tmp_path: Path) -> None:
    golden = json.loads(FIXTURE.read_text())
    assert golden["generator_version"] == GENERATOR_VERSION, (
        "bump the fixture with scripts/golden.py when the generator changes"
    )
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
    for table, digest in golden["tables"].items():
        assert _sha256(world_dir / f"{table}.parquet") == digest, table
    assert (
        _manifest_sha256(world_dir / "_manifest.json") == golden["manifest_excluding_generated_at"]
    )
    assert _sha256(tmp_path / "ledger.json") == golden["ledger"]
