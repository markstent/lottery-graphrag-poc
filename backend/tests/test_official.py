"""Three-seed orchestration, depth sweep and model comparison (Phase 3, Task 11).

No service runs here: the four preparation steps and the runner are
recorders over a temporary data directory, so the tests check what is
prepared, in which order, and what is written.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import re
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from app.datasets.config import GENERATOR_VERSION
from app.evaluation import __main__ as cli
from app.evaluation import official
from app.evaluation.bank import BANK_VERSION
from app.evaluation.grounding import (
    BankInstance,
    FrozenBank,
    Unavailable,
    seal_bank,
    write_frozen_bank,
)
from app.evaluation.official import (
    OFFICIAL_SEEDS,
    PRESENTATION_SEED,
    PrepareSteps,
    WorldPaths,
    compare_runs,
    prepare_world,
    run_benchmark,
    run_id,
    run_sweep,
    select_instances,
    world_paths,
)
from app.evaluation.runner import BenchmarkRun, WorldRun
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION

from tests.test_benchmark_report import _graded, _instance, _record, _result, _world


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Recorder:
    """The four preparation steps and the runner factory, recording every call."""

    def __init__(self, tmp: Path, fail_on: int | None = None) -> None:
        self.tmp = tmp / "run"
        self.fail_on = fail_on
        self.generated: list[int] = []
        self.ingested: list[int] = []
        self.indexed: list[int] = []
        self.grounded: list[int] = []
        self.points: dict[str, int] = {}
        self.runners: list[dict[str, Any]] = []
        self.steps = PrepareSteps(
            generate=self.generate,
            ingest=lambda paths: self.ingested.append(paths.seed),
            index=self.index,
            ground=self.ground,
            indexed_points=lambda paths: self.points.get(paths.collection, 0),
        )

    def generate(self, paths: WorldPaths) -> None:
        self.generated.append(paths.seed)
        paths.world_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "generator_version": GENERATOR_VERSION,
            "world_seed": paths.seed,
            "scenario_seed": paths.seed,
            # As in a real world, every generation writes a new manifest.
            "generated_at": len(self.generated),
        }
        (paths.world_dir / "_manifest.json").write_text(json.dumps(manifest))
        paths.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        paths.ledger_path.write_text(json.dumps({"world_seed": paths.seed}))

    def index(self, paths: WorldPaths) -> None:
        self.indexed.append(paths.seed)
        manifest = {
            "collection": paths.collection,
            "record_serialiser_version": RECORD_SERIALISER_VERSION,
        }
        (paths.world_dir / "vector-index.json").write_text(json.dumps(manifest))
        self.points[paths.collection] = 10

    def ground(self, paths: WorldPaths) -> None:
        self.grounded.append(paths.seed)
        instances = tuple(
            _instance(question_id, stratum, paths.seed, anchor=anchor)
            for question_id, stratum in (("L01", "H3"), ("L05", "H1"), ("L06", "H1"))
            for anchor in ("X1", "X2", "X3")
        )
        bank = FrozenBank(
            bank_version=BANK_VERSION,
            world_seed=paths.seed,
            world_manifest_hash=_sha(paths.world_dir / "_manifest.json"),
            record_serialiser_version=RECORD_SERIALISER_VERSION,
            ledger_hash=_sha(paths.ledger_path),
            instances=instances,
            unavailable=(Unavailable("L22", "scenario not planted"),),
            bank_hash="",
        )
        write_frozen_bank(seal_bank(bank), paths.bank_path)

    def runner(
        self,
        paths: WorldPaths,
        bank: FrozenBank,
        *,
        kind: str,
        repeats: int,
        pipelines: tuple[str, ...],
        depth: int,
    ) -> FakeRunner:
        self.runners.append(
            {
                "seed": paths.seed,
                "kind": kind,
                "repeats": repeats,
                "pipelines": pipelines,
                "depth": depth,
                "instances": [i.instance_id for i in bank.instances],
            }
        )
        fail = paths.seed == self.fail_on
        return FakeRunner(paths.seed, bank, kind, depth, pipelines, fail)


class FakeRunner:
    def __init__(
        self,
        seed: int,
        bank: FrozenBank,
        kind: str,
        depth: int,
        pipelines: tuple[str, ...],
        fail: bool,
    ) -> None:
        self.seed, self.bank, self.kind, self.depth = seed, bank, kind, depth
        self.pipelines, self.fail = pipelines, fail

    def run(self) -> WorldRun:
        if self.fail:
            raise RuntimeError(f"world {self.seed} failed")
        record = dataclasses.replace(
            _record(self.kind), world_seed=self.seed, graph_limits={"depth": self.depth}
        )
        results = [
            _result(instance, {t: v for t, v in _graded(k).items() if t in self.pipelines})
            for k, instance in enumerate(self.bank.instances)
            if instance.stratum != "H3"
        ]
        return WorldRun(self.seed, self.bank.bank_hash, results, self.bank.unavailable, record)


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "data"
    monkeypatch.setattr(official, "DATA_DIR", root)
    monkeypatch.delenv("QDRANT_COLLECTION", raising=False)
    return root


@pytest.fixture
def recorder(tmp_path: Path, data_dir: Path) -> Recorder:
    return Recorder(tmp_path)


@pytest.fixture
def recorder_failing_on_2027(tmp_path: Path, data_dir: Path) -> Recorder:
    return Recorder(tmp_path, fail_on=2027)


# --- The brief's tests --------------------------------------------------------


def test_paths_for_the_presentation_and_other_seeds(data_dir: Path) -> None:
    assert world_paths(2026).ledger_path.name == "ledger.json"
    assert world_paths(2026).collection == "semantic_context_lab"
    assert world_paths(2027).collection == "semantic_context_lab_seed2027"


def test_worlds_run_in_sequence_and_the_presentation_graph_is_restored(
    recorder: Recorder,
) -> None:
    run_benchmark(
        "smoke",
        (2026, 2027),
        repeats=1,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    assert recorder.ingested == [2026, 2027, 2026]


def test_a_failed_world_still_restores_the_presentation_graph(
    recorder_failing_on_2027: Recorder,
) -> None:
    with pytest.raises(RuntimeError):
        run_benchmark(
            "smoke",
            (2026, 2027),
            repeats=1,
            out_dir=recorder_failing_on_2027.tmp,
            steps=recorder_failing_on_2027.steps,
            runner_factory=recorder_failing_on_2027.runner,
        )
    assert recorder_failing_on_2027.ingested[-1] == 2026


def _write_run(directory: Path, run: BenchmarkRun) -> Path:
    directory.mkdir(parents=True)
    (directory / "results.json").write_text(json.dumps(run.to_payload()))
    return directory


def _official(model: str, bank_hash: str = "bankhash", shift: int = 0) -> BenchmarkRun:
    record = dataclasses.replace(_record("official"), generation_model=model)
    worlds = [
        dataclasses.replace(_world(seed, 6), bank_hash=bank_hash)
        for seed in (2026 + shift, 2027 + shift)
    ]
    return BenchmarkRun("official", None, record, worlds)


@pytest.fixture
def two_runs_different_banks(tmp_path: Path) -> tuple[Path, Path]:
    small = _write_run(tmp_path / "small", _official("small-model"))
    large = _write_run(tmp_path / "large", _official("large-model", bank_hash="otherhash"))
    return small, large


def test_compare_requires_matching_banks(
    tmp_path: Path, two_runs_different_banks: tuple[Path, Path]
) -> None:
    with pytest.raises(ValueError, match="bank"):
        compare_runs(*two_runs_different_banks)


# --- World paths and preparation ---------------------------------------------


def test_world_paths_name_the_world_ledger_bank_and_collection(data_dir: Path) -> None:
    presentation = world_paths(PRESENTATION_SEED)
    other = world_paths(2028)
    assert OFFICIAL_SEEDS == (2026, 2027, 2028)
    assert presentation.world_dir == data_dir / "generated" / "dev-seed2026"
    assert presentation.ledger_path == data_dir / "truth" / "ledger.json"
    assert presentation.bank_path == data_dir / "evaluation" / "bank" / "bank-2.0.0-seed2026.json"
    assert other.world_dir == data_dir / "generated" / "dev-seed2028"
    assert other.ledger_path == data_dir / "truth" / "dev-seed2028.json"
    assert other.bank_path.name == "bank-2.0.0-seed2028.json"
    assert other.seed == 2028


def test_the_presentation_collection_follows_the_environment(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("QDRANT_COLLECTION", "lab_x")
    assert world_paths(2026).collection == "lab_x"
    assert world_paths(2027).collection == "lab_x_seed2027"


def test_a_missing_world_is_generated_indexed_and_grounded(recorder: Recorder) -> None:
    paths = prepare_world(2027, recorder.steps)
    assert (recorder.generated, recorder.ingested) == ([2027], [2027])
    assert (recorder.indexed, recorder.grounded) == ([2027], [2027])
    assert paths == world_paths(2027)


def test_a_current_world_is_only_ingested(recorder: Recorder) -> None:
    prepare_world(2027, recorder.steps)
    prepare_world(2027, recorder.steps)
    assert recorder.generated == [2027]
    assert recorder.ingested == [2027, 2027]
    assert (recorder.indexed, recorder.grounded) == ([2027], [2027])


@pytest.mark.parametrize(
    ("field", "value"),
    [("generator_version", "0.0.1"), ("world_seed", 1), ("scenario_seed", 1)],
)
def test_a_world_of_another_generator_or_seed_is_generated_again(
    recorder: Recorder, field: str, value: object
) -> None:
    paths = prepare_world(2027, recorder.steps)
    manifest_path = paths.world_dir / "_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest_path.write_text(json.dumps({**manifest, field: value}))
    prepare_world(2027, recorder.steps)
    # A new world needs a new index, and its manifest hash re-grounds the bank.
    assert recorder.generated == recorder.indexed == recorder.grounded == [2027, 2027]


def test_an_empty_collection_is_indexed_again(recorder: Recorder) -> None:
    prepare_world(2027, recorder.steps)
    recorder.points.clear()
    prepare_world(2027, recorder.steps)
    assert recorder.indexed == [2027, 2027]
    assert recorder.generated == recorder.grounded == [2027]


@pytest.mark.parametrize(
    ("field", "value"),
    [("record_serialiser_version", "0.0.1"), ("collection", "another_collection")],
)
def test_an_index_of_another_serialiser_or_collection_is_built_again(
    recorder: Recorder, field: str, value: str
) -> None:
    paths = prepare_world(2027, recorder.steps)
    manifest_path = paths.world_dir / "vector-index.json"
    manifest = json.loads(manifest_path.read_text())
    manifest_path.write_text(json.dumps({**manifest, field: value}))
    prepare_world(2027, recorder.steps)
    assert recorder.indexed == [2027, 2027]


def test_a_bank_whose_ledger_changed_is_grounded_again(recorder: Recorder) -> None:
    paths = prepare_world(2027, recorder.steps)
    paths.ledger_path.write_text(json.dumps({"world_seed": 2027, "edited": True}))
    prepare_world(2027, recorder.steps)
    assert recorder.grounded == [2027, 2027]
    assert recorder.generated == [2027]


def test_an_edited_bank_file_is_grounded_again(recorder: Recorder) -> None:
    paths = prepare_world(2027, recorder.steps)
    payload = json.loads(paths.bank_path.read_text())
    payload["unavailable"] = []
    paths.bank_path.write_text(json.dumps(payload))
    prepare_world(2027, recorder.steps)
    assert recorder.grounded == [2027, 2027]


# --- Instance selection --------------------------------------------------------


def _bank(instances: tuple[BankInstance, ...]) -> FrozenBank:
    return FrozenBank(
        bank_version=BANK_VERSION,
        world_seed=2026,
        world_manifest_hash="m",
        record_serialiser_version=RECORD_SERIALISER_VERSION,
        ledger_hash="l",
        instances=instances,
        unavailable=(Unavailable("L01", "no eligible anchor"), Unavailable("L22", "x")),
        bank_hash="h",
    )


def test_selection_keeps_the_strata_and_at_most_limit_instances_per_question() -> None:
    instances = tuple(
        _instance(question_id, stratum, 2026, anchor=anchor)
        for question_id, stratum in (("L05", "H1"), ("L06", "H1"), ("L01", "H3"))
        for anchor in ("X1", "X2", "X3")
    )
    bank = select_instances(_bank(instances), strata=["H1"], limit=2)
    assert [i.instance_id for i in bank.instances] == [
        "L05-2026-X1",
        "L05-2026-X2",
        "L06-2026-X1",
        "L06-2026-X2",
    ]
    # Questions outside the strata are not reported as unavailable either.
    assert bank.unavailable == ()
    assert bank.bank_hash == "h"
    assert select_instances(_bank(instances), strata=None, limit=None).instances == instances


def test_selection_refuses_an_unknown_stratum() -> None:
    with pytest.raises(ValueError, match="H9"):
        select_instances(_bank(()), strata=["H9"], limit=None)


# --- run_benchmark -------------------------------------------------------------


def test_the_runner_gets_each_world_with_the_run_settings(recorder: Recorder) -> None:
    run = run_benchmark(
        "smoke",
        (2026, 2027),
        repeats=2,
        out_dir=recorder.tmp,
        strata=["H1"],
        limit=1,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    assert [r["seed"] for r in recorder.runners] == [2026, 2027]
    first = recorder.runners[0]
    assert (first["kind"], first["repeats"], first["depth"]) == ("smoke", 2, 2)
    assert first["pipelines"] == ("A", "B", "C")
    assert first["instances"] == ["L05-2026-X1", "L06-2026-X1"]
    assert [world.world_seed for world in run.worlds] == [2026, 2027]
    assert run.label == "scorer smoke test"
    assert run.record.world_seed == 2026


def test_a_run_writes_results_summary_and_report(recorder: Recorder) -> None:
    run_benchmark(
        "smoke",
        (2026, 2027),
        repeats=1,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    summary = json.loads((recorder.tmp / "summary.json").read_text())
    results = json.loads((recorder.tmp / "results.json").read_text())
    assert summary["schema_version"] == "2"
    assert summary["label"] == "scorer smoke test"
    assert summary["worlds"] == [2026, 2027]
    assert [w["reproducibility"]["world_seed"] for w in results["worlds"]] == [2026, 2027]
    assert (recorder.tmp / "report.md").read_text().startswith("# Benchmark run")


def test_run_files_are_written_atomically(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    replaced: list[tuple[Path, Path]] = []
    real_replace = os.replace

    def spy(source: str | os.PathLike[str], target: str | os.PathLike[str]) -> None:
        replaced.append((Path(source), Path(target)))
        real_replace(source, target)

    monkeypatch.setattr(official.os, "replace", spy)
    run_benchmark(
        "smoke",
        (2026,),
        repeats=1,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    targets = [target.name for _, target in replaced]
    # summary.json, the file the API reads, lands last.
    assert targets == ["results.json", "report.md", "summary.json"]
    assert all(source.parent == target.parent == recorder.tmp for source, target in replaced)
    assert all(source.name != target.name for source, target in replaced)
    assert sorted(p.name for p in recorder.tmp.iterdir()) == [
        "report.md",
        "results.json",
        "summary.json",
    ]


def test_a_failed_write_leaves_no_partial_file(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(source: str | os.PathLike[str], target: str | os.PathLike[str]) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(official.os, "replace", broken)
    with pytest.raises(OSError, match="disk full"):
        run_benchmark(
            "smoke",
            (2026,),
            repeats=1,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
        )
    assert list(recorder.tmp.iterdir()) == []


def test_a_run_refuses_a_directory_that_holds_a_run(recorder: Recorder) -> None:
    recorder.tmp.mkdir()
    (recorder.tmp / "results.json").write_text("{}")
    with pytest.raises(FileExistsError):
        run_benchmark(
            "smoke",
            (2026,),
            repeats=1,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
        )
    assert recorder.ingested == []


# --- Depth sweep ---------------------------------------------------------------


def test_the_sweep_runs_h1_with_b_and_c_at_every_depth(recorder: Recorder) -> None:
    runs = run_sweep(
        (2026, 2027),
        depths=(0, 1),
        repeats=1,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    assert [(r["seed"], r["depth"]) for r in recorder.runners] == [
        (2026, 0),
        (2026, 1),
        (2027, 0),
        (2027, 1),
    ]
    assert {r["kind"] for r in recorder.runners} == {"sweep"}
    assert {r["pipelines"] for r in recorder.runners} == {("B", "C")}
    assert all(i.startswith(("L05", "L06")) for r in recorder.runners for i in r["instances"])
    assert recorder.ingested == [2026, 2027, 2026]
    assert sorted(runs) == [0, 1]
    assert [w.world_seed for w in runs[1].worlds] == [2026, 2027]


def test_the_sweep_summary_lists_metrics_per_depth_and_makes_no_claim(
    recorder: Recorder,
) -> None:
    run_sweep(
        (2026,),
        depths=(0, 2),
        repeats=1,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    sweep = json.loads((recorder.tmp / "sweep.json").read_text())
    assert sweep["run_kind"] == "sweep"
    assert sorted(sweep["depths"]) == ["0", "2"]
    assert sorted(sweep["depths"]["2"]["metrics"]["evidence_f1"]) == ["B", "C"]
    assert sweep["depths"]["2"]["reproducibility"]["graph_limits"] == {"depth": 2}
    text = json.dumps(sweep)
    assert "p_holm" not in text and "headlines" not in text
    # The API publishes summary.json only, so a sweep never becomes the latest run.
    assert not (recorder.tmp / "summary.json").exists()
    assert (recorder.tmp / "results.json").exists()
    assert "| 2 | C |" in (recorder.tmp / "report.md").read_text()


def test_a_failed_sweep_still_restores_the_presentation_graph(
    recorder_failing_on_2027: Recorder,
) -> None:
    with pytest.raises(RuntimeError):
        run_sweep(
            (2026, 2027),
            depths=(1,),
            repeats=1,
            out_dir=recorder_failing_on_2027.tmp,
            steps=recorder_failing_on_2027.steps,
            runner_factory=recorder_failing_on_2027.runner,
        )
    assert recorder_failing_on_2027.ingested[-1] == 2026


# --- Model comparison (H7) -----------------------------------------------------


def test_compare_reports_large_minus_small_per_pipeline_and_stratum(tmp_path: Path) -> None:
    small_run = _official("small-model")
    large_run = _official("large-model")
    # The large model answers 0.1 better on every repeat of every instance.
    for world in large_run.worlds:
        for result in world.results:
            for scores in result.scores.values():
                scores[:] = [
                    None if s is None else dataclasses.replace(s, answer=(s.answer or 0) + 0.1)
                    for s in scores
                ]
    small = _write_run(tmp_path / "small", small_run)
    large = _write_run(tmp_path / "large", large_run)
    comparison = compare_runs(small, large)
    assert comparison["hypothesis"] == "H7"
    assert comparison["small"]["generation_model"] == "small-model"
    assert comparison["large"]["generation_model"] == "large-model"
    cells = {(c["pipeline"], c["stratum"], c["metric"]): c for c in comparison["cells"]}
    h1_answer = cells[("B", "H1", "answer")]
    assert h1_answer["mean"] == pytest.approx(0.1)
    assert (h1_answer["n"], h1_answer["clusters"]) == (12, 12)
    assert cells[("C", "H1", "evidence_f1")]["mean"] == pytest.approx(0.0)
    assert cells[("A", "overall", "answer")]["n"] == 54
    assert "p" not in h1_answer and "p_holm" not in h1_answer


def test_compare_refuses_runs_of_the_same_model(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official("one-model"))
    large = _write_run(tmp_path / "large", _official("one-model"))
    with pytest.raises(ValueError, match="generation model"):
        compare_runs(small, large)


def test_compare_refuses_runs_over_other_worlds(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official("small-model"))
    large = _write_run(tmp_path / "large", _official("large-model", shift=5))
    with pytest.raises(ValueError, match="bank"):
        compare_runs(small, large)


def test_compare_refuses_a_run_that_is_not_official(tmp_path: Path) -> None:
    smoke = dataclasses.replace(_official("small-model"), kind="smoke")
    small = _write_run(tmp_path / "small", smoke)
    large = _write_run(tmp_path / "large", _official("large-model"))
    with pytest.raises(ValueError, match="official"):
        compare_runs(small, large)


# --- Run id and CLI ------------------------------------------------------------


def test_run_ids_sort_in_time_order_and_are_safe_file_names() -> None:
    earlier = run_id("official", datetime(2026, 10, 19, 9, 5, 7, tzinfo=UTC))
    later = run_id("smoke", datetime(2026, 10, 19, 10, 0, 0, tzinfo=UTC))
    assert earlier == "20261019T090507Z-official"
    assert sorted([later, earlier]) == [earlier, later]
    assert re.fullmatch(r"[0-9A-Za-z-]+", earlier)


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    calls: dict[str, Any] = {}

    def record(name: str) -> Callable[..., None]:
        def call(*args: Any, **kwargs: Any) -> None:
            calls[name] = (args, kwargs)

        return call

    monkeypatch.setattr(official, "run_benchmark", record("run"))
    monkeypatch.setattr(official, "run_sweep", record("sweep"))
    yield calls


def test_cli_run_passes_its_options(captured: dict[str, Any], tmp_path: Path) -> None:
    out = tmp_path / "out"
    code = cli.main(
        [
            *("run", "--kind", "official", "--seeds", "2026,2027", "--strata", "H1,H3"),
            *("--limit", "2", "--out", str(out)),
        ]
    )
    assert code == 0
    args, kwargs = captured["run"]
    assert args == ("official", (2026, 2027))
    assert kwargs == {"repeats": 3, "out_dir": out, "strata": ["H1", "H3"], "limit": 2}


def test_cli_run_defaults_to_three_seeds_and_a_run_directory(
    captured: dict[str, Any], data_dir: Path
) -> None:
    cli.main(["run", "--kind", "smoke"])
    args, kwargs = captured["run"]
    assert args == ("smoke", OFFICIAL_SEEDS)
    assert kwargs["repeats"] == 1
    out_dir = kwargs["out_dir"]
    assert out_dir.parent == data_dir / "evaluation" / "runs"
    assert re.fullmatch(r"\d{8}T\d{6}Z-smoke", out_dir.name)


def test_cli_sweep_passes_its_depths(captured: dict[str, Any], data_dir: Path) -> None:
    cli.main(["sweep", "--seeds", "2026", "--depths", "1,3"])
    args, kwargs = captured["sweep"]
    assert args == ((2026,),)
    assert kwargs["depths"] == (1, 3)
    assert kwargs["repeats"] == 3
    assert kwargs["out_dir"].name.endswith("-sweep")


def test_cli_compare_writes_comparison_json(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official("small-model"))
    large = _write_run(tmp_path / "large", _official("large-model"))
    out = tmp_path / "cmp"
    assert cli.main(["compare", str(small), str(large), "--out", str(out)]) == 0
    written = json.loads((out / "comparison.json").read_text())
    assert written["hypothesis"] == "H7"
