"""Write the Results screen's official-run fixtures: test values, not results.

A whole-bank official run over three worlds built from the report tests'
hand-made results, with the same scores for A, B and C so nothing it draws
suggests a direction. The summary and the instances pass through the API's own
builders, so they have exactly the shape the API serves.
Run from backend/:
    uv run python -m scripts.fixture_official --out ../frontend/e2e/fixtures
then run prettier --write on the output in frontend/.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import tempfile
from pathlib import Path

from app.api.benchmarks import _instances, _published, _summary_out
from app.evaluation.grounding import Unavailable
from app.evaluation.report import summarize
from app.evaluation.runner import BenchmarkRun, InstanceResult, WorldRun
from tests.test_benchmark_report import _instance, _record, _result

SEEDS = (2026, 2027, 2028)
LABEL = "Fixture run (test values)"
SCORE = (0.4, 0.4)
QUESTIONS = {"H1": 6, "H2": 6, "H3": 6, "H5": 6}
NAME_ANCHORED = 3


def _world(seed: int) -> WorldRun:
    same: dict[str, list[tuple[float, float] | None]] = {tag: [SCORE] * 3 for tag in "ABC"}
    results: list[InstanceResult] = []
    for stratum, count in QUESTIONS.items():
        sub = "id_anchored" if stratum == "H2" else None
        for q in range(count):
            instance = _instance(f"{stratum}-{q}", stratum, seed, sub)
            results.append(_result(instance, same))
    for q in range(NAME_ANCHORED):
        instance = _instance(f"H2N-{q}", "H2", seed, "name_anchored")
        results.append(_result(instance, same))
    return WorldRun(seed, "bankhash", results, (Unavailable("L99", "no anchor"),))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    out = parser.parse_args().out
    record = dataclasses.replace(_record("official"), world_seed=SEEDS[0])
    run = BenchmarkRun("official", LABEL, record, [_world(seed) for seed in SEEDS])
    with tempfile.TemporaryDirectory() as tmp:
        runs_dir = Path(tmp)
        run_dir = runs_dir / "fixture-official"
        run_dir.mkdir()
        (run_dir / "results.json").write_text(json.dumps(run.to_payload()))
        (run_dir / "summary.json").write_text(json.dumps(summarize(run)))
        summary = _summary_out(_published(runs_dir, "fixture-official"))
        instances = _instances(runs_dir, "fixture-official")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results-official-summary.json").write_text(
        json.dumps(summary.model_dump(mode="json"), indent=2) + "\n"
    )
    (out / "results-official-instances.json").write_text(
        json.dumps([row.model_dump(mode="json") for row in instances], indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
