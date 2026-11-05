"""Write the Results screen's run fixtures: test values, not results.

Three runs of the current method, each the report tests' hand-made results
through ``summarize`` and the API's own builders, so every fixture is what
the API serves and nothing is edited by hand:

- the official run, ``fixture-official``: the whole bank over three worlds,
  with the same scores for A, B and C so nothing it draws suggests a direction;
  its answers are spread over right, partly right and wrong, a mean of 0.4 in
  every kind of question, some of each band say the sources could not answer,
  and each question brings extra records, so the Outcomes views draw all of it;
- a subset run, ``fixture-subset``: one world, at most two instances per question;
- a quick check, ``fixture-smoke``: the scorer smoke test.

Each run's evidence and answer outcomes, as GET /benchmarks/{id}/outcomes
serves them, are written to one file keyed by run id. The report tests count
one claim found of one whatever the recall, so here every score counts its
claims out of ``CLAIMS`` in step with its recall, and the outcomes' pooled
counts agree with their shares.

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

from app.api.benchmarks import _instances, _outcomes, _published, _summary_out, listed
from app.config import METHOD_VERSION
from app.evaluation.grounding import Unavailable
from app.evaluation.official import run_label
from app.evaluation.report import summarize
from app.evaluation.runner import (
    BenchmarkRun,
    InstanceResult,
    PipelineRun,
    RunScore,
    Selection,
    WorldRun,
)
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
# The claims each fixture score counts, so a recall of 0.4 is 4 of 10 found.
CLAIMS = 10
# The official run's answer score per question of a kind, in question order:
# right, partly right and wrong, each kind's mean still 0.4.
SPREAD = (1.0, 1.0, 0.4, 0.0, 0.0, 0.0)
NAME_SPREAD = (1.0, 0.2, 0.0)
# An answer of the official run says the sources could not answer when
# (question index + world seed) % ABSTAIN_EVERY is 0, which lands in every band.
ABSTAIN_EVERY = 3
ABSTAIN_VERDICT = "unknown: the sources do not say"
# The official run's extra records per question: EXTRA_BASE, plus
# EXTRA_STEP for each step of the question index modulo EXTRA_CYCLE.
EXTRA_BASE = 12
EXTRA_STEP = 2
EXTRA_CYCLE = 3
# The record that carries each fixture question's one claim (tests/test_benchmark_report.py).
CARRIER = "Y"
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
OUTCOMES = "results-outcomes.json"
WRITTEN = (OFFICIAL_INSTANCES, SUBSET_INSTANCES, *SUMMARIES.values(), RUN_LIST, OUTCOMES)


def _same(answer: float) -> dict[str, list[tuple[float, float] | None]]:
    """Three repeats of one answer score, at the fixture recall, for every pipeline."""
    return {tag: [(answer, SCORE[1])] * 3 for tag in "ABC"}


def _spread(result: InstanceResult, q: int, seed: int) -> InstanceResult:
    """The result with its answers' verdicts and its selected records spread
    by question and world, the same for every pipeline and repeat."""
    abstains = (q + seed) % ABSTAIN_EVERY == 0
    extra = EXTRA_BASE + EXTRA_STEP * (q % EXTRA_CYCLE)
    selected = (CARRIER, *(f"EXTRA-{i}" for i in range(extra)))

    def spread(run: PipelineRun) -> PipelineRun:
        verdict = ABSTAIN_VERDICT if abstains else run.verdict
        return dataclasses.replace(run, verdict=verdict, selected=selected)

    runs = {tag: [spread(run) for run in repeats] for tag, repeats in result.runs.items()}
    return dataclasses.replace(result, runs=runs)


def _world(seed: int, spread: bool) -> WorldRun:
    results: list[InstanceResult] = []

    def add(instance_id: str, stratum: str, sub: str | None, q: int, answer: float) -> None:
        result = _result(_instance(instance_id, stratum, seed, sub), _same(answer))
        results.append(_spread(result, q, seed) if spread else result)

    for stratum, count in QUESTIONS.items():
        sub = "id_anchored" if stratum == "H2" else None
        for q in range(count):
            add(f"{stratum}-{q}", stratum, sub, q, SPREAD[q] if spread else SCORE[0])
    for q in range(NAME_ANCHORED):
        add(f"H2N-{q}", "H2", "name_anchored", q, NAME_SPREAD[q] if spread else SCORE[0])
    return WorldRun(seed, "bankhash", results, (Unavailable("L99", "no anchor"),))


def _run(kind: str, started_at: str, seeds: tuple[int, ...], selection: Selection) -> BenchmarkRun:
    """A run of the current method with equal scores for every pipeline; the
    official run of the whole bank has its answers and records spread."""
    record = dataclasses.replace(
        _record(kind),
        world_seed=seeds[0],
        started_at=started_at,
        method_version=METHOD_VERSION,
    )
    official = selection.full and kind == "official"
    label = LABEL if official else run_label(kind, selection)
    worlds = [_world(seed, spread=official) for seed in seeds]
    return BenchmarkRun(kind, label, record, worlds, selection)


def _counted(score: RunScore | None) -> RunScore | None:
    """The score with its claims counted out of ``CLAIMS`` in step with its recall."""
    if score is None or score.evidence.recall is None:
        return score
    found = round(score.evidence.recall * CLAIMS)
    evidence = dataclasses.replace(score.evidence, claims_found=found, claims_total=CLAIMS)
    return dataclasses.replace(score, evidence=evidence)


def _with_claim_counts(run: BenchmarkRun) -> BenchmarkRun:
    for world in run.worlds:
        for result in world.results:
            for tag, scores in result.scores.items():
                result.scores[tag] = [_counted(score) for score in scores]
    return run


def _runs() -> dict[str, BenchmarkRun]:
    v03 = _benchmark("official", h5_per_world=6, label=V03_FIXTURE_LABEL)
    runs = {
        OFFICIAL: _run("official", "2026-10-19T12:00:00+00:00", SEEDS, Selection()),
        SUBSET: _run("official", "2026-10-19T19:58:50+00:00", SEEDS[:1], SUBSET_SELECTION),
        SMOKE: _run("smoke", "2026-10-19T16:47:50+00:00", SEEDS[:1], Selection()),
        V03_FIXTURE_RUN: v03,
    }
    return {name: _with_claim_counts(run) for name, run in runs.items()}


def write(out: Path) -> None:
    """Rewrite every fixture in ``WRITTEN`` under ``out``."""

    def save(name: str, value: Any) -> None:
        text = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
        (out / name).write_text(text, encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        runs = _runs()
        for name, run in runs.items():
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
        outcomes = {name: _outcomes(root, name).model_dump(mode="json") for name in runs}
        save(OUTCOMES, outcomes)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    write(parser.parse_args().out)


if __name__ == "__main__":
    main()
