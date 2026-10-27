"""Write the Results screen's method v0.2 fixtures: test values, not results.

The official run is a whole-bank run over three worlds built from the report
tests' hand-made results, with the same scores for A, B and C so nothing it
draws suggests a direction. Its instances pass through the API's own builder.

Method v0.3 replaced the code that wrote summary schema 2 (D-092), so the
v0.2 summaries these fixtures hold, the official run's and the captured pilot
and quick check, are kept as they were written and served again through the
API's own builder (``_summary_out``). That adds what the API now serves for
them, ``method_version`` (from ``method_of``), and nothing is edited by hand.
The captured run list and the shell capture hold listed runs and slim
summaries with no record: every one was recorded before ``method_version``
existed, which ``method_of`` reads as 0.2.0, as the API does.

The fixtures are read from and written back to ``--out``. Run from backend/:
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

from app.api.benchmarks import _instances, _published, _summary_out
from app.api.schemas import BenchmarkRunOut
from app.evaluation.grounding import Unavailable
from app.evaluation.official import method_of
from app.evaluation.report import summarize
from app.evaluation.runner import BenchmarkRun, InstanceResult, WorldRun
from tests.test_benchmark_report import _instance, _record, _result

SEEDS = (2026, 2027, 2028)
LABEL = "Fixture run (test values)"
SCORE = (0.4, 0.4)
QUESTIONS = {"H1": 6, "H2": 6, "H3": 6, "H5": 6}
NAME_ANCHORED = 3
OFFICIAL_INSTANCES = "results-official-instances.json"
# The fixtures that hold one run's summary, as GET /benchmarks/{id} serves it.
SERVED_SUMMARIES = (
    "results-official-summary.json",
    "results-pilot-summary.json",
    "results-smoke-summary.json",
)
RUN_LIST = "results-runs.json"
SHELL = "world-shell.json"
WRITTEN = (OFFICIAL_INSTANCES, *SERVED_SUMMARIES, RUN_LIST, SHELL)


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


def official_instances() -> list[dict[str, Any]]:
    """The official run's instances, as GET /benchmarks/{id}/instances serves them."""
    record = dataclasses.replace(_record("official"), world_seed=SEEDS[0])
    run = BenchmarkRun("official", LABEL, record, [_world(seed) for seed in SEEDS])
    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp) / "fixture-official"
        run_dir.mkdir()
        (run_dir / "results.json").write_text(json.dumps(run.to_payload()))
        (run_dir / "summary.json").write_text(json.dumps(summarize(run)))
        return [row.model_dump(mode="json") for row in _instances(Path(tmp), run_dir.name)]


def served(fixture: dict[str, Any]) -> dict[str, Any]:
    """A stored summary served again by the API's own builder."""
    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp) / fixture["run_id"]
        run_dir.mkdir()
        (run_dir / "summary.json").write_text(json.dumps(fixture["summary"]))
        return _summary_out(_published(Path(tmp), run_dir.name)).model_dump(mode="json")


def listed(run: dict[str, Any]) -> dict[str, Any]:
    """A captured run-list entry with the method the API serves for it."""
    fields = {key: value for key, value in run.items() if key != "method_version"}
    return BenchmarkRunOut(**fields, method_version=method_of({})).model_dump(mode="json")


def with_method(slim: dict[str, Any]) -> dict[str, Any]:
    """A slim captured summary with the method the API serves for it."""
    fields = {key: value for key, value in slim.items() if key not in ("method_version", "summary")}
    return {**fields, "method_version": method_of({}), "summary": slim["summary"]}


def write(out: Path) -> None:
    """Rewrite every fixture in ``WRITTEN`` under ``out``."""

    def load(name: str) -> Any:
        return json.loads((out / name).read_text(encoding="utf-8"))

    def save(name: str, value: Any) -> None:
        text = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
        (out / name).write_text(text, encoding="utf-8")

    save(OFFICIAL_INSTANCES, official_instances())
    for name in SERVED_SUMMARIES:
        save(name, served(load(name)))
    save(RUN_LIST, [listed(run) for run in load(RUN_LIST)])
    shell = load(SHELL)
    shell["runs"] = [listed(run) for run in shell["runs"]]
    shell["latest"] = with_method(shell["latest"])
    shell["latest_smoke"] = with_method(shell["latest_smoke"])
    save(SHELL, shell)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    write(parser.parse_args().out)


if __name__ == "__main__":
    main()
