"""Write the golden-hash fixture pinning cross-process world determinism.

Run deliberately when GENERATOR_VERSION (or the ontology or ledger version) changes:
    uv run python -m scripts.golden --profile tiny --world-seed 7 --scenario-seed 7 \
        --out tests/fixtures/golden/tiny-seed7.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from app.datasets.config import GENERATOR_VERSION
from app.ontology import ONTOLOGY_VERSION
from app.scenarios.ledger import LEDGER_VERSION

BACKEND = Path(__file__).resolve().parent.parent


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--world-seed", type=int, required=True)
    parser.add_argument("--scenario-seed", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        subprocess.run(
            [
                sys.executable,
                "-m",
                "app.datasets",
                "--profile",
                args.profile,
                "--world-seed",
                str(args.world_seed),
                "--scenario-seed",
                str(args.scenario_seed),
                "--output-dir",
                str(tmp_path),
                "--truth-path",
                str(tmp_path / "ledger.json"),
            ],
            check=True,
            cwd=BACKEND,
            capture_output=True,
        )
        world_dir = tmp_path / f"{args.profile}-seed{args.world_seed}"
        manifest = json.loads((world_dir / "_manifest.json").read_text())
        manifest.pop("generated_at")
        golden = {
            "generator_version": GENERATOR_VERSION,
            "ontology_version": ONTOLOGY_VERSION,
            "ledger_version": LEDGER_VERSION,
            "tables": {p.stem: _sha256(p) for p in sorted(world_dir.glob("*.parquet"))},
            "manifest_excluding_generated_at": hashlib.sha256(
                json.dumps(manifest, sort_keys=True).encode()
            ).hexdigest(),
            "ledger": _sha256(tmp_path / "ledger.json"),
        }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(golden, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
