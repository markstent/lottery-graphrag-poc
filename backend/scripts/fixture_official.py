"""Write the Results screen's run fixtures: test values, not results.

Three runs of the current method, each the report tests' hand-made results
through ``summarize`` and the API's own builders, so every fixture is what
the API serves and nothing is edited by hand:

- the official run, ``fixture-official``: the whole bank over three worlds,
  with the same scores for A, B and C so nothing it draws suggests a direction;
- a subset run, ``fixture-subset``: one world, at most two instances per question;
- a quick check, ``fixture-smoke``: the scorer smoke test.

The run list holds the subset run, the quick check and the report tests'
v0.3 run (``fixture-v03``, written by tests/test_benchmark_report.py).

The fixtures are written to ``--out``. Run from backend/:
    uv run python -m scripts.fixture_official --out ../frontend/e2e/fixtures
then run prettier --write on the output in frontend/.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import tempfile
from pathlib import Path
from typing import Any

from app.api.benchmarks import _instances, _published, _summary_out, listed
from app.config import METHOD_VERSION
from app.evaluation.grounding import Unavailable
from app.evaluation.official import run_label
from app.evaluation.report import summarize
from app.evaluation.runner import BenchmarkRun, InstanceResult, Selection, WorldRun
from tests.test_benchmark_report import (
    V03_FIXTURE_LABEL,
    V03_FIXTURE_RUN,
    _benchmark,
    _instance,
    _record,
    _result,
)

SEEDS = (2026, 2027, 2028)
LABEL = "Fixture run (test values)"
SCORE = (0.4, 0.4)
QUESTIONS = {"H1": 6, "H2": 6, "H3": 6, "H5": 6}
NAME_ANCHORED = 3
OFFICIAL = "fixture-official"
SUBSET = "fixture-subset"
SMOKE = "fixture-smoke"
SUBSET_SELECTION = Selection(limit=2)
OFFICIAL_INSTANCES = "results-official-instances.json"
SUBSET_INSTANCES = "results-pilot-instances.json"
# The fixtures that hold one run's summary, as GET /benchmarks/{id} serves it.
SUMMARIES = {
    OFFICIAL: "results-official-summary.json",
    SUBSET: "results-pilot-summary.json",
    SMOKE: "results-smoke-summary.json",
}
RUN_LIST = "results-runs.json"
WRITTEN = (OFFICIAL_INSTANCES, SUBSET_INSTANCES, *SUMMARIES.values(), RUN_LIST)


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


def _run(kind: str, started_at: str, seeds: tuple[int, ...], selection: Selection) -> BenchmarkRun:
    """A run of the current method with equal scores for every pipeline."""
    record = dataclasses.replace(
        _record(kind),
        world_seed=seeds[0],
        started_at=started_at,
        method_version=METHOD_VERSION,
    )
    label = LABEL if selection.full and kind == "official" else run_label(kind, selection)
    return BenchmarkRun(kind, label, record, [_world(seed) for seed in seeds], selection)


def _runs() -> dict[str, BenchmarkRun]:
    v03 = _benchmark("official", h5_per_world=6, label=V03_FIXTURE_LABEL)
    return {
        OFFICIAL: _run("official", "2026-10-19T12:00:00+00:00", SEEDS, Selection()),
        SUBSET: _run("official", "2026-10-19T19:58:50+00:00", SEEDS[:1], SUBSET_SELECTION),
        SMOKE: _run("smoke", "2026-10-19T16:47:50+00:00", SEEDS[:1], Selection()),
        V03_FIXTURE_RUN: v03,
    }


def write(out: Path) -> None:
    """Rewrite every fixture in ``WRITTEN`` under ``out``."""

    def save(name: str, value: Any) -> None:
        text = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
        (out / name).write_text(text, encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name, run in _runs().items():
            run_dir = root / name
            run_dir.mkdir()
            (run_dir / "results.json").write_text(json.dumps(run.to_payload()))
            (run_dir / "summary.json").write_text(json.dumps(summarize(run)))

        def served(name: str) -> dict[str, Any]:
            return _summary_out(_published(root, name)).model_dump(mode="json")

        def instances(name: str) -> list[dict[str, Any]]:
            return [row.model_dump(mode="json") for row in _instances(root, name)]

        for name, fixture in SUMMARIES.items():
            save(fixture, served(name))
        save(OFFICIAL_INSTANCES, instances(OFFICIAL))
        save(SUBSET_INSTANCES, instances(SUBSET))
        listed_runs = [
            listed(_published(root, name)).model_dump(mode="json")
            for name in (SUBSET, SMOKE, V03_FIXTURE_RUN)
        ]
        save(RUN_LIST, listed_runs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    write(parser.parse_args().out)


if __name__ == "__main__":
    main()
