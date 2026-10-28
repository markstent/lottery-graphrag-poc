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
import shlex
import shutil
import subprocess
import threading
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from app.config import REPO_ROOT, SELECTION_RULE
from app.datasets.config import GENERATOR_VERSION
from app.evaluation import __main__ as cli
from app.evaluation import official
from app.evaluation import runner as runner_module
from app.evaluation.bank import BANK_VERSION
from app.evaluation.checks import SCORER_VERSION
from app.evaluation.grounding import (
    BankInstance,
    FrozenBank,
    GroundingError,
    Unavailable,
    load_frozen_bank,
    seal_bank,
    write_frozen_bank,
)
from app.evaluation.official import (
    OFFICIAL_SEEDS,
    PRESENTATION_SEED,
    PROFILE,
    SEEN_SEEDS,
    BenchmarkCancelled,
    InstanceHook,
    NotDevWorld,
    PrepareSteps,
    WorldPaths,
    bank_matches_active_world,
    compare_runs,
    preflight,
    prepare_world,
    run_benchmark,
    run_id,
    run_sweep,
    select_instances,
    world_paths,
)
from app.evaluation.runner import (
    DEV_LABEL,
    BenchmarkRun,
    ReproducibilityRecord,
    Selection,
    WorldRun,
)
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION

from tests.test_benchmark_report import _graded, _instance, _record, _result, _world


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Recorder:
    """The four preparation steps and the runner factory, recording every call."""

    def __init__(self, tmp: Path, fail_on: int | None = None, restore_fails: bool = False) -> None:
        self.tmp = tmp / "run"
        self.fail_on = fail_on
        self.restore_fails = restore_fails
        self.generated: list[int] = []
        self.ingested: list[int] = []
        self.ingested_dirs: list[Path] = []
        self.indexed: list[int] = []
        self.grounded: list[int] = []
        self.points: dict[str, int] = {}
        self.runners: list[dict[str, Any]] = []
        self.made: list[FakeRunner] = []
        self.steps = PrepareSteps(
            generate=self.generate,
            ingest=self.ingest,
            index=self.index,
            ground=self.ground,
            indexed_points=lambda paths: self.points.get(paths.collection, 0),
        )

    def generate(self, paths: WorldPaths) -> None:
        self.generated.append(paths.seed)
        paths.world_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "generator_version": GENERATOR_VERSION,
            "profile": PROFILE,
            "world_seed": paths.seed,
            "scenario_seed": paths.seed,
            # As in a real world, every generation writes a new manifest.
            "generated_at": len(self.generated),
        }
        (paths.world_dir / "_manifest.json").write_text(json.dumps(manifest))
        paths.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        paths.ledger_path.write_text(json.dumps({"world_seed": paths.seed}))

    def ingest(self, paths: WorldPaths) -> None:
        restoring = paths.seed == PRESENTATION_SEED and PRESENTATION_SEED in self.ingested
        self.ingested.append(paths.seed)
        self.ingested_dirs.append(paths.world_dir)
        if restoring and self.restore_fails:
            raise ConnectionError("Neo4j is down")

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
            scorer_version=SCORER_VERSION,
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
        runner = FakeRunner(paths.seed, bank, kind, depth, pipelines, fail, repeats)
        self.made.append(runner)
        return runner


class FakeRunner:
    def __init__(
        self,
        seed: int,
        bank: FrozenBank,
        kind: str,
        depth: int,
        pipelines: tuple[str, ...],
        fail: bool,
        repeats: int = 3,
    ) -> None:
        self.seed, self.bank, self.kind, self.depth = seed, bank, kind, depth
        self.repeats = repeats
        self.pipelines, self.fail = pipelines, fail
        self.ran = False

    def record(self) -> ReproducibilityRecord:
        """The settings fields as the real runner derives them, the rest fake."""
        return dataclasses.replace(
            _record(self.kind),
            **official.current_settings(self.kind, self.repeats, self.seed, self.depth),
            world_seed=self.seed,
            world_dir=f"data/generated/dev-seed{self.seed}",
            bank_hash=self.bank.bank_hash,
        )

    def run(self, on_instance: InstanceHook | None = None) -> WorldRun:
        self.ran = True
        if self.fail:
            raise RuntimeError(f"world {self.seed} failed")
        total = len(self.bank.instances)
        for done in (*range(total), total):
            if on_instance is not None:
                on_instance(done, total)
        results = [
            _result(instance, {t: v for t, v in _graded(k).items() if t in self.pipelines})
            for k, instance in enumerate(self.bank.instances)
            if instance.stratum != "H3"
        ]
        return WorldRun(
            self.seed, self.bank.bank_hash, results, self.bank.unavailable, self.record()
        )


@pytest.fixture(autouse=True)
def clean_checkout(monkeypatch: pytest.MonkeyPatch) -> None:
    """A fixed revision on a clean checkout, whatever this repository's state."""
    monkeypatch.setattr(runner_module, "_git_sha", lambda: "abc123")
    monkeypatch.setattr(runner_module, "_git_dirty", lambda: False)


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "data"
    monkeypatch.setattr(official, "DATA_DIR", root)
    monkeypatch.setenv("DATASET_DIR", str(root / "generated" / "dev-seed2026"))
    monkeypatch.delenv("TRUTH_LEDGER_PATH", raising=False)
    monkeypatch.delenv("QDRANT_COLLECTION", raising=False)
    return root


@pytest.fixture
def recorder(tmp_path: Path, data_dir: Path) -> Recorder:
    return Recorder(tmp_path)


@pytest.fixture
def recorder_failing_on_2027(tmp_path: Path, data_dir: Path) -> Recorder:
    return Recorder(tmp_path, fail_on=2027)


@pytest.fixture
def gateway_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Generation and judge settings an official run or a sweep accepts."""
    for name, value in {
        "GENERATION_PROVIDER": "litellm",
        "GENERATION_MODEL": "ollama/qwen3.6:latest",
        "GENERATION_MODEL_FAMILY": "qwen",
        "JUDGE_PROVIDER": "litellm",
        "JUDGE_MODEL": "ollama/gemma4:31b",
        "JUDGE_MODEL_FAMILY": "gemma",
    }.items():
        monkeypatch.setenv(name, value)


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


def test_the_restore_ingests_the_world_the_api_serves(
    recorder: Recorder, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The presentation world is DATASET_DIR's: the graph is restored to it."""
    served = tmp_path / "served-world"
    monkeypatch.setenv("DATASET_DIR", str(served))
    with official._presentation_graph_restored(recorder.steps):
        recorder.steps.ingest(world_paths(2027))
    assert recorder.ingested_dirs == [world_paths(2027).world_dir, served]


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


def test_progress_is_reported_per_world_and_instance(recorder: Recorder) -> None:
    progress: list[tuple[int, int, int]] = []
    run_benchmark(
        "smoke",
        (2026, 2027),
        repeats=1,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
        on_progress=lambda seed, done, total: progress.append((seed, done, total)),
    )
    assert progress == [(seed, done, 9) for seed in (2026, 2027) for done in range(10)]


def test_a_cancelled_run_restores_the_graph_and_writes_nothing(recorder: Recorder) -> None:
    cancelled = threading.Event()

    def cancel_at_third(seed: int, done: int, total: int) -> None:
        if done == 2:
            cancelled.set()

    with pytest.raises(BenchmarkCancelled):
        run_benchmark(
            "smoke",
            (2026, 2027),
            repeats=1,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
            cancelled=cancelled,
            on_progress=cancel_at_third,
        )
    assert recorder.ingested == [2026, 2026]
    assert not recorder.tmp.exists()


def test_a_run_cancelled_before_it_starts_prepares_no_world(recorder: Recorder) -> None:
    cancelled = threading.Event()
    cancelled.set()
    with pytest.raises(BenchmarkCancelled):
        run_benchmark(
            "smoke",
            (2026,),
            repeats=1,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
            cancelled=cancelled,
        )
    assert recorder.generated == [] and recorder.ingested == [2026]


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
    assert OFFICIAL_SEEDS == (2029, 2030, 2031, 2032, 2033, 2034)
    assert SEEN_SEEDS == (2026, 2027, 2028) and official.FIRST_UNSEEN_SEED == 2029
    assert presentation.world_dir == data_dir / "generated" / "dev-seed2026"
    assert presentation.ledger_path == data_dir / "truth" / "ledger.json"
    assert (
        presentation.bank_path
        == data_dir / "evaluation" / "bank" / "bank-2.0.0-scorer-2.2.0-dev-seed2026.json"
    )
    assert other.world_dir == data_dir / "generated" / "dev-seed2028"
    assert other.ledger_path == data_dir / "truth" / "dev-seed2028.json"
    assert other.bank_path.name == "bank-2.0.0-scorer-2.2.0-dev-seed2028.json"
    assert other.seed == 2028


@pytest.fixture
def grounded_world(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> WorldPaths:
    """The presentation world with its ledger and a bank grounded on both."""
    paths = world_paths(PRESENTATION_SEED)
    paths.world_dir.mkdir(parents=True)
    (paths.world_dir / "_manifest.json").write_text('{"world_seed": 2026}')
    paths.ledger_path.parent.mkdir(parents=True)
    paths.ledger_path.write_text('{"world_seed": 2026}')
    bank = FrozenBank(
        bank_version=BANK_VERSION,
        world_seed=PRESENTATION_SEED,
        world_manifest_hash=_sha(paths.world_dir / "_manifest.json"),
        record_serialiser_version=RECORD_SERIALISER_VERSION,
        scorer_version=SCORER_VERSION,
        ledger_hash=_sha(paths.ledger_path),
        instances=(),
        unavailable=(),
        bank_hash="",
    )
    write_frozen_bank(seal_bank(bank), paths.bank_path)
    monkeypatch.setenv("DATASET_DIR", str(paths.world_dir))
    return paths


def test_a_bank_is_current_for_the_world_it_was_grounded_on(grounded_world: WorldPaths) -> None:
    assert bank_matches_active_world()


DEV_ONLY = (
    "benchmarks run on the dev-profile worlds only; unset DATASET_DIR and TRUTH_LEDGER_PATH "
    "(the demo environment cannot run one)"
)


def _demo_environment(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATASET_DIR", str(data_dir / "generated" / "demo-seed2026"))
    monkeypatch.setenv("TRUTH_LEDGER_PATH", str(data_dir / "truth" / "ledger-demo.json"))


def _demo_ledger_on_the_dev_world(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRUTH_LEDGER_PATH", str(data_dir / "truth" / "ledger-demo.json"))


def _dev_world_with_the_demo_directory(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATASET_DIR", str(data_dir / "generated" / "demo-seed2026"))


@pytest.mark.parametrize(
    "setup",
    [_demo_environment, _demo_ledger_on_the_dev_world, _dev_world_with_the_demo_directory],
)
@pytest.mark.parametrize("kind", ["smoke", "official"])
def test_a_benchmark_is_refused_outside_the_dev_world(
    data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    setup: Callable[[Path, pytest.MonkeyPatch], None],
    kind: str,
) -> None:
    setup(data_dir, monkeypatch)
    with pytest.raises(NotDevWorld, match="dev-profile worlds only") as refused:
        preflight(kind, 1)
    assert str(refused.value) == DEV_ONLY


def test_the_cli_refuses_a_benchmark_in_the_demo_environment_before_preparing_anything(
    recorder: Recorder, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _demo_environment(data_dir, monkeypatch)
    monkeypatch.setattr(official, "default_steps", lambda: recorder.steps)
    with pytest.raises(SystemExit) as stopped:
        cli.main(["run", "--kind", "smoke", "--seeds", "2026"])
    assert stopped.value.code == DEV_ONLY
    assert recorder.generated == recorder.ingested == []


def test_the_dev_world_is_accepted_for_a_benchmark(data_dir: Path) -> None:
    preflight("smoke", 1)


@pytest.mark.parametrize("dirty", [True, None], ids=["dirty", "git-unavailable"])
def test_an_official_run_starts_only_from_a_known_clean_checkout(
    recorder: Recorder,
    gateway_env: None,
    monkeypatch: pytest.MonkeyPatch,
    dirty: bool | None,
) -> None:
    """D-091: a fresh official run, the full run and the dry run alike, is
    refused before anything is prepared unless git says the tree is clean."""
    monkeypatch.setattr(runner_module, "_git_dirty", lambda: dirty)
    with pytest.raises(ValueError, match="starts or resumes only from a clean checkout"):
        preflight("official", 3)
    for seeds, questions in ((UNSEEN_RUN, None), ((2026,), ["L05"])):
        with pytest.raises(ValueError, match="clean checkout"):
            _run(recorder, seeds, kind="official", repeats=3, questions=questions)
    assert recorder.generated == recorder.ingested == [] and recorder.runners == []


def test_an_official_run_starts_from_a_clean_checkout(gateway_env: None, data_dir: Path) -> None:
    # The autouse ``clean_checkout`` fixture fakes git reporting a clean tree.
    preflight("official", 3)


@pytest.mark.parametrize("kind", ["dev", "sweep", "smoke"])
def test_other_run_kinds_only_record_a_dirty_checkout(
    gateway_env: None, data_dir: Path, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    monkeypatch.setattr(runner_module, "_git_dirty", lambda: True)
    preflight(kind, 1)


def test_the_presentation_world_is_dataset_dir_and_the_truth_ledger_path(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One definition: the demo world and its ledger are named by the two
    variables, and its bank is named after the dataset directory."""
    monkeypatch.setenv("DATASET_DIR", str(data_dir / "generated" / "demo-seed2026"))
    monkeypatch.setenv("TRUTH_LEDGER_PATH", str(data_dir / "truth" / "ledger-demo.json"))
    paths = world_paths(PRESENTATION_SEED)
    assert paths.world_dir == data_dir / "generated" / "demo-seed2026"
    assert paths.ledger_path == data_dir / "truth" / "ledger-demo.json"
    assert (
        paths.bank_path
        == data_dir / "evaluation" / "bank" / "bank-2.0.0-scorer-2.2.0-demo-seed2026.json"
    )
    assert world_paths(2027).world_dir == data_dir / "generated" / "dev-seed2027"


def test_a_bank_is_not_current_for_another_world_dir(
    grounded_world: WorldPaths, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = tmp_path / "other"
    shutil.copytree(grounded_world.world_dir, other)
    monkeypatch.setenv("DATASET_DIR", str(other))
    assert not bank_matches_active_world()


def test_the_demo_world_is_grounded_by_its_own_variables(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``ground`` with no arguments grounds the active world from DATASET_DIR
    and TRUTH_LEDGER_PATH into the bank named after that directory."""
    from app.datasets.config import GenerationConfig
    from app.datasets.parquet import write_world
    from app.datasets.schema import TABLE_SCHEMAS
    from app.datasets.world import build_world
    from app.scenarios.engine import apply_scenarios
    from app.scenarios.ledger import build_ledger, write_ledger

    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    outcomes = apply_scenarios(world)
    demo = data_dir / "generated" / "demo-seed2026"
    write_world(demo, TABLE_SCHEMAS, world.tables)
    (demo / "_manifest.json").write_text(json.dumps(world.manifest, indent=2, sort_keys=True))
    ledger = write_ledger(data_dir / "truth" / "ledger-demo.json", build_ledger(outcomes, world))
    monkeypatch.setenv("DATASET_DIR", str(demo))
    monkeypatch.setenv("TRUTH_LEDGER_PATH", str(ledger))
    assert cli.main(["ground"]) == 0
    bank = data_dir / "evaluation" / "bank" / "bank-2.0.0-scorer-2.2.0-demo-seed2026.json"
    assert bank.is_file() and f"wrote {bank}" in capsys.readouterr().out
    assert bank_matches_active_world()


@pytest.mark.parametrize(
    "stale", ["manifest", "ledger", "serialiser", "version", "scorer", "no scorer", "no manifest"]
)
def test_a_bank_is_not_current_once_what_it_was_grounded_on_changes(
    grounded_world: WorldPaths, stale: str
) -> None:
    bank = load_frozen_bank(grounded_world.bank_path)
    if stale == "manifest":
        (grounded_world.world_dir / "_manifest.json").write_text('{"world_seed": 7}')
    elif stale == "ledger":
        grounded_world.ledger_path.write_text('{"world_seed": 7}')
    elif stale == "no manifest":
        (grounded_world.world_dir / "_manifest.json").unlink()
    else:
        changed = {
            "serialiser": dataclasses.replace(bank, record_serialiser_version="0.0.1"),
            "version": dataclasses.replace(bank, bank_version="0.0.1"),
            # A bank grounded for another scorer holds that scorer's answer key.
            "scorer": dataclasses.replace(bank, scorer_version="2.1.0"),
            "no scorer": dataclasses.replace(bank, scorer_version=None),
        }[stale]
        write_frozen_bank(seal_bank(changed), grounded_world.bank_path)
    assert not bank_matches_active_world()


def test_preparing_never_replaces_a_bank_file_a_run_was_made_with(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # D-095: the bank file name carries the scorer, so the v0.2.0 file is
    # never the current one, and a file of the current name is never replaced.
    paths = world_paths(2027)
    paths.bank_path.parent.mkdir(parents=True)
    v020 = paths.bank_path.parent / "bank-2.0.0-dev-seed2027.json"
    v020.write_text("the bank v0.2.0 was made with", encoding="utf-8")
    assert paths.bank_path != v020
    write_frozen_bank(seal_bank(_bank(())), paths.bank_path)
    kept = paths.bank_path.read_bytes()
    grounded_now = seal_bank(dataclasses.replace(_bank(()), ledger_hash="another ledger"))
    monkeypatch.setattr(official, "freeze_bank", lambda world_dir, ledger: grounded_now)
    with pytest.raises(GroundingError, match="holds another bank"):
        official._ground(paths)
    assert paths.bank_path.read_bytes() == kept
    assert v020.read_text(encoding="utf-8") == "the bank v0.2.0 was made with"


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
    [
        ("generator_version", "0.0.1"),
        ("world_seed", 1),
        ("scenario_seed", 1),
        ("profile", "demo"),
    ],
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


def test_a_malformed_but_correctly_hashed_bank_is_grounded_again(recorder: Recorder) -> None:
    paths = prepare_world(2027, recorder.steps)
    content = json.loads(paths.bank_path.read_text())
    content.pop("bank_hash")
    content["instances"][0].pop("text")
    canonical = json.dumps(content, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    content["bank_hash"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    paths.bank_path.write_text(json.dumps(content))
    prepare_world(2027, recorder.steps)
    assert recorder.grounded == [2027, 2027]


# --- Instance selection --------------------------------------------------------


def _bank(instances: tuple[BankInstance, ...]) -> FrozenBank:
    return FrozenBank(
        bank_version=BANK_VERSION,
        world_seed=2026,
        world_manifest_hash="m",
        record_serialiser_version=RECORD_SERIALISER_VERSION,
        scorer_version=SCORER_VERSION,
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


def test_questions_filter_keeps_only_named_questions() -> None:
    instances = tuple(
        _instance(question_id, stratum, 2026, anchor=anchor)
        for question_id, stratum in (("L01", "H3"), ("L05", "H1"), ("L06", "H1"))
        for anchor in ("X1", "X2")
    )
    bank = select_instances(_bank(instances), strata=None, limit=1, questions=["L01", "L05"])
    assert [i.instance_id for i in bank.instances] == ["L01-2026-X1", "L05-2026-X1"]
    # An unavailable question that was not asked for is not reported.
    assert [u.question_id for u in bank.unavailable] == ["L01"]


def test_unknown_question_id_refused() -> None:
    with pytest.raises(ValueError, match="L99"):
        select_instances(_bank(()), strata=None, limit=None, questions=["L01", "L99"])


def test_dry_run_questions_are_the_demo_instances_of_the_frozen_bank(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    instances = tuple(
        _instance(question_id, stratum, 2026, anchor=anchor)
        for question_id, stratum in (
            ("L05", "H1"),
            ("L06", "H1"),
            ("L09", "H2"),
            ("L01", "H3"),
            ("L15", "H5"),
            ("L20", "H4"),
        )
        for anchor in ("X1", "X2")
    )
    world_dir = tmp_path / "dev-seed2026"
    monkeypatch.setattr(official, "_dev_presentation_world", lambda: (world_dir, tmp_path))
    monkeypatch.setattr(official, "bank_path_for", lambda world: world / "bank.json")
    monkeypatch.setattr(official, "load_frozen_bank", lambda path: _bank(instances))
    assert official.dry_run_question_ids() == ["L05", "L09", "L01", "L15"]


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
    assert summary["schema_version"] == "3"
    assert summary["label"] == "scorer smoke test"
    assert summary["worlds"] == [2026, 2027]
    assert [w["world_seed"] for w in results["reproducibility"]["worlds"]] == [2026, 2027]
    assert results["selection"] == summary["selection"] == {"strata": None, "limit": None}
    assert (recorder.tmp / "report.md").read_text().startswith("# Benchmark run")


def test_run_files_are_written_atomically(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    replaced: list[tuple[Path, Path]] = []
    real_replace = os.replace

    def spy(source: str | os.PathLike[str], target: str | os.PathLike[str]) -> None:
        replaced.append((Path(source), Path(target)))
        real_replace(source, target)

    monkeypatch.setattr(os, "replace", spy)
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
    assert targets == ["2026.json", "results.json", "report.md", "summary.json"]
    assert all(source.parent == target.parent for source, target in replaced)
    assert all(source.name != target.name for source, target in replaced)
    assert sorted(p.name for p in recorder.tmp.iterdir()) == [
        "report.md",
        "results.json",
        "summary.json",
        "worlds",
    ]


def test_a_failed_write_leaves_no_partial_file(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(source: str | os.PathLike[str], target: str | os.PathLike[str]) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", broken)
    with pytest.raises(OSError, match="disk full"):
        run_benchmark(
            "smoke",
            (2026,),
            repeats=1,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
        )
    assert list(recorder.tmp.rglob("*")) == [recorder.tmp / "worlds"]


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


def test_the_sweep_runs_h1_with_b_and_c_at_every_depth(
    recorder: Recorder, gateway_env: None
) -> None:
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
    recorder: Recorder, gateway_env: None
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
    record = sweep["depths"]["2"]["reproducibility"]
    assert record["run"]["graph_limits"]["depth"] == 2
    assert [w["world_seed"] for w in record["worlds"]] == [2026]
    text = json.dumps(sweep)
    assert "p_holm" not in text and "headlines" not in text
    # The API publishes summary.json only, so a sweep never becomes the latest run.
    assert not (recorder.tmp / "summary.json").exists()
    assert (recorder.tmp / "results.json").exists()
    assert "| 2 | C |" in (recorder.tmp / "report.md").read_text()


def test_a_failed_sweep_still_restores_the_presentation_graph(
    recorder_failing_on_2027: Recorder, gateway_env: None
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
    assert kwargs == {
        "repeats": 3,
        "out_dir": out,
        "strata": ["H1", "H3"],
        "limit": 2,
        "resume": False,
        "questions": None,
    }


def test_cli_run_passes_the_questions(captured: dict[str, Any], tmp_path: Path) -> None:
    cli.main(["run", "--kind", "smoke", "--questions", "L01, L05", "--out", str(tmp_path / "o")])
    assert captured["run"][1]["questions"] == ["L01", "L05"]


def test_cli_prints_the_dry_run_questions(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(official, "dry_run_question_ids", lambda: ["L05", "L09"])
    assert cli.main(["dry-run-questions"]) == 0
    assert capsys.readouterr().out == "L05,L09\n"


def test_cli_run_defaults_to_three_seeds_and_a_run_directory(
    captured: dict[str, Any], data_dir: Path
) -> None:
    cli.main(["run", "--kind", "smoke"])
    args, kwargs = captured["run"]
    assert args == ("smoke", SEEN_SEEDS)
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


@pytest.mark.parametrize("command", [["run", "--kind", "official"], ["sweep"]])
@pytest.mark.parametrize("repeats", ["0", "-1", "two"])
def test_cli_refuses_repeats_below_one(
    captured: dict[str, Any],
    data_dir: Path,
    capsys: pytest.CaptureFixture[str],
    command: list[str],
    repeats: str,
) -> None:
    """``--repeats 0`` is refused, never silently replaced by the default."""
    with pytest.raises(SystemExit) as exit_info:
        cli.main([*command, "--repeats", repeats])
    assert exit_info.value.code == 2
    assert "repeats must be a whole number of at least 1" in capsys.readouterr().err
    assert captured == {}


def test_cli_run_passes_an_explicit_repeat_count(captured: dict[str, Any], data_dir: Path) -> None:
    cli.main(["run", "--kind", "official", "--repeats", "5"])
    assert captured["run"][1]["repeats"] == 5


def test_cli_compare_writes_comparison_json(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official("small-model"))
    large = _write_run(tmp_path / "large", _official("large-model"))
    out = tmp_path / "cmp"
    assert cli.main(["compare", str(small), str(large), "--out", str(out)]) == 0
    written = json.loads((out / "comparison.json").read_text())
    assert written["hypothesis"] == "H7"


# --- Fix round 1: run record, restore failures, selection, preflight -----------


def test_a_multi_world_summary_names_no_single_world_at_run_level(recorder: Recorder) -> None:
    run_benchmark(
        "smoke",
        (2026, 2027),
        repeats=1,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    summary = json.loads((recorder.tmp / "summary.json").read_text())
    record = summary["reproducibility"]
    for field in ("world_seed", "world_dir", "bank_hash"):
        assert field not in record["run"]
    assert record["run"]["generation_model"] == "fake-answer-v1"
    assert record["run"]["started_at"] == "2026-10-19T10:00:00+00:00"
    assert [w["world_seed"] for w in record["worlds"]] == [2026, 2027]
    assert record["worlds"][0]["bank_hash"] != record["worlds"][1]["bank_hash"]
    report = (recorder.tmp / "report.md").read_text()
    assert "### World 2026" in report and "### World 2027" in report
    run_part = report.split("### World 2026")[0].split("## Reproducibility")[1]
    assert "world_seed" not in run_part and "bank_hash" not in run_part


def test_a_failed_restore_keeps_the_world_failure(tmp_path: Path, data_dir: Path) -> None:
    recorder = Recorder(tmp_path, fail_on=2027, restore_fails=True)
    with pytest.raises(RuntimeError, match="world 2027") as raised:
        run_benchmark(
            "smoke",
            (2026, 2027),
            repeats=1,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
        )
    notes = getattr(raised.value, "__notes__", [])
    assert any("presentation graph" in note and "Neo4j is down" in note for note in notes)
    assert recorder.ingested == [2026, 2027, 2026]


def test_a_failed_restore_after_a_good_run_is_raised(tmp_path: Path, data_dir: Path) -> None:
    recorder = Recorder(tmp_path, restore_fails=True)
    with pytest.raises(ConnectionError, match="Neo4j is down"):
        run_benchmark(
            "smoke",
            (2026,),
            repeats=1,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
        )


def test_a_subset_run_records_its_selection_and_is_labelled(
    recorder: Recorder, gateway_env: None
) -> None:
    run = run_benchmark(
        "official",
        (2026,),
        repeats=3,
        out_dir=recorder.tmp,
        strata=["H1"],
        limit=1,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    summary = json.loads((recorder.tmp / "summary.json").read_text())
    results = json.loads((recorder.tmp / "results.json").read_text())
    assert summary["selection"] == results["selection"] == {"strata": ["H1"], "limit": 1}
    assert run.label == summary["label"]
    assert summary["label"] == "subset run (strata H1; at most 1 instance per question)"
    assert (
        "Selection: strata H1; at most 1 instance per question."
        in (recorder.tmp / "report.md").read_text()
    )


def test_selection_records_questions(recorder: Recorder, gateway_env: None) -> None:
    run = run_benchmark(
        "official",
        (2026,),
        repeats=3,
        out_dir=recorder.tmp,
        limit=1,
        questions=["L01", "L05"],
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    summary = json.loads((recorder.tmp / "summary.json").read_text())
    assert summary["selection"] == {"strata": None, "limit": 1, "questions": ["L01", "L05"]}
    assert run.label == "subset run (questions L01, L05; at most 1 instance per question)"
    assert _kept(recorder, 2026)["selection"] == summary["selection"]


def test_an_unknown_question_is_refused_before_any_world_is_prepared(recorder: Recorder) -> None:
    with pytest.raises(ValueError, match="L99"):
        _run(recorder, questions=["L99"])
    assert recorder.ingested == []


def test_a_full_official_run_has_no_label(recorder: Recorder, gateway_env: None) -> None:
    run_benchmark(
        "official",
        OFFICIAL_SEEDS,
        repeats=3,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    summary = json.loads((recorder.tmp / "summary.json").read_text())
    assert summary["label"] is None
    assert summary["selection"] == {"strata": None, "limit": None}


def test_compare_refuses_runs_of_different_selections(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official("small-model"))
    subset = dataclasses.replace(
        _official("large-model"), selection=Selection(strata=("H1",), limit=None)
    )
    large = _write_run(tmp_path / "large", subset)
    with pytest.raises(ValueError, match="selection"):
        compare_runs(small, large)


def _official_with(model: str, **changes: Any) -> BenchmarkRun:
    run = _official(model)
    return dataclasses.replace(run, record=dataclasses.replace(run.record, **changes))


def _compare_with(tmp_path: Path, **changes: Any) -> dict[str, Any]:
    small = _write_run(tmp_path / "small", _official("small-model"))
    large = _write_run(tmp_path / "large", _official_with("large-model", **changes))
    return compare_runs(small, large)


def test_compare_refuses_different_max_tokens(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="max_tokens"):
        _compare_with(tmp_path, max_tokens=4096)


def test_compare_refuses_different_reasoning(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="generation_reasoning"):
        _compare_with(tmp_path, generation_reasoning="off")


def test_compare_refuses_different_judge(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="judge_model") as error:
        _compare_with(tmp_path, judge_model="another-judge")
    assert "fake-judge-v1" in str(error.value) and "another-judge" in str(error.value)


def test_compare_names_every_differing_field(tmp_path: Path) -> None:
    with pytest.raises(ValueError) as error:
        _compare_with(tmp_path, max_tokens=4096, top_k=3, judge_temperature=0.7)
    for name in ("max_tokens", "top_k", "judge_temperature"):
        assert name in str(error.value)


def test_compare_accepts_runs_that_differ_only_in_the_model(tmp_path: Path) -> None:
    comparison = _compare_with(
        tmp_path,
        git_sha="other",
        git_dirty=True,
        started_at="2026-11-01T00:00:00+00:00",
        generation_model_family="another",
        generation_quantisation="q4",
    )
    assert comparison["large"]["generation_model"] == "large-model"


def _official_with_world_records(model: str, order: tuple[int, ...]) -> BenchmarkRun:
    run = _official(model)
    worlds = [
        dataclasses.replace(
            world, record=dataclasses.replace(run.record, world_seed=world.world_seed)
        )
        for world in run.worlds
    ]
    return dataclasses.replace(run, worlds=sorted(worlds, key=lambda w: order.index(w.world_seed)))


def test_compare_pairs_worlds_by_seed_whatever_their_order(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official_with_world_records("small", (2026, 2027)))
    large = _write_run(tmp_path / "large", _official_with_world_records("large", (2027, 2026)))
    assert compare_runs(small, large)["hypothesis"] == "H7"


def test_compare_shows_a_difference_in_code_revision(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official("small-model"))
    large = _write_run(tmp_path / "large", _official_with("large-model", git_sha="def456"))
    comparison = compare_runs(small, large)
    assert (comparison["small"]["git_sha"], comparison["large"]["git_sha"]) == ("abc123", "def456")
    assert "different code revisions: small abc123, large def456" in official.render_comparison(
        comparison
    )


def test_cli_resolves_a_relative_out_from_the_repository_root(captured: dict[str, Any]) -> None:
    cli.main(["run", "--kind", "smoke", "--out", "data/evaluation/runs/x", "--resume"])
    assert captured["run"][1]["out_dir"] == REPO_ROOT / "data/evaluation/runs/x"


@pytest.mark.parametrize(
    ("kind", "repeats", "env", "match"),
    [
        ("nightly", 1, {}, "unknown run kind"),
        ("smoke", 0, {}, "repeats"),
        ("official", 1, {}, "at least 3 repeats"),
        ("official", 3, {"GENERATION_PROVIDER": "fake"}, "fake generator"),
        ("official", 3, {"GENERATION_MODEL_FAMILY": ""}, "GENERATION_MODEL_FAMILY"),
        ("official", 3, {"JUDGE_PROVIDER": "fake"}, "JUDGE_PROVIDER"),
        ("official", 3, {"JUDGE_MODEL_FAMILY": "Qwen"}, "family"),
        ("sweep", 3, {"GENERATION_PROVIDER": "fake"}, "fake generator"),
        ("sweep", 3, {"JUDGE_PROVIDER": "fake"}, "JUDGE_PROVIDER"),
    ],
)
def test_settings_are_checked_before_any_world_is_prepared(
    recorder: Recorder,
    gateway_env: None,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    repeats: int,
    env: dict[str, str],
    match: str,
) -> None:
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=match):
        if kind == "sweep":
            run_sweep(
                (2026,),
                out_dir=recorder.tmp,
                repeats=repeats,
                steps=recorder.steps,
                runner_factory=recorder.runner,
            )
        else:
            run_benchmark(
                kind,
                (2026,),
                repeats=repeats,
                out_dir=recorder.tmp,
                steps=recorder.steps,
                runner_factory=recorder.runner,
            )
    assert recorder.generated == recorder.ingested == []


# --- Kept worlds and resume ------------------------------------------------------


# A full-bank official run uses exactly the six unseen worlds.
UNSEEN_RUN = OFFICIAL_SEEDS


def _run(recorder: Recorder, seeds: tuple[int, ...] = (2026, 2027, 2028), **options: Any) -> Any:
    options = {"kind": "smoke", "repeats": 1, **options}
    return run_benchmark(
        options.pop("kind"),
        seeds,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
        **options,
    )


def _kept(recorder: Recorder, seed: int) -> dict[str, Any]:
    kept: dict[str, Any] = json.loads((recorder.tmp / "worlds" / f"{seed}.json").read_text())
    return kept


def _edit_kept(recorder: Recorder, seed: int, edit: Callable[[dict[str, Any]], None]) -> None:
    saved = _kept(recorder, seed)
    edit(saved)
    (recorder.tmp / "worlds" / f"{seed}.json").write_text(json.dumps(saved))


def _failed_then_fresh(tmp_path: Path, **options: Any) -> tuple[Recorder, Recorder]:
    """A run that kept world 2026 and failed in 2027, and a recorder to resume it.

    A full-bank official run uses the unseen worlds, so it keeps 2029 and fails in 2030.
    """
    if options.get("kind") == "official":
        failing = Recorder(tmp_path, fail_on=2030)
        options = {"seeds": UNSEEN_RUN, **options}
    else:
        failing = Recorder(tmp_path, fail_on=2027)
    with pytest.raises(RuntimeError, match=r"world 20(27|30) failed"):
        _run(failing, **options)
    return failing, Recorder(tmp_path)


def test_failed_world_keeps_completed_worlds(recorder_failing_on_2027: Recorder) -> None:
    recorder = recorder_failing_on_2027
    with pytest.raises(RuntimeError, match="world 2027 failed"):
        _run(recorder)
    saved = _kept(recorder, 2026)
    assert saved["kind"] == "smoke" and saved["selection"] == {"strata": None, "limit": None}
    assert saved["world"]["world_seed"] == 2026 and saved["world"]["results"]
    assert saved["record"]["world_seed"] == 2026
    assert not (recorder.tmp / "worlds" / "2027.json").exists()
    for name in ("summary.json", "results.json", "report.md"):
        assert not (recorder.tmp / name).exists()
    assert recorder.ingested[-1] == 2026


def test_resume_skips_kept_worlds(tmp_path: Path, data_dir: Path) -> None:
    _, fresh = _failed_then_fresh(tmp_path)
    _run(fresh, resume=True)
    assert [r["seed"] for r in fresh.runners] == [2027, 2028]
    clean = Recorder(tmp_path / "clean")
    _run(clean)
    resumed = json.loads((fresh.tmp / "results.json").read_text())
    expected = json.loads((clean.tmp / "results.json").read_text())
    for payload in (resumed, expected):
        for record in (payload["reproducibility"]["run"], *payload["reproducibility"]["worlds"]):
            record.pop("started_at")
    assert resumed == expected
    summaries = [json.loads((r.tmp / "summary.json").read_text()) for r in (fresh, clean)]
    for summary in summaries:
        summary["reproducibility"]["run"].pop("started_at")
    assert summaries[0] == summaries[1]
    assert sorted(p.name for p in (fresh.tmp / "worlds").iterdir()) == [
        "2026.json",
        "2027.json",
        "2028.json",
    ]


def test_resume_refuses_different_settings(
    tmp_path: Path, gateway_env: None, data_dir: Path
) -> None:
    failing, fresh = _failed_then_fresh(tmp_path, kind="official", repeats=3)
    _edit_kept(failing, 2029, lambda saved: saved["record"].update(max_tokens=4096))
    with pytest.raises(ValueError, match="max_tokens") as error:
        _run(fresh, UNSEEN_RUN, kind="official", repeats=3, resume=True)
    assert "4096" in str(error.value)
    assert fresh.generated == fresh.ingested == [] and fresh.runners == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("top_k", 3),
        ("graph_limits", {"depth": 9}),
        ("git_sha", "other"),
        ("ranking_weights", {"w": 9.0}),
        ("prompt_hash", "edited"),
        ("scorer_version", "0.0.1"),
    ],
)
def test_resume_refuses_retrieval_settings_before_any_world_is_prepared(
    tmp_path: Path, data_dir: Path, field: str, value: Any
) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)
    _edit_kept(failing, 2026, lambda saved: saved["record"].update({field: value}))
    with pytest.raises(ValueError, match=field):
        _run(fresh, resume=True)
    assert fresh.generated == fresh.ingested == [] and fresh.runners == []


def test_resume_refuses_a_changed_model_component_before_the_world_is_scored(
    tmp_path: Path, data_dir: Path
) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)
    _edit_kept(failing, 2026, lambda saved: saved["record"].update(embedding_model="other"))
    with pytest.raises(ValueError, match="embedding_model"):
        _run(fresh, resume=True)
    assert len(fresh.made) == 1 and not fresh.made[0].ran
    assert not (fresh.tmp / "worlds" / "2027.json").exists()
    assert fresh.ingested[-1] == 2026


def test_an_official_run_resumes_only_from_a_clean_checkout(
    tmp_path: Path, gateway_env: None, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing, fresh = _failed_then_fresh(tmp_path, kind="official", repeats=3)
    monkeypatch.setattr(runner_module, "_git_dirty", lambda: True)
    with pytest.raises(ValueError, match="clean checkout"):
        _run(fresh, UNSEEN_RUN, kind="official", repeats=3, resume=True)
    monkeypatch.setattr(runner_module, "_git_dirty", lambda: False)
    _edit_kept(failing, 2029, lambda saved: saved["record"].update(git_dirty=True))
    with pytest.raises(ValueError, match="kept world 2029 was run on a checkout with uncommitted"):
        _run(fresh, UNSEEN_RUN, kind="official", repeats=3, resume=True)
    assert fresh.generated == fresh.ingested == [] and fresh.runners == []


def test_a_smoke_run_may_resume_across_a_dirty_checkout(
    tmp_path: Path, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)
    _edit_kept(failing, 2026, lambda saved: saved["record"].update(git_dirty=True))
    monkeypatch.setattr(runner_module, "_git_dirty", lambda: True)
    _run(fresh, resume=True)
    assert [r["seed"] for r in fresh.runners] == [2027, 2028]


def test_a_smoke_resume_uses_the_stand_in_generators_name(
    tmp_path: Path, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)
    # What the real smoke runner records, whatever the environment names.
    _edit_kept(
        failing, 2026, lambda saved: saved["record"].update(generation_model="fake-answer-v1")
    )
    monkeypatch.setenv("GENERATION_MODEL", "ollama/qwen3.6:latest")
    assert official.current_settings("smoke", 1, 2026, 2)["generation_model"] == "fake-answer-v1"
    _run(fresh, resume=True)
    assert [r["seed"] for r in fresh.runners] == [2027, 2028]


def test_cli_joins_a_relative_out_to_the_repository_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    assert cli._resolved(Path("data/runs/x")) == tmp_path / "data/runs/x"
    assert cli._resolved(tmp_path / "abs") == tmp_path / "abs"
    assert cli._resolved(None) is None


def test_resume_refuses_a_directory_that_does_not_exist(recorder: Recorder) -> None:
    with pytest.raises(FileNotFoundError, match="no run to resume"):
        _run(recorder, resume=True)
    assert recorder.generated == recorder.ingested == [] and not recorder.tmp.exists()


def test_resume_names_an_unreadable_kept_file(tmp_path: Path, data_dir: Path) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)
    (failing.tmp / "worlds" / "2026.json").write_text("")
    (failing.tmp / "worlds" / "notes.json").write_text("not a world")
    with pytest.raises(ValueError, match=r"2026\.json cannot be read"):
        _run(fresh, resume=True)
    assert fresh.generated == []


def test_resume_refuses_kept_worlds_that_disagree(tmp_path: Path, data_dir: Path) -> None:
    failing = Recorder(tmp_path, fail_on=2028)
    with pytest.raises(RuntimeError):
        _run(failing)
    _edit_kept(failing, 2027, lambda saved: saved["record"].update(max_tokens=4096))
    fresh = Recorder(tmp_path)
    with pytest.raises(ValueError, match="max_tokens"):
        _run(fresh, resume=True)
    assert fresh.generated == []


def test_resume_refuses_a_kept_world_of_another_bank(tmp_path: Path, data_dir: Path) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)
    _edit_kept(failing, 2026, lambda saved: saved["world"].update(bank_hash="stale"))
    with pytest.raises(ValueError, match="bank"):
        _run(fresh, resume=True)
    assert fresh.generated == []


def test_resume_refuses_a_different_selection(tmp_path: Path, data_dir: Path) -> None:
    _, fresh = _failed_then_fresh(tmp_path)
    with pytest.raises(ValueError, match="kept world 2026 was a smoke run"):
        _run(fresh, resume=True, strata=("H1",))
    assert fresh.generated == []


def test_compare_and_resume_treat_questions_as_selection(tmp_path: Path, data_dir: Path) -> None:
    _, fresh = _failed_then_fresh(tmp_path, questions=["L01"])
    with pytest.raises(ValueError, match="kept world 2026 was a smoke run"):
        _run(fresh, resume=True)
    with pytest.raises(ValueError, match="kept world 2026 was a smoke run"):
        _run(fresh, resume=True, questions=["L05"])
    assert fresh.generated == []
    _run(fresh, resume=True, questions=["L01"])
    assert [r["seed"] for r in fresh.runners] == [2027, 2028]
    small = _write_run(tmp_path / "small", _official("small-model"))
    subset = dataclasses.replace(_official("large-model"), selection=Selection(questions=("L01",)))
    with pytest.raises(ValueError, match="selection"):
        compare_runs(small, _write_run(tmp_path / "large", subset))


def test_a_stored_selection_without_questions_still_resumes(tmp_path: Path, data_dir: Path) -> None:
    _, fresh = _failed_then_fresh(tmp_path)
    _edit_kept(fresh, 2026, lambda saved: saved["selection"].pop("questions", None))
    _run(fresh, resume=True)
    assert [r["seed"] for r in fresh.runners] == [2027, 2028]


def test_resume_refuses_a_different_kind(tmp_path: Path, data_dir: Path, gateway_env: None) -> None:
    _, fresh = _failed_then_fresh(tmp_path)
    with pytest.raises(ValueError, match="kept world 2026 was a smoke run"):
        _run(fresh, (2026,), resume=True, kind="dev")
    assert fresh.generated == []


def test_resume_without_kept_worlds_is_an_ordinary_run(recorder: Recorder) -> None:
    recorder.tmp.mkdir()
    _run(recorder, resume=True)
    assert [r["seed"] for r in recorder.runners] == [2026, 2027, 2028]
    assert (recorder.tmp / "summary.json").exists()


def test_kept_worlds_without_resume_are_refused(tmp_path: Path, data_dir: Path) -> None:
    _, fresh = _failed_then_fresh(tmp_path)
    with pytest.raises(FileExistsError, match="resume"):
        _run(fresh)
    assert fresh.generated == []


def test_a_used_dir_is_refused_without_resume(recorder: Recorder) -> None:
    _run(recorder)
    with pytest.raises(FileExistsError, match=r"results\.json"):
        _run(recorder)
    assert recorder.generated == [2026, 2027, 2028]


def test_a_finished_run_is_not_resumed(recorder: Recorder) -> None:
    _run(recorder)
    with pytest.raises(FileExistsError, match=r"summary\.json"):
        _run(recorder, resume=True)
    assert recorder.generated == [2026, 2027, 2028]


def test_resume_finishes_a_run_that_stopped_before_summary_json(
    recorder: Recorder,
) -> None:
    _run(recorder)
    expected = (recorder.tmp / "summary.json").read_text()
    (recorder.tmp / "summary.json").unlink()
    (recorder.tmp / "report.md").unlink()
    (recorder.tmp / "results.json").write_text("{}")
    fresh = Recorder(recorder.tmp.parent)
    _run(fresh, resume=True)
    assert fresh.runners == []
    assert (recorder.tmp / "summary.json").read_text() == expected
    assert (recorder.tmp / "report.md").exists()
    assert json.loads((recorder.tmp / "results.json").read_text()) != {}


def test_the_selection_rule_is_recorded(recorder: Recorder) -> None:
    _run(recorder)
    assert _kept(recorder, 2026)["record"]["selection_rule"] == SELECTION_RULE


@pytest.mark.parametrize("change", ["other", None])
def test_resume_refuses_another_or_a_missing_selection_rule(
    tmp_path: Path, data_dir: Path, change: str | None
) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)

    def edit(saved: dict[str, Any]) -> None:
        if change is None:
            del saved["record"]["selection_rule"]
        else:
            saved["record"]["selection_rule"] = change

    _edit_kept(failing, 2026, edit)
    with pytest.raises(ValueError, match="selection_rule"):
        _run(fresh, resume=True)
    assert fresh.generated == fresh.ingested == [] and fresh.runners == []


def test_compare_refuses_runs_under_different_selection_rules(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="selection_rule"):
        _compare_with(tmp_path, selection_rule="another-rule")


def test_compare_refuses_a_run_from_before_the_rule_was_recorded(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official_with("small-model", selection_rule=None))
    large = _write_run(
        tmp_path / "large", _official_with("large-model", selection_rule=SELECTION_RULE)
    )
    with pytest.raises(ValueError, match="selection_rule"):
        compare_runs(small, large)


def test_a_record_from_before_the_rule_was_recorded_still_loads() -> None:
    payload = _record("official").to_payload()
    del payload["selection_rule"]
    assert ReproducibilityRecord(**payload).selection_rule is None


@pytest.mark.parametrize(
    ("strata", "questions"),
    [(("H1",), ["L01"]), (("H1", "H2"), ["L01", "L05"]), (("H3",), ["L05"])],
)
def test_a_question_outside_the_strata_is_refused_before_any_world_is_prepared(
    recorder: Recorder, strata: tuple[str, ...], questions: list[str]
) -> None:
    with pytest.raises(ValueError, match="nothing is selected"):
        _run(recorder, strata=strata, questions=questions)
    assert recorder.generated == recorder.ingested == []


def test_a_selection_no_frozen_bank_matches_is_refused_before_any_world_is_prepared(
    recorder: Recorder,
) -> None:
    _run(recorder)  # grounds the three banks
    fresh = Recorder(recorder.tmp.parent / "again")
    with pytest.raises(ValueError, match="no instance in the frozen bank"):
        _run(fresh, questions=["L02"], strata=None)
    assert fresh.generated == fresh.ingested == []


def test_cli_resume_needs_out(captured: dict[str, Any], tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        cli.main(["run", "--kind", "smoke", "--resume"])
    assert "run" not in captured
    cli.main(["run", "--kind", "smoke", "--resume", "--out", str(tmp_path / "out")])
    assert captured["run"][1]["resume"] is True


def test_make_dry_run_recipe_passes_the_official_run_checks() -> None:
    """The recipe, as ``make -n`` prints it (the shell never runs), parses with
    the CLI's own parser and satisfies the official run configuration."""
    env = {**os.environ, "GENERATION_PROVIDER": "litellm", "JUDGE_PROVIDER": "litellm"}
    repo = Path(__file__).resolve().parents[2]
    printed = subprocess.run(
        ["make", "-n", "dry-run"], cwd=repo, env=env, capture_output=True, text=True, check=True
    ).stdout
    line = next(row for row in printed.splitlines() if "app.evaluation run" in row)
    words = shlex.split(line.split("app.evaluation", 1)[1])
    words = [w for w in words if not w.startswith("$(") and w != ")"]
    arguments = cli.build_parser().parse_args(words[: words.index("--questions")])
    assert arguments.kind == "official"
    assert arguments.seeds == (2026,)
    assert arguments.limit == 1
    runner_module.check_run_config(arguments.kind, arguments.repeats, False, "family")
    official.check_seeds(arguments.kind, arguments.seeds, full_bank=False)


def _make_run_arguments(target: str) -> Any:
    """The CLI arguments of a make target's run line, as ``make -n`` prints it."""
    env = {**os.environ, "GENERATION_PROVIDER": "litellm", "JUDGE_PROVIDER": "litellm"}
    repo = Path(__file__).resolve().parents[2]
    printed = subprocess.run(
        ["make", "-n", target], cwd=repo, env=env, capture_output=True, text=True, check=True
    ).stdout
    line = next(row for row in printed.splitlines() if "app.evaluation run" in row)
    return cli.build_parser().parse_args(shlex.split(line.split("app.evaluation", 1)[1]))


def test_make_run_benchmark_runs_the_unseen_seeds() -> None:
    arguments = _make_run_arguments("run-benchmark")
    assert arguments.kind == "official" and arguments.repeats == 3
    assert arguments.seeds == OFFICIAL_SEEDS == (2029, 2030, 2031, 2032, 2033, 2034)
    official.check_seeds(arguments.kind, arguments.seeds, full_bank=True)


def test_make_dev_run_is_a_dev_run_on_seed_2026() -> None:
    arguments = _make_run_arguments("dev-run")
    assert (arguments.kind, arguments.seeds, arguments.repeats) == ("dev", (2026,), 1)
    assert arguments.strata is None and arguments.limit is None
    official.check_seeds(arguments.kind, arguments.seeds, full_bank=True)


# --- Method v0.3: the method in the record, unseen seeds and dev runs ------------


def test_method_of_defaults_old_runs_to_0_2_0() -> None:
    assert official.method_of({}) == "0.2.0"
    assert official.method_of({"method_version": None}) == "0.2.0"
    assert official.method_of({"method_version": "0.3.0"}) == "0.3.0"
    assert official.method_of(_record("official").to_payload()) == "0.2.0"


def test_compare_refuses_old_and_new_method(tmp_path: Path) -> None:
    small = _write_run(tmp_path / "small", _official("small-model"))
    large = _write_run(tmp_path / "large", _official_with("large-model", method_version="0.3.0"))
    with pytest.raises(ValueError) as error:
        compare_runs(small, large)
    message = str(error.value)
    assert "method v0.2.0" in message and "method v0.3.0" in message
    # Refused before the settings are compared, with the plain reason only.
    assert "different settings" not in message


@pytest.mark.parametrize(
    ("method_version", "evidence_metric", "other_metric"),
    [(None, "evidence_f1", "evidence_recall"), ("0.3.0", "evidence_recall", "evidence_f1")],
)
def test_compare_uses_the_evidence_metric_of_the_runs_method(
    tmp_path: Path, method_version: str | None, evidence_metric: str, other_metric: str
) -> None:
    small = _write_run(
        tmp_path / "small", _official_with("small-model", method_version=method_version)
    )
    large = _write_run(
        tmp_path / "large", _official_with("large-model", method_version=method_version)
    )
    metrics = {cell["metric"] for cell in compare_runs(small, large)["cells"]}
    assert metrics == {evidence_metric, "answer"}
    assert other_metric not in metrics


def test_resume_refuses_a_kept_world_of_the_old_method(tmp_path: Path, data_dir: Path) -> None:
    failing, fresh = _failed_then_fresh(tmp_path)
    _edit_kept(failing, 2026, lambda saved: saved["record"].pop("method_version"))
    with pytest.raises(ValueError, match="method_version") as error:
        _run(fresh, resume=True)
    assert "method v0.2.0" in str(error.value) and "method v0.3.0" in str(error.value)
    assert fresh.generated == fresh.ingested == [] and fresh.runners == []


@pytest.mark.parametrize(
    "seeds",
    [
        (2026,),
        (2028,),
        (2028, 2029),
        # A subset of the unseen worlds would use them up before the frozen run.
        (2029,),
        (2029, 2030),
        OFFICIAL_SEEDS[:-1],
        # A seed outside the plan, alone or beside the six.
        (2035,),
        (*OFFICIAL_SEEDS, 2035),
    ],
)
def test_full_official_run_refuses_seen_seeds(
    recorder: Recorder, gateway_env: None, seeds: tuple[int, ...]
) -> None:
    with pytest.raises(ValueError, match="2029"):
        run_benchmark(
            "official",
            seeds,
            repeats=3,
            out_dir=recorder.tmp,
            steps=recorder.steps,
            runner_factory=recorder.runner,
        )
    assert recorder.generated == recorder.ingested == [] and recorder.runners == []


@pytest.mark.parametrize(
    ("kind", "seeds", "full_bank"),
    [
        # Every unseen seed is there, so a comparison of sets alone would pass it.
        ("official", (*OFFICIAL_SEEDS, 2029), True),
        ("official", (2026, 2026), False),
        ("smoke", (2026, 2027, 2026), True),
        ("sweep", (2027, 2027), False),
    ],
)
def test_repeated_seeds_are_refused(kind: str, seeds: tuple[int, ...], full_bank: bool) -> None:
    with pytest.raises(ValueError, match="seeds must not repeat"):
        official.check_seeds(kind, seeds, full_bank=full_bank)


def test_a_run_naming_a_seed_twice_is_refused_before_any_world_is_prepared(
    recorder: Recorder,
) -> None:
    with pytest.raises(ValueError, match="seeds must not repeat"):
        _run(recorder, seeds=(2026, 2027, 2026))
    assert recorder.generated == recorder.ingested == [] and recorder.runners == []


def test_the_dry_run_on_seed_2026_passes_the_seed_guard(
    recorder: Recorder, gateway_env: None
) -> None:
    run_benchmark(
        "official",
        (2026,),
        repeats=3,
        out_dir=recorder.tmp,
        limit=1,
        questions=["L01", "L05"],
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    assert [r["seed"] for r in recorder.runners] == [2026]


def test_a_full_official_run_on_exactly_the_six_unseen_seeds_passes(
    recorder: Recorder, gateway_env: None
) -> None:
    run_benchmark(
        "official",
        OFFICIAL_SEEDS,
        repeats=3,
        out_dir=recorder.tmp,
        steps=recorder.steps,
        runner_factory=recorder.runner,
    )
    assert [r["seed"] for r in recorder.runners] == list(OFFICIAL_SEEDS)


@pytest.mark.parametrize("selection", [{"limit": 1}, {"strata": ["H1"]}, {"questions": ["L01"]}])
@pytest.mark.parametrize("seeds", [(2029,), (2026, 2034)])
def test_a_dry_run_refuses_unseen_seeds(
    recorder: Recorder, gateway_env: None, seeds: tuple[int, ...], selection: dict[str, Any]
) -> None:
    with pytest.raises(ValueError, match="unseen"):
        _run(recorder, seeds=seeds, kind="official", repeats=3, **selection)
    assert recorder.generated == recorder.ingested == [] and recorder.runners == []


def test_a_smoke_run_refuses_unseen_seeds(recorder: Recorder) -> None:
    with pytest.raises(ValueError, match="unseen"):
        _run(recorder, seeds=(2028, 2029))
    assert recorder.generated == recorder.ingested == [] and recorder.runners == []


def test_a_sweep_refuses_unseen_seeds(recorder: Recorder, gateway_env: None) -> None:
    with pytest.raises(ValueError, match="unseen"):
        run_sweep(
            (2030,), out_dir=recorder.tmp, steps=recorder.steps, runner_factory=recorder.runner
        )
    assert recorder.generated == recorder.ingested == [] and recorder.runners == []


@pytest.mark.parametrize("seeds", [(2027,), (2026, 2027), (2029,)])
def test_dev_run_only_on_seed_2026(
    recorder: Recorder, gateway_env: None, seeds: tuple[int, ...]
) -> None:
    with pytest.raises(ValueError, match="seed 2026 only"):
        _run(recorder, seeds=seeds, kind="dev")
    assert recorder.generated == recorder.ingested == [] and recorder.runners == []


def test_dev_run_accepts_one_repeat(recorder: Recorder, gateway_env: None) -> None:
    _run(recorder, seeds=(2026,), kind="dev", repeats=1)
    assert [(r["seed"], r["kind"]) for r in recorder.runners] == [(2026, "dev")]
    assert _kept(recorder, 2026)["record"]["run_kind"] == "dev"


@pytest.mark.parametrize("selection", [{}, {"strata": ["H1"]}])
def test_dev_run_is_labelled_not_a_result(
    recorder: Recorder, gateway_env: None, selection: dict[str, Any]
) -> None:
    run = _run(recorder, seeds=(2026,), kind="dev", **selection)
    summary = json.loads((recorder.tmp / "summary.json").read_text())
    assert run.label == summary["label"] == DEV_LABEL
    assert summary["run_kind"] == "dev"


def test_cli_run_defaults_its_seeds_and_repeats_by_kind(
    captured: dict[str, Any], data_dir: Path
) -> None:
    for kind, seeds, repeats in (
        ("official", OFFICIAL_SEEDS, 3),
        ("dev", (2026,), 1),
        ("smoke", SEEN_SEEDS, 1),
    ):
        cli.main(["run", "--kind", kind])
        assert captured["run"][0] == (kind, seeds)
        assert captured["run"][1]["repeats"] == repeats
