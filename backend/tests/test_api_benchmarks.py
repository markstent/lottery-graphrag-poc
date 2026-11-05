"""Benchmark routes: published runs, the question catalogue with answer keys
and hidden truths, and benchmark jobs with cancel (Phase 4 Task 12).

No service runs here. The question catalogue reads a frozen bank grounded
into the planted tiny world. Jobs run ``run_benchmark`` with the recorders
of tests/test_official.py as its preparation steps and runner, over a
temporary data directory, so nothing is generated, ingested or indexed.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from app.api import benchmarks
from app.api.graph_world import GraphLease
from app.api.schemas import BenchmarkStart, SecondJudgeOut
from app.config import METHOD_VERSION, REPO_ROOT, JudgeSettings, from_env
from app.datasets.config import GenerationConfig
from app.datasets.parquet import write_world
from app.datasets.schema import TABLE_SCHEMAS
from app.datasets.world import build_world
from app.evaluation import __main__ as cli
from app.evaluation import judge as judge_module
from app.evaluation import official, second_judge
from app.evaluation.catalogue import hidden_truth, question_catalogue
from app.evaluation.grounding import FrozenBank, freeze_bank, write_frozen_bank
from app.evaluation.judge import FakeJudge
from app.evaluation.official import InstanceHook, WorldPaths, world_paths
from app.evaluation.report import summarize
from app.evaluation.runner import OFFICIAL_MIN_REPEATS, WorldRun, settings_fields
from app.evaluation.truth_ledger import load_ledger
from app.events import TERMINAL_EVENT_TYPES
from app.lab import Lab
from app.main import create_app
from app.models import gateway
from app.scenarios.engine import apply_scenarios
from app.scenarios.ledger import build_ledger, write_ledger
from fastapi.testclient import TestClient

from tests.conftest import build_lab_offline
from tests.test_benchmark_report import _benchmark
from tests.test_official import FakeRunner, Recorder
from tests.test_second_judge import FakeGateway

GRAPH_BUSY = "a benchmark run is using the graph; try again when it finishes"
# The request the Results screen's start form sends unless the reader changes it
# (frontend/src/results/start.test.ts checks the form sends exactly this).
DEFAULT_START = (
    Path(__file__).parents[2] / "frontend" / "e2e" / "fixtures" / "start-default-request.json"
)
GATEWAY_MODELS = {
    "GENERATION_PROVIDER": "litellm",
    "GENERATION_MODEL": "ollama/qwen3.6:latest",
    "GENERATION_MODEL_FAMILY": "qwen",
    "JUDGE_PROVIDER": "litellm",
    "JUDGE_MODEL": "ollama/gemma4:31b",
    "JUDGE_MODEL_FAMILY": "gemma",
}
DEADLINE_S = 15.0
FINISHED = frozenset({"completed", "failed", "cancelled"})


def smoke(**fields: Any) -> dict[str, Any]:
    return {"kind": "smoke", "seeds": [2026], "repeats": 1, **fields}


def wait_job(client: TestClient, job_id: str) -> dict[str, Any]:
    """Poll the job until it finishes; fail the test after ``DEADLINE_S``."""
    deadline = time.monotonic() + DEADLINE_S
    while time.monotonic() < deadline:
        job: dict[str, Any] = client.get(f"/api/v1/benchmarks/jobs/{job_id}").json()
        if job["status"] in FINISHED:
            return job
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not finish within {DEADLINE_S}s")


def wait_query(client: TestClient, run_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + DEADLINE_S
    while time.monotonic() < deadline:
        run: dict[str, Any] = client.get(f"/api/v1/queries/{run_id}").json()
        if run["status"] in FINISHED:
            return run
        time.sleep(0.01)
    raise AssertionError(f"query {run_id} did not finish within {DEADLINE_S}s")


# -- fixtures -------------------------------------------------------------------


@pytest.fixture(scope="module")
def tiny_bank(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path, FrozenBank]:
    """The planted tiny world, its ledger and the bank frozen into them."""
    world = build_world(GenerationConfig(profile="tiny", world_seed=42))
    outcomes = apply_scenarios(world)
    root = tmp_path_factory.mktemp("tiny-world-benchmarks")
    dataset_dir = root / "tiny-seed42"
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    manifest = json.dumps(world.manifest, indent=2, sort_keys=True) + "\n"
    (dataset_dir / "_manifest.json").write_text(manifest)
    ledger_path = write_ledger(root / "ledger.json", build_ledger(outcomes, world))
    return dataset_dir, ledger_path, freeze_bank(dataset_dir, ledger_path)


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "data"
    monkeypatch.setattr(official, "DATA_DIR", root)
    monkeypatch.setenv("DATASET_DIR", str(root / "generated" / "dev-seed2026"))
    monkeypatch.delenv("TRUTH_LEDGER_PATH", raising=False)
    monkeypatch.delenv("QDRANT_COLLECTION", raising=False)
    return root


@pytest.fixture
def runs_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "runs"
    path.mkdir()
    monkeypatch.setenv("BENCHMARK_DIR", str(path))
    return path


@pytest.fixture
def client(data_dir: Path, runs_dir: Path) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def presentation_bank(
    data_dir: Path, tiny_bank: tuple[Path, Path, FrozenBank], monkeypatch: pytest.MonkeyPatch
) -> FrozenBank:
    """The tiny bank and its ledger where the API finds the presentation world's."""
    _, ledger_path, bank = tiny_bank
    paths = world_paths(official.PRESENTATION_SEED)
    paths.ledger_path.parent.mkdir(parents=True)
    shutil.copyfile(ledger_path, paths.ledger_path)
    paths.world_dir.mkdir(parents=True)
    shutil.copyfile(tiny_bank[0] / "_manifest.json", paths.world_dir / "_manifest.json")
    write_frozen_bank(bank, paths.bank_path)
    monkeypatch.setenv("DATASET_DIR", str(paths.world_dir))
    return bank


@pytest.fixture
def client_with_bank(presentation_bank: FrozenBank, client: TestClient) -> TestClient:
    return client


class BlockingRunner(FakeRunner):
    """Reports the world's first instance until the gate opens, then runs
    like ``FakeRunner``; cancellation reaches it through the hook."""

    gate: threading.Event

    def run(self, on_instance: InstanceHook | None = None) -> WorldRun:
        while not self.gate.wait(0.005):
            if on_instance is not None:
                on_instance(0, len(self.bank.instances))
        return super().run(on_instance)


@pytest.fixture
def recorder(tmp_path: Path, data_dir: Path) -> Recorder:
    return Recorder(tmp_path)


@pytest.fixture
def gate() -> threading.Event:
    return threading.Event()


@pytest.fixture
def blocking_benchmark(
    recorder: Recorder, gate: threading.Event, monkeypatch: pytest.MonkeyPatch
) -> Recorder:
    """``run_benchmark``'s real steps and runner replaced by recorders whose
    runner blocks until ``gate`` opens."""

    def factory(paths: WorldPaths, bank: FrozenBank, **options: Any) -> BlockingRunner:
        fake = recorder.runner(paths, bank, **options)
        runner = BlockingRunner(fake.seed, fake.bank, fake.kind, fake.depth, fake.pipelines, False)
        runner.gate = gate
        return runner

    monkeypatch.setattr(official, "default_steps", lambda: recorder.steps)
    monkeypatch.setattr(official, "build_runner", factory)
    return recorder


def _drain(client: TestClient, gate: threading.Event, started: list[str]) -> None:
    """Open the gate and wait for every job the test started, so no job
    thread outlives the test's data directory."""
    gate.set()
    for job_id in started:
        wait_job(client, job_id)


def record_started_jobs(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The ids of the benchmark jobs this application starts, as they start."""
    started: list[str] = []
    jobs = client.app.state.benchmark_jobs  # type: ignore[attr-defined]
    start = jobs.start

    def recording(request: Any) -> Any:
        job = start(request)
        started.append(job.job_id)
        return job

    monkeypatch.setattr(jobs, "start", recording)
    return started


@pytest.fixture
def client_with_blocking_benchmark(
    blocking_benchmark: Recorder,
    gate: threading.Event,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[TestClient]:
    started = record_started_jobs(client, monkeypatch)
    yield client
    _drain(client, gate, started)


# -- the brief's tests ------------------------------------------------------------


def test_question_catalogue_serves_answer_keys_and_hidden_truths(
    client_with_bank: TestClient,
) -> None:
    questions = client_with_bank.get("/api/v1/benchmarks/questions").json()
    h5 = [q for q in questions if q["stratum"] == "H5"]
    assert questions and h5
    assert all(q["expected_answer"] for q in questions)
    assert all(q["hidden_truth"] for q in h5)


def test_one_benchmark_job_at_a_time(client_with_blocking_benchmark: TestClient) -> None:
    assert (
        client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).status_code == 202
    )
    second = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke())
    assert second.status_code == 409
    assert second.json()["error"]["error_code"] == "CONFLICT"


def test_cancelled_job_publishes_nothing(
    client_with_blocking_benchmark: TestClient, runs_dir: Path, blocking_benchmark: Recorder
) -> None:
    job = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).json()
    cancel = client_with_blocking_benchmark.post(f"/api/v1/benchmarks/jobs/{job['job_id']}/cancel")
    assert cancel.status_code == 202
    finished = wait_job(client_with_blocking_benchmark, job["job_id"])
    assert finished["status"] == "cancelled" and finished["run_id"] is None
    assert not list(runs_dir.glob("*/summary.json"))
    # The presentation graph is restored after the cancelled world.
    assert blocking_benchmark.ingested == [2026, 2026]


def test_official_start_runs_preflight_before_accepting(client: TestClient) -> None:
    response = client.post(
        "/api/v1/benchmarks", json={"kind": "official", "seeds": [2026], "repeats": 1}
    )
    assert (
        response.status_code == 422 and response.json()["error"]["error_code"] == "VALIDATION_ERROR"
    )


@pytest.mark.parametrize("seeds", [[2029], list(official.OFFICIAL_SEEDS)])
def test_an_official_start_on_the_unseen_seeds_is_refused(
    client: TestClient,
    data_dir: Path,
    runs_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    seeds: list[int],
) -> None:
    """The unseen worlds are run only through make run-benchmark (D-091)."""
    for name, value in GATEWAY_MODELS.items():
        monkeypatch.setenv(name, value)
    response = client.post(
        "/api/v1/benchmarks", json={"kind": "official", "seeds": seeds, "repeats": 3}
    )
    assert response.status_code == 422
    assert response.json()["error"]["error_code"] == "VALIDATION_ERROR"
    assert "2029" in response.json()["error"]["message"]
    assert client.get("/api/v1/benchmarks/jobs").json() == []
    assert not (data_dir / "generated" / "dev-seed2029").exists()
    assert not list(runs_dir.iterdir())


def test_the_start_forms_default_request_is_accepted(
    client_with_blocking_benchmark: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The form opens on a request the API takes as it stands: a dev run on
    the presentation world, never the unseen worlds of the official run."""
    for name, value in GATEWAY_MODELS.items():
        monkeypatch.setenv(name, value)
    body = json.loads(DEFAULT_START.read_text(encoding="utf-8"))
    assert body["kind"] == "dev" and body["seeds"] == list(official.DEV_SEEDS)
    response = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=body)
    assert response.status_code == 202, response.json()


# -- jobs -----------------------------------------------------------------------


def test_a_finished_job_names_its_published_run(
    client_with_blocking_benchmark: TestClient, gate: threading.Event, runs_dir: Path
) -> None:
    gate.set()
    job = client_with_blocking_benchmark.post(
        "/api/v1/benchmarks", json=smoke(seeds=[2026, 2027])
    ).json()
    assert job["status"] == "running" and job["run_id"] is None
    finished = wait_job(client_with_blocking_benchmark, job["job_id"])
    assert finished["status"] == "completed" and finished["error"] is None
    assert (runs_dir / finished["run_id"] / "summary.json").is_file()
    assert finished["progress"] == {
        "world_seed": 2027,
        "instances_done": 9,
        "instances_total": 9,
        "worlds_done": 2,
        "worlds_total": 2,
    }
    summary = client_with_blocking_benchmark.get(f"/api/v1/benchmarks/{finished['run_id']}").json()
    assert summary["run_kind"] == "smoke" and summary["summary"]["worlds"] == [2026, 2027]


def test_progress_reports_the_running_world(
    client_with_blocking_benchmark: TestClient,
) -> None:
    job = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).json()
    deadline = time.monotonic() + DEADLINE_S
    progress = None
    while progress is None and time.monotonic() < deadline:
        progress = client_with_blocking_benchmark.get(
            f"/api/v1/benchmarks/jobs/{job['job_id']}"
        ).json()["progress"]
    assert progress == {
        "world_seed": 2026,
        "instances_done": 0,
        "instances_total": 9,
        "worlds_done": 0,
        "worlds_total": 1,
    }


def test_progress_counts_a_world_done_once_its_last_question_is(tmp_path: Path) -> None:
    """The shapes the Results screen reads (frontend/src/results/start.test.ts
    holds the same ones): ``worlds_done`` already includes a world whose
    questions are all done, so the screen must not count that world twice."""
    jobs = benchmarks.BenchmarkJobs(tmp_path, GraphLease())
    job = benchmarks._Job("job", threading.Event(), seeds=(2026, 2027, 2028))
    reported = []
    for seed, done in [(2027, 12), (2027, 40), (2028, 40)]:
        jobs._progress(job, seed, done, 40)
        assert job.progress is not None
        reported.append(job.progress.model_dump())
    assert reported == [
        {
            "world_seed": 2027,
            "instances_done": 12,
            "instances_total": 40,
            "worlds_done": 1,
            "worlds_total": 3,
        },
        {
            "world_seed": 2027,
            "instances_done": 40,
            "instances_total": 40,
            "worlds_done": 2,
            "worlds_total": 3,
        },
        {
            "world_seed": 2028,
            "instances_done": 40,
            "instances_total": 40,
            "worlds_done": 3,
            "worlds_total": 3,
        },
    ]


def test_a_failed_job_reports_the_error_and_publishes_nothing(
    client: TestClient, tmp_path: Path, runs_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = Recorder(tmp_path, fail_on=2026)
    monkeypatch.setattr(official, "default_steps", lambda: failing.steps)
    monkeypatch.setattr(official, "build_runner", failing.runner)
    job = client.post("/api/v1/benchmarks", json=smoke()).json()
    finished = wait_job(client, job["job_id"])
    assert finished["status"] == "failed" and finished["run_id"] is None
    assert finished["error"]["error_code"] == "RUN_ERROR"
    assert "world 2026 failed" not in finished["error"]["message"]
    assert not list(runs_dir.glob("*/summary.json"))
    assert failing.ingested == [2026, 2026]


def test_failed_job_keeps_worlds_and_publishes_nothing(
    client: TestClient, tmp_path: Path, runs_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = Recorder(tmp_path, fail_on=2027)
    monkeypatch.setattr(official, "default_steps", lambda: failing.steps)
    monkeypatch.setattr(official, "build_runner", failing.runner)
    job = client.post("/api/v1/benchmarks", json=smoke(seeds=[2026, 2027])).json()
    finished = wait_job(client, job["job_id"])
    assert finished["status"] == "failed" and finished["run_id"] is None
    (kept_dir,) = runs_dir.iterdir()
    assert [p.name for p in (kept_dir / "worlds").iterdir()] == ["2026.json"]
    assert not list(runs_dir.glob("*/summary.json"))
    message = finished["error"]["message"]
    assert "1 finished world was kept" in message
    assert "--seeds 2026,2027 --repeats 1 --out " in message and message.endswith(" --resume")
    shown = message.split(" --out ")[1].removesuffix(" --resume")
    # The CLI resolves a relative --out from the repository root.
    assert REPO_ROOT / shown == kept_dir
    assert "world 2027 failed" not in message
    assert client.get("/api/v1/benchmarks").json() == []


def test_a_cancelled_job_with_kept_worlds_names_the_resume_command(tmp_path: Path) -> None:
    out_dir = tmp_path / "20261025T000000Z-smoke"
    (out_dir / "worlds").mkdir(parents=True)
    (out_dir / "worlds" / "2026.json").write_text("{}")
    request = BenchmarkStart(kind="smoke", seeds=[2026, 2027], repeats=1)
    body = benchmarks._with_kept_worlds(None, request, out_dir)
    assert body is not None and body.error_code == "CANCELLED"
    assert "1 finished world was kept" in body.message and "--resume" in body.message
    assert benchmarks._with_kept_worlds(None, request, tmp_path / "none") is None


def test_the_resume_message_names_a_root_relative_out_that_the_cli_resolves(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(benchmarks, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    out_dir = tmp_path / "data" / "evaluation" / "runs" / "20261025T000000Z-smoke"
    (out_dir / "worlds").mkdir(parents=True)
    (out_dir / "worlds" / "2026.json").write_text("{}")
    request = BenchmarkStart(kind="smoke", seeds=[2026, 2027], repeats=1)
    body = benchmarks._with_kept_worlds(RuntimeError("x"), request, out_dir)
    assert body is not None
    shown = body.message.split(" --out ")[1].removesuffix(" --resume")
    assert shown == "data/evaluation/runs/20261025T000000Z-smoke"
    assert cli._resolved(Path(shown)) == out_dir


def test_the_resume_command_runs_from_the_repository_root_and_parses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    out_dir = REPO_ROOT / "data" / "evaluation" / "runs" / "20261025T000000Z-smoke"
    request = BenchmarkStart(kind="smoke", seeds=[2026, 2027], repeats=1)
    monkeypatch.setattr(benchmarks, "kept_world_count", lambda _dir: 1)
    body = benchmarks._with_kept_worlds(RuntimeError("x"), request, out_dir)
    assert body is not None
    command = shlex.split(body.message.split("resume with: ")[1])
    # The Makefile's own form: uv is pointed at the backend project, not run from inside it.
    assert command[:7] == ["uv", "--directory", "backend", "run", "python", "-m", "app.evaluation"]
    args = cli.build_parser().parse_args(command[7:])
    assert args.resume is True and args.out == Path("data/evaluation/runs/20261025T000000Z-smoke")


def test_cancelling_a_finished_job_is_refused(
    client_with_blocking_benchmark: TestClient, gate: threading.Event
) -> None:
    gate.set()
    job = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).json()
    wait_job(client_with_blocking_benchmark, job["job_id"])
    response = client_with_blocking_benchmark.post(
        f"/api/v1/benchmarks/jobs/{job['job_id']}/cancel"
    )
    assert response.status_code == 409
    assert response.json()["error"]["error_code"] == "CONFLICT"


def test_an_unknown_job_is_not_found(client: TestClient) -> None:
    assert client.get("/api/v1/benchmarks/jobs/JOB-NONE").status_code == 404
    assert client.post("/api/v1/benchmarks/jobs/JOB-NONE/cancel").status_code == 404


@pytest.mark.parametrize(
    "fields",
    [
        {"seeds": []},
        {"seeds": [2026, 2026]},
        {"seeds": [1999]},
        # A smoke run never touches the unseen worlds of the official run.
        {"seeds": [2029]},
        {"repeats": 0},
        {"strata": ["H9"]},
        {"limit": 0},
        {"kind": "sweep"},
    ],
)
def test_a_start_outside_the_bounds_is_refused(client: TestClient, fields: dict[str, Any]) -> None:
    response = client.post("/api/v1/benchmarks", json=smoke(**fields))
    assert response.status_code == 422
    assert response.json()["error"]["error_code"] == "VALIDATION_ERROR"


# -- the shared graph -------------------------------------------------------------


QUERY = {"question": "What is the ticket price of game GAME_UK_01?", "configurations": ["A"]}


def test_a_query_is_refused_while_a_benchmark_runs_and_accepted_after(
    client_with_blocking_benchmark: TestClient, gate: threading.Event
) -> None:
    job = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).json()
    refused = client_with_blocking_benchmark.post("/api/v1/queries", json=QUERY)
    assert refused.status_code == 409
    assert refused.json()["error"] == {
        "error_code": "CONFLICT",
        "message": GRAPH_BUSY,
        "retryable": True,
    }
    gate.set()
    wait_job(client_with_blocking_benchmark, job["job_id"])
    accepted = client_with_blocking_benchmark.post("/api/v1/queries", json=QUERY)
    assert accepted.status_code == 202
    wait_query(client_with_blocking_benchmark, accepted.json()["run_id"])


def test_readiness_reports_the_benchmark_while_a_job_runs(
    client_with_blocking_benchmark: TestClient,
) -> None:
    client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke())
    graph = client_with_blocking_benchmark.get("/api/v1/health/ready").json()["checks"]["graph"]
    assert graph == {"ok": False, "detail": "a benchmark run is using the graph", "stand_in": False}


class Hold:
    """Holds a status write until released, recording that it was reached."""

    def __init__(self) -> None:
        self.reached = threading.Event()
        self.release = threading.Event()

    def __call__(self) -> None:
        self.reached.set()
        assert self.release.wait(DEADLINE_S), "the test never released the status write"


def test_the_graph_is_free_before_a_job_publishes_its_status(
    client_with_blocking_benchmark: TestClient,
    gate: threading.Event,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = client_with_blocking_benchmark.app.state.benchmark_jobs  # type: ignore[attr-defined]
    lease = client_with_blocking_benchmark.app.state.graph_lease  # type: ignore[attr-defined]
    hold, running_at_publish = Hold(), []
    publish = jobs._publish

    def held_publish(*args: Any) -> None:
        running_at_publish.append(lease.benchmark_running)
        hold()
        publish(*args)

    monkeypatch.setattr(jobs, "_publish", held_publish)
    job = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke()).json()
    gate.set()
    assert hold.reached.wait(DEADLINE_S)
    status = client_with_blocking_benchmark.get(f"/api/v1/benchmarks/jobs/{job['job_id']}")
    assert status.json()["status"] == "running"
    query = client_with_blocking_benchmark.post("/api/v1/queries", json=QUERY)
    hold.release.set()
    assert running_at_publish == [False]
    assert query.status_code == 202
    assert wait_job(client_with_blocking_benchmark, job["job_id"])["status"] == "completed"
    wait_query(client_with_blocking_benchmark, query.json()["run_id"])


def test_the_graph_is_free_before_a_query_publishes_its_terminal_event(
    client_with_blocking_benchmark: TestClient,
    gate: threading.Event,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = client_with_blocking_benchmark.app.state.query_service.store  # type: ignore[attr-defined]
    hold = Hold()
    append = store.append_event

    def held_append(run_id: str, event: dict[str, Any]) -> int:
        if event["event_type"] in TERMINAL_EVENT_TYPES:
            hold()
        sequence: int = append(run_id, event)
        return sequence

    monkeypatch.setattr(store, "append_event", held_append)
    query = client_with_blocking_benchmark.post("/api/v1/queries", json=QUERY).json()
    assert hold.reached.wait(DEADLINE_S)
    assert (
        client_with_blocking_benchmark.get(f"/api/v1/queries/{query['run_id']}").json()["status"]
        not in FINISHED
    )
    gate.set()
    job = client_with_blocking_benchmark.post("/api/v1/benchmarks", json=smoke())
    hold.release.set()
    assert job.status_code == 202
    assert wait_query(client_with_blocking_benchmark, query["run_id"])["status"] == "completed"
    wait_job(client_with_blocking_benchmark, job.json()["job_id"])


def test_a_job_ending_on_any_base_exception_is_failed_not_running(
    client: TestClient, tmp_path: Path, runs_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Abort(BaseException):
        pass

    class AbortingRunner(FakeRunner):
        def run(self, on_instance: InstanceHook | None = None) -> WorldRun:
            raise Abort

    recorder = Recorder(tmp_path)

    def factory(paths: WorldPaths, bank: FrozenBank, **options: Any) -> AbortingRunner:
        fake = recorder.runner(paths, bank, **options)
        return AbortingRunner(fake.seed, fake.bank, fake.kind, fake.depth, fake.pipelines, False)

    monkeypatch.setattr(official, "default_steps", lambda: recorder.steps)
    monkeypatch.setattr(official, "build_runner", factory)
    job = client.post("/api/v1/benchmarks", json=smoke()).json()
    finished = wait_job(client, job["job_id"])
    assert finished["status"] == "failed" and finished["error"]["error_code"] == "RUN_ERROR"
    query = client.post("/api/v1/queries", json=QUERY)
    assert query.status_code == 202
    wait_query(client, query.json()["run_id"])  # no worker outlives the test


@pytest.fixture
def lab_gate() -> threading.Event:
    return threading.Event()


@pytest.fixture
def client_with_slow_lab(
    data_dir: Path,
    runs_dir: Path,
    lab_gate: threading.Event,
    blocking_benchmark: Recorder,
    gate: threading.Event,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[TestClient]:
    """The lab build blocks until ``lab_gate`` opens, so a query stays running."""

    def slow_lab() -> Lab:
        assert lab_gate.wait(DEADLINE_S), "the test never released the lab"
        return build_lab_offline()

    with TestClient(create_app(lab_factory=slow_lab)) as test_client:
        started = record_started_jobs(test_client, monkeypatch)
        yield test_client
        lab_gate.set()
        _drain(test_client, gate, started)


def test_a_benchmark_does_not_start_while_a_query_runs(
    client_with_slow_lab: TestClient, lab_gate: threading.Event, gate: threading.Event
) -> None:
    query = client_with_slow_lab.post("/api/v1/queries", json=QUERY)
    assert query.status_code == 202
    refused = client_with_slow_lab.post("/api/v1/benchmarks", json=smoke())
    assert refused.status_code == 409
    assert refused.json()["error"]["error_code"] == "CONFLICT"
    lab_gate.set()
    wait_query(client_with_slow_lab, query.json()["run_id"])
    gate.set()
    accepted = client_with_slow_lab.post("/api/v1/benchmarks", json=smoke())
    assert accepted.status_code == 202
    assert wait_job(client_with_slow_lab, accepted.json()["job_id"])["status"] == "completed"


# -- published runs -------------------------------------------------------------


def publish(
    root: Path,
    name: str,
    kind: str,
    started_at: str,
    schema: str = "3",
    selection: dict[str, Any] | None = None,
    results: dict[str, Any] | None = None,
    method_version: str | None = METHOD_VERSION,
) -> None:
    """A minimal summary of the current method; ``method_version=None``
    writes a record without one, as runs of method v0.2 were written."""
    run_dir = root / name
    run_dir.mkdir(parents=True)
    summary: dict[str, Any] = {
        "schema_version": schema,
        "run_kind": kind,
        "label": "scorer smoke test" if kind == "smoke" else None,
        "bank_version": "2.0.0",
        "worlds": [2026],
        "instances": {"total": {"overall": 0}, "per_world": {"2026": {"overall": 0}}},
        "unavailable": {"2026": []},
        "anchor_resolution_basis": {"A": "selection"},
        "metrics": {},
        "comparisons": [],
        "ontology_split": [],
        "headlines": [f"{name} headline"],
        "judge_agreement": None,
        "failures": {"repeats": {}, "generation": {}, "judge": {}, "classes": {}},
        "selection": selection or {"strata": None, "limit": None},
        "reproducibility": {"run": {"started_at": started_at}, "worlds": []},
    }
    if method_version is not None:
        summary["reproducibility"]["run"]["method_version"] = method_version
    if selection is not None:
        summary["label"] = "subset run"
    (run_dir / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    if results is not None:
        (run_dir / "results.json").write_text(json.dumps(results), encoding="utf-8")


def _latest(runs_dir: Path) -> tuple[int, Any]:
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = client.get("/api/v1/benchmarks/latest")
    return response.status_code, response.json() if response.status_code != 500 else None


def test_runs_are_listed_newest_first(client: TestClient, runs_dir: Path) -> None:
    publish(runs_dir, "old", "official", "2026-10-01T09:00:00+00:00")
    publish(runs_dir, "new", "smoke", "2026-10-02T09:00:00+00:00")
    publish(runs_dir, "v1", "official", "2026-10-03T09:00:00+00:00", schema="1")
    (runs_dir / "unpublished").mkdir()
    runs = client.get("/api/v1/benchmarks").json()
    assert [run["run_id"] for run in runs] == ["new", "old"]
    assert runs[0] == {
        "run_id": "new",
        "run_kind": "smoke",
        "label": "scorer smoke test",
        "started_at": "2026-10-02T09:00:00+00:00",
        "selection": {"strata": None, "limit": None},
        "worlds": [2026],
        "headlines": ["new headline"],
        "method_version": METHOD_VERSION,
    }


def test_a_run_without_headlines_lists_none(client: TestClient, runs_dir: Path) -> None:
    publish(runs_dir, "quiet", "official", "2026-10-01T09:00:00+00:00")
    path = runs_dir / "quiet" / "summary.json"
    summary = json.loads(path.read_text(encoding="utf-8"))
    del summary["headlines"]
    path.write_text(json.dumps(summary), encoding="utf-8")
    assert client.get("/api/v1/benchmarks").json()[0]["headlines"] == []


def test_a_run_is_read_by_its_id(client: TestClient, runs_dir: Path) -> None:
    publish(runs_dir, "run", "official", "2026-10-01T09:00:00+00:00")
    body = client.get("/api/v1/benchmarks/run").json()
    assert (body["run_id"], body["run_kind"], body["label"]) == ("run", "official", None)
    assert body["summary"]["headlines"] == ["run headline"]


@pytest.mark.parametrize("run_id", ["missing", "..", "unpublished"])
def test_an_unpublished_run_is_not_found(client: TestClient, runs_dir: Path, run_id: str) -> None:
    (runs_dir / "unpublished").mkdir()
    response = client.get(f"/api/v1/benchmarks/{run_id}")
    assert response.status_code == 404
    assert response.json()["error"]["error_code"] == "NOT_FOUND"


def test_benchmarks_latest_404_without_runs(client: TestClient) -> None:
    assert client.get("/api/v1/benchmarks/latest").status_code == 404


def test_unset_benchmark_dir_reads_the_repository_runs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # The default is anchored at the repository root, not the server's
    # working directory: re-anchor the root and the API follows it.
    from app import config as app_config

    publish(tmp_path / "data" / "evaluation" / "runs", "run", "smoke", "2026-10-01T09:00:00+00:00")
    monkeypatch.setattr(app_config, "REPO_ROOT", tmp_path)
    monkeypatch.delenv("BENCHMARK_DIR", raising=False)
    with TestClient(create_app()) as client:
        assert client.get("/api/v1/benchmarks/latest").json()["run_id"] == "run"


def test_a_subset_official_run_is_not_the_official_latest(runs_dir: Path) -> None:
    subset = {"strata": ["H1"], "limit": 2}
    publish(runs_dir, "full", "official", "2026-10-01T09:00:00+00:00")
    publish(runs_dir, "pilot", "official", "2026-10-02T09:00:00+00:00", selection=subset)
    status, body = _latest(runs_dir)
    assert (status, body["run_id"]) == (200, "full")


def test_a_subset_official_run_falls_back_like_other_runs(runs_dir: Path) -> None:
    limited = {"strata": None, "limit": 2}
    publish(runs_dir, "smoke", "smoke", "2026-10-01T09:00:00+00:00")
    publish(runs_dir, "pilot", "official", "2026-10-02T09:00:00+00:00", selection=limited)
    status, body = _latest(runs_dir)
    assert (status, body["run_id"], body["label"]) == (200, "pilot", "subset run")


def test_latest_benchmark_prefers_official_runs(runs_dir: Path) -> None:
    publish(runs_dir, "official-old", "official", "2026-10-01T09:00:00+00:00")
    publish(runs_dir, "official-new", "official", "2026-10-02T09:00:00+00:00")
    publish(runs_dir, "smoke-newest", "smoke", "2026-10-03T09:00:00+00:00")
    status, body = _latest(runs_dir)
    assert status == 200
    assert (body["run_kind"], body["run_id"], body["label"]) == ("official", "official-new", None)
    assert body["summary"]["headlines"] == ["official-new headline"]


def test_latest_benchmark_falls_back_to_the_newest_labelled_run(runs_dir: Path) -> None:
    publish(runs_dir, "b-smoke", "smoke", "2026-10-02T09:00:00+00:00")
    publish(runs_dir, "a-sweep", "sweep", "2026-10-01T09:00:00+00:00")
    status, body = _latest(runs_dir)
    assert status == 200
    assert (body["run_id"], body["run_kind"]) == ("b-smoke", "smoke")
    assert body["label"] == "scorer smoke test"


def test_latest_benchmark_orders_by_time_not_text(runs_dir: Path) -> None:
    # 10:00 in UTC+02:00 is 08:00 UTC, earlier than 09:00 UTC, though it sorts later as text.
    publish(runs_dir, "later", "official", "2026-10-02T09:00:00+00:00")
    publish(runs_dir, "earlier", "official", "2026-10-02T10:00:00+02:00")
    status, body = _latest(runs_dir)
    assert (status, body["run_id"]) == (200, "later")


def test_a_malformed_summary_fails_loudly(runs_dir: Path) -> None:
    publish(runs_dir, "good", "official", "2026-10-02T09:00:00+00:00")
    (runs_dir / "broken").mkdir()
    (runs_dir / "broken" / "summary.json").write_text("{not json", encoding="utf-8")
    status, _ = _latest(runs_dir)
    assert status == 500


def test_latest_benchmark_ignores_summaries_of_another_schema(runs_dir: Path) -> None:
    publish(runs_dir, "run-v1", "official", "2026-10-09T09:00:00+00:00", schema="1")
    status, _ = _latest(runs_dir)
    assert status == 404


def _publish_v02(runs_dir: Path, name: str, kind: str, started_at: str) -> None:
    """A run of method v0.2 as it lies on disk: schema 2, no method recorded."""
    publish(runs_dir, name, kind, started_at, schema="2", method_version=None)


def test_runs_of_an_earlier_method_are_not_published(client: TestClient, runs_dir: Path) -> None:
    """D-104: only runs of the current method are listed, read or latest,
    even when a run of method v0.2 is newer; its files stay on disk."""
    publish(runs_dir, "v03", "official", "2026-10-28T09:00:00+00:00")
    _publish_v02(runs_dir, "v02", "official", "2026-11-03T09:00:00+00:00")
    _publish_v02(runs_dir, "v02-smoke", "smoke", "2026-11-04T09:00:00+00:00")
    publish(runs_dir, "v03-schema-2", "official", "2026-11-05T09:00:00+00:00", schema="2")
    assert [run["run_id"] for run in client.get("/api/v1/benchmarks").json()] == ["v03"]
    assert client.get("/api/v1/benchmarks/latest").json()["run_id"] == "v03"
    assert client.get("/api/v1/benchmarks/v02").status_code == 404
    assert (runs_dir / "v02" / "summary.json").is_file()


def test_with_only_runs_of_an_earlier_method_there_is_no_latest(
    client: TestClient, runs_dir: Path
) -> None:
    _publish_v02(runs_dir, "v02", "official", "2026-10-26T09:00:00+00:00")
    assert client.get("/api/v1/benchmarks").json() == []
    assert client.get("/api/v1/benchmarks/latest").status_code == 404


def test_v03_summary_schema_3_validates(client: TestClient, runs_dir: Path) -> None:
    """The harness's own output (``summarize``) is served as schema 3 of method v0.3.0."""
    publish_run(runs_dir, "v03", kind="dev")
    body = client.get("/api/v1/benchmarks/v03").json()
    assert (body["method_version"], body["run_kind"]) == ("0.3.0", "dev")
    summary = body["summary"]
    assert summary["schema_version"] == "3"
    assert {cell["metric"] for cell in summary["comparisons"]} == {"evidence_recall", "answer"}
    assert "abstained" in summary["judge_agreement"]["overall"]
    # The run's note on how the method came about is not served (D-104).
    assert "method_note" not in summary
    assert client.get("/api/v1/benchmarks").json()[0]["method_version"] == "0.3.0"


# -- the question catalogue -------------------------------------------------------


def _score(answer: float | None, f1: float) -> dict[str, Any]:
    """A repeat's score; recall is set apart from F1 (1 - F1) so each reads as itself."""
    return {"answer": answer, "evidence": {"f1": f1, "recall": 1.0 - f1}}


def _results(bank: FrozenBank, scores: Callable[[str], dict[str, list[Any]]]) -> dict[str, Any]:
    """A results.json over the bank's first two instances."""
    return {
        "kind": "official",
        "worlds": [
            {
                "world_seed": bank.world_seed,
                "bank_hash": bank.bank_hash,
                "results": [
                    {"instance": instance.to_payload(), "scores": scores(instance.instance_id)}
                    for instance in bank.instances[:2]
                ],
            }
        ],
    }


def _repeats(instance_id: str) -> dict[str, list[Any]]:
    return {
        "A": [_score(1.0, 0.5), None, _score(0.0, 1.0)],
        "B": [_score(None, 0.25), _score(1.0, 0.75), _score(None, 0.5)],
        "C": [None, None, None],
    }


def test_question_cards_carry_the_bank_fields(
    client_with_bank: TestClient, presentation_bank: FrozenBank
) -> None:
    questions = client_with_bank.get("/api/v1/benchmarks/questions").json()
    assert [q["instance_id"] for q in questions] == [
        i.instance_id for i in presentation_bank.instances
    ]
    first, instance = questions[0], presentation_bank.instances[0]
    assert first["question_id"] == instance.question_id and first["text"] == instance.text
    assert first["expected_answer"] == instance.expected_answer
    assert first["tests"] and first["scenario_id"] is None and first["hidden_truth"] is None
    planted = next(q for q in questions if q["stratum"] == "H5")
    assert planted["scenario_id"].startswith("SCN-")
    assert all(q["scores"] is None for q in questions)


def test_scores_are_means_over_the_scored_repeats_of_the_latest_official_run(
    client_with_bank: TestClient, presentation_bank: FrozenBank, runs_dir: Path
) -> None:
    publish(
        runs_dir,
        "official",
        "official",
        "2026-10-01T09:00:00+00:00",
        results=_results(presentation_bank, _repeats),
    )
    # A newer subset run (no results.json) is not the one the scores come from.
    publish(
        runs_dir,
        "newer-subset",
        "official",
        "2026-10-02T09:00:00+00:00",
        selection={"strata": None, "limit": 1},
    )
    questions = client_with_bank.get("/api/v1/benchmarks/questions").json()
    assert questions[0]["scores"] == {
        "A": {"answer": 0.5, "evidence_recall": 0.25, "evidence_f1": 0.75},
        "B": {"answer": 1.0, "evidence_recall": 0.5, "evidence_f1": 0.5},
        "C": {"answer": None, "evidence_recall": None, "evidence_f1": None},
    }
    assert questions[1]["scores"] is not None
    assert all(q["scores"] is None for q in questions[2:])


def test_scores_come_from_the_named_run(
    client_with_bank: TestClient, presentation_bank: FrozenBank, runs_dir: Path
) -> None:
    publish(
        runs_dir,
        "smoke",
        "smoke",
        "2026-10-01T09:00:00+00:00",
        results=_results(presentation_bank, _repeats),
    )
    unnamed = client_with_bank.get("/api/v1/benchmarks/questions").json()
    named = client_with_bank.get("/api/v1/benchmarks/questions?run_id=smoke").json()
    assert unnamed[0]["scores"] is None
    assert named[0]["scores"]["A"] == {
        "answer": 0.5,
        "evidence_recall": 0.25,
        "evidence_f1": 0.75,
    }


def test_a_run_over_another_bank_gives_no_scores(
    client_with_bank: TestClient, presentation_bank: FrozenBank, runs_dir: Path
) -> None:
    results = _results(presentation_bank, _repeats)
    results["worlds"][0]["bank_hash"] = "another bank"
    publish(runs_dir, "official", "official", "2026-10-01T09:00:00+00:00", results=results)
    questions = client_with_bank.get("/api/v1/benchmarks/questions").json()
    assert all(q["scores"] is None for q in questions)


def test_questions_of_an_unknown_run_are_not_found(client_with_bank: TestClient) -> None:
    assert client_with_bank.get("/api/v1/benchmarks/questions?run_id=nope").status_code == 404


def test_hidden_truths_are_built_from_ledger_values_only(
    tiny_bank: tuple[Path, Path, FrozenBank],
) -> None:
    _, ledger_path, bank = tiny_bank
    ledger = json.loads(ledger_path.read_text())
    truth = {s["scenario_id"]: s["truth"] for s in ledger["scenarios"]}
    cards = {
        card.scenario_id: card for card in question_catalogue(bank, ledger_path) if card.scenario_id
    }
    devices = cards["SCN-002"].hidden_truth or ""
    assert all(player in devices for player in truth["SCN-002"]["cluster_players"])
    assert all(device in devices for device in truth["SCN-002"]["shared_devices"])
    assert truth["SCN-002"]["expected_interpretation"] in devices
    conflict = cards["SCN-015"].hidden_truth or ""
    assert truth["SCN-015"]["conflicting_document"] in conflict


@pytest.mark.parametrize(
    ("unaffected", "verb"), [(["MKT_UK"], "was"), (["MKT_UK", "MKT_CZ"], "were")]
)
def test_unaffected_markets_take_the_right_verb(
    tiny_bank: tuple[Path, Path, FrozenBank], unaffected: list[str], verb: str
) -> None:
    scenario = next(
        s
        for s in load_ledger(tiny_bank[1]).scenarios
        if s.scenario_type == "cross_market_platform_incident"
    )
    truth = {**scenario.truth, "unaffected_markets": unaffected}
    sentence = hidden_truth(scenario.model_copy(update={"truth": truth}))
    assert f"while {' and '.join(unaffected)} {verb} unaffected;" in sentence


def test_a_catalogue_refuses_a_ledger_the_bank_was_not_grounded_on(
    tiny_bank: tuple[Path, Path, FrozenBank], tmp_path: Path
) -> None:
    _, ledger_path, bank = tiny_bank
    other = tmp_path / "ledger.json"
    other.write_text(ledger_path.read_text() + "\n")
    with pytest.raises(ValueError, match="ledger"):
        question_catalogue(bank, other)


# -- a bank that does not match the active world ---------------------------------

NOT_ACTIVE = "the question bank does not match the active world; run make ground-bank"


def _unmatch_manifest(paths: WorldPaths, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (paths.world_dir / "_manifest.json").write_text('{"world_seed": 7}')


def _unmatch_dataset_dir(
    paths: WorldPaths, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = tmp_path / "other-world"
    shutil.copytree(paths.world_dir, other)
    monkeypatch.setenv("DATASET_DIR", str(other))


def _unmatch_ledger(paths: WorldPaths, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    paths.ledger_path.write_text(paths.ledger_path.read_text() + "\n")


@pytest.mark.parametrize("unmatch", [_unmatch_manifest, _unmatch_ledger])
def test_a_bank_for_another_world_is_refused_by_every_route_that_reads_it(
    client_with_bank: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    unmatch: Callable[[WorldPaths, Path, pytest.MonkeyPatch], None],
) -> None:
    unmatch(world_paths(official.PRESENTATION_SEED), tmp_path, monkeypatch)
    for response in (
        client_with_bank.get("/api/v1/demo/questions"),
        client_with_bank.get("/api/v1/benchmarks/questions"),
        client_with_bank.post("/api/v1/queries", json={"benchmark_instance_id": "L05-x"}),
    ):
        assert response.status_code == 503
        assert response.json()["error"] == {
            "error_code": "CONFIGURATION_ERROR",
            "message": NOT_ACTIVE,
            "retryable": False,
        }


def test_a_bank_grounded_for_another_dataset_dir_is_not_grounded_for_this_one(
    client_with_bank: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bank is named after its dataset directory, so another directory has
    none yet; the hint is the command that grounds it."""
    _unmatch_dataset_dir(world_paths(official.PRESENTATION_SEED), tmp_path, monkeypatch)
    for response in (
        client_with_bank.get("/api/v1/demo/questions"),
        client_with_bank.get("/api/v1/benchmarks/questions"),
    ):
        assert response.status_code == 503
        assert response.json()["error"]["message"] == (
            "the question bank has not been grounded; run make ground-demo-bank"
        )


def test_the_demo_world_serves_bank_questions(
    data_dir: Path,
    tiny_bank: tuple[Path, Path, FrozenBank],
    runs_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The demo environment (DATASET_DIR and TRUTH_LEDGER_PATH of the demo
    world) has its own bank, named after its directory, and serves it."""
    dataset_dir, ledger_path, bank = tiny_bank
    demo = data_dir / "generated" / "demo-seed2026"
    shutil.copytree(dataset_dir, demo)
    demo_ledger = data_dir / "truth" / "ledger-demo.json"
    demo_ledger.parent.mkdir(parents=True)
    shutil.copyfile(ledger_path, demo_ledger)
    monkeypatch.setenv("DATASET_DIR", str(demo))
    monkeypatch.setenv("TRUTH_LEDGER_PATH", str(demo_ledger))
    write_frozen_bank(bank, world_paths(official.PRESENTATION_SEED).bank_path)
    assert (
        world_paths(official.PRESENTATION_SEED).bank_path.name
        == "bank-2.0.0-scorer-2.2.1-demo-seed2026.json"
    )
    with TestClient(create_app()) as demo_client:
        demos = demo_client.get("/api/v1/demo/questions")
        questions = demo_client.get("/api/v1/benchmarks/questions")
    assert demos.status_code == 200 and demos.json()
    assert questions.status_code == 200
    assert [q["instance_id"] for q in questions.json()] == [i.instance_id for i in bank.instances]


def test_an_invalid_setting_on_a_question_route_is_a_configuration_error_naming_it(
    client_with_bank: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RAG_TOP_K", "many")
    for response in (
        client_with_bank.get("/api/v1/demo/questions"),
        client_with_bank.get("/api/v1/benchmarks/questions"),
        client_with_bank.post("/api/v1/queries", json={"benchmark_instance_id": "L05-x"}),
    ):
        assert response.status_code == 503
        error = response.json()["error"]
        assert error["error_code"] == "CONFIGURATION_ERROR"
        assert "RAG_TOP_K" in error["message"]


def test_the_bank_is_loaded_and_hashed_once_until_a_file_changes(
    client_with_bank: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.evaluation.grounding import load_frozen_bank

    loads: list[Path] = []

    def counting(path: Path) -> FrozenBank:
        loads.append(path)
        return load_frozen_bank(path)

    monkeypatch.setattr("app.api.benchmarks.load_frozen_bank", counting)
    paths = world_paths(official.PRESENTATION_SEED)
    for _ in range(3):
        assert client_with_bank.get("/api/v1/demo/questions").status_code == 200
        assert client_with_bank.get("/api/v1/benchmarks/questions").status_code == 200
    assert loads == [paths.bank_path]
    # The bank file is written again: its modification time changes, so it is
    # loaded and checked once more, then served from the cache again.
    bank = load_frozen_bank(paths.bank_path)
    write_frozen_bank(bank, paths.bank_path)
    os.utime(paths.bank_path, ns=(1, 2_000_000_000))
    for _ in range(3):
        assert client_with_bank.get("/api/v1/demo/questions").status_code == 200
    assert loads == [paths.bank_path, paths.bank_path]
    # A changed ledger no longer matches the bank.
    paths.ledger_path.write_text(paths.ledger_path.read_text() + "\n")
    assert client_with_bank.get("/api/v1/demo/questions").status_code == 503


def test_a_benchmark_is_refused_in_the_demo_environment_before_a_thread_starts(
    client: TestClient, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATASET_DIR", str(data_dir / "generated" / "demo-seed2026"))
    monkeypatch.setenv("TRUTH_LEDGER_PATH", str(data_dir / "truth" / "ledger-demo.json"))
    response = client.post("/api/v1/benchmarks", json=smoke())
    assert response.status_code == 503
    assert response.json()["error"] == {
        "error_code": "CONFIGURATION_ERROR",
        "message": official.DEV_ONLY_MESSAGE,
        "retryable": False,
    }
    assert not [t for t in threading.enumerate() if t.name.startswith("benchmark-")]


def test_the_bank_hint_names_the_command_of_the_environment(
    client: TestClient, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dev = client.get("/api/v1/demo/questions").json()["error"]["message"]
    assert dev == "the question bank has not been grounded; run make ground-bank"
    monkeypatch.setenv("DATASET_DIR", str(data_dir / "generated" / "demo-seed2026"))
    monkeypatch.setenv("TRUTH_LEDGER_PATH", str(data_dir / "truth" / "ledger-demo.json"))
    demo = client.get("/api/v1/demo/questions").json()["error"]["message"]
    assert demo == "the question bank has not been grounded; run make ground-demo-bank"


def test_an_ungrounded_bank_reads_the_same_on_both_question_routes(client: TestClient) -> None:
    for path in ("/api/v1/demo/questions", "/api/v1/benchmarks/questions"):
        response = client.get(path)
        assert response.status_code == 503
        assert response.json()["error"] == {
            "error_code": "CONFIGURATION_ERROR",
            "message": "the question bank has not been grounded; run make ground-bank",
            "retryable": False,
        }


# -- typed summary, per-question results and the job list -------------------------


def publish_run(root: Path, name: str, kind: str = "official") -> None:
    """A run written as the harness writes one: the fake-generator run of
    tests/test_benchmark_report.py through ``summarize`` and ``to_payload``."""
    run = _benchmark(kind, h5_per_world=6)
    run_dir = root / name
    run_dir.mkdir(parents=True)
    (run_dir / "summary.json").write_text(json.dumps(summarize(run)), encoding="utf-8")
    (run_dir / "results.json").write_text(json.dumps(run.to_payload()), encoding="utf-8")


@pytest.fixture
def client_with_runs(client: TestClient, runs_dir: Path) -> TestClient:
    publish_run(runs_dir, "official-fixture")
    publish_run(runs_dir, "smoke-fixture", kind="smoke")
    publish(
        runs_dir,
        "subset",
        "official",
        "2026-10-01T09:00:00+00:00",
        selection={"strata": ["H1"], "limit": 2},
    )
    publish(runs_dir, "no-split", "official", "2026-10-02T09:00:00+00:00")
    return client


def test_summary_is_typed_for_every_run_shape(client_with_runs: TestClient) -> None:
    runs = client_with_runs.get("/api/v1/benchmarks").json()
    assert len(runs) == 4
    for run in runs:
        body = client_with_runs.get(f"/api/v1/benchmarks/{run['run_id']}").json()
        assert body["summary"]["schema_version"] == "3"
    official = client_with_runs.get("/api/v1/benchmarks/official-fixture").json()["summary"]
    assert official["metrics"]["H3"]["answer"]["A"]["n"] == 12
    assert official["comparisons"][0]["comparison"] == "B_vs_A"
    assert official["ontology_split"][0]["in_family"] is False
    answered = official["judge_agreement"]["overall"]["answered"]
    assert answered["n"] > 0 and "weighted_kappa" in answered
    assert official["judge_agreement"]["pipelines"]["A"]["abstained"]["n"] == 0
    assert official["failures"]["classes"]["A"]["retrieval_failure"] > 0
    assert official["unavailable"]["2026"] == [{"question_id": "L99", "reason": "no anchor"}]
    assert official["reproducibility"]["run"]["judge_temperature"] == 0.0


def test_a_record_without_some_fields_and_a_key_added_later_reads(
    client_with_runs: TestClient, runs_dir: Path
) -> None:
    path = runs_dir / "official-fixture" / "summary.json"
    summary = json.loads(path.read_text(encoding="utf-8"))
    for record in (summary["reproducibility"]["run"], *summary["reproducibility"]["worlds"]):
        for field in ("git_dirty", "graph_label_version", "judge_temperature"):
            record.pop(field, None)
    summary["a_key_added_later"] = {"x": 1}
    path.write_text(json.dumps(summary), encoding="utf-8")
    body = client_with_runs.get("/api/v1/benchmarks/official-fixture").json()["summary"]
    assert "judge_temperature" not in body["reproducibility"]["run"]
    assert "a_key_added_later" not in body


def test_a_summary_that_does_not_fit_is_a_server_error_naming_the_run(
    runs_dir: Path, caplog: pytest.LogCaptureFixture
) -> None:
    publish(runs_dir, "broken", "official", "2026-10-02T09:00:00+00:00")
    path = runs_dir / "broken" / "summary.json"
    summary = json.loads(path.read_text(encoding="utf-8"))
    del summary["failures"]
    path.write_text(json.dumps(summary), encoding="utf-8")
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = client.get("/api/v1/benchmarks/broken")
    assert response.status_code == 500
    assert "broken" in caplog.text


def test_instances_route_returns_means_and_failure_counts(client_with_runs: TestClient) -> None:
    response = client_with_runs.get("/api/v1/benchmarks/official-fixture/instances")
    assert response.status_code == 200
    instances = {i["instance_id"]: i for i in response.json()}
    assert len(instances) == 2 * (6 + 6 + 6 + 3 + 6)
    h3 = instances["L30-2026-X"]
    assert (h3["stratum"], h3["sub_stratum"], h3["ontology_dependent"]) == ("H3", None, False)
    assert h3["text"] == "question?" and h3["world_seed"] == 2026
    a = h3["pipelines"]["A"]
    assert (a["repeats"], a["unscored_repeats"]) == (3, 1)
    assert a["answer"] == pytest.approx(0.75) and a["evidence_f1"] == pytest.approx(0.2)
    assert a["latency_ms"] == pytest.approx(150.0) and a["context_tokens"] == 1000
    assert a["judge_correctness"] == 2.0 and a["failure_classes"] == {"retrieval_failure": 2}
    h2 = instances["L20-2026-X"]
    assert h2["ontology_dependent"] and h2["sub_stratum"] == "id_anchored"


def test_instances_route_carries_no_answer_key(client_with_runs: TestClient) -> None:
    text = client_with_runs.get("/api/v1/benchmarks/official-fixture/instances").text
    for word in ("expected_answer", "claims", "checks", "raw_text", "blocks", "answer text"):
        assert word not in text
    assert '"text":"question?"' in text.replace(" ", "")
    assert '"answer":"' not in text


def test_instances_route_404_without_results_json(client_with_runs: TestClient) -> None:
    missing = client_with_runs.get("/api/v1/benchmarks/no-split/instances")
    assert missing.status_code == 404
    assert missing.json()["error"]["message"] == "This run has no per-question results."
    unknown = client_with_runs.get("/api/v1/benchmarks/nope/instances")
    assert unknown.status_code == 404 and unknown.json()["error"]["error_code"] == "NOT_FOUND"


def test_outcomes_route_counts_evidence_and_answers(client_with_runs: TestClient) -> None:
    response = client_with_runs.get("/api/v1/benchmarks/official-fixture/outcomes")
    assert response.status_code == 200
    body = response.json()
    assert body["recorded"] is True
    # Every scored repeat of the fixture finds its one claim and selects nothing.
    for tag in ("A", "B", "C"):
        assert body["evidence"][tag] == {
            "repeats": 108,
            "found": 108,
            "missed": 0,
            "extra_per_question": 0.0,
        }
    # A: the H3 questions score 1.0, 0.5 and a failed generation; the rest 0.2.
    assert body["answers"]["A"] == {
        "scored": 108,
        "right": 12,
        "partly": 96,
        "wrong": 0,
        "right_declined": 0,
        "partly_declined": 0,
        "wrong_declined": 0,
        "not_scored": 12,
    }
    assert body["answers"]["C"]["partly"] == body["answers"]["C"]["scored"] == 108


def test_outcomes_route_404_for_an_unknown_run_or_one_without_results(
    client_with_runs: TestClient,
) -> None:
    unknown = client_with_runs.get("/api/v1/benchmarks/nope/outcomes")
    assert unknown.status_code == 404 and unknown.json()["error"]["error_code"] == "NOT_FOUND"
    missing = client_with_runs.get("/api/v1/benchmarks/no-split/outcomes")
    assert missing.status_code == 404
    assert missing.json()["error"]["message"] == "This run has no per-question results."


def test_outcomes_route_is_not_recorded_for_a_run_without_the_fields(
    client_with_runs: TestClient, runs_dir: Path
) -> None:
    results = json.loads((runs_dir / "official-fixture" / "results.json").read_text())
    for world in results["worlds"]:
        for result in world["results"]:
            for runs in result["runs"].values():
                for run in runs:
                    del run["selected"]
    publish(runs_dir, "pilot", "dev", "2026-10-03T09:00:00+00:00", results=results)
    body = client_with_runs.get("/api/v1/benchmarks/pilot/outcomes").json()
    assert body == {"recorded": False, "evidence": {}, "answers": {}}


def test_outcomes_route_reads_results_once_until_the_file_changes(
    client_with_runs: TestClient, runs_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    loads: list[Path] = []
    load = benchmarks.load_results

    def counting(run_dir: Path) -> dict[str, Any]:
        loads.append(run_dir)
        return load(run_dir)

    monkeypatch.setattr(benchmarks, "load_results", counting)
    url = "/api/v1/benchmarks/official-fixture/outcomes"
    first = client_with_runs.get(url).json()
    assert client_with_runs.get(url).json() == first
    assert len(loads) == 1
    path = runs_dir / "official-fixture" / "results.json"
    results = json.loads(path.read_text())
    h3 = next(r for r in results["worlds"][0]["results"] if r["instance"]["stratum"] == "H3")
    h3["runs"]["A"][0]["verdict"] = "unknown: the records do not say"
    path.write_text(json.dumps(results, indent=1))
    changed = client_with_runs.get(url).json()["answers"]["A"]
    assert len(loads) == 2
    assert (changed["right"], changed["right_declined"]) == (12, 1)


def test_jobs_list_newest_first_with_world_progress(
    client_with_blocking_benchmark: TestClient,
    gate: threading.Event,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = client_with_blocking_benchmark
    # Run ids have a one second resolution: two jobs in one second would share a directory.
    names = iter(["20261024T100000Z-smoke", "20261024T100001Z-smoke"])
    monkeypatch.setattr(benchmarks, "run_id", lambda _kind: next(names))
    assert client.get("/api/v1/benchmarks/jobs").json() == []
    gate.set()
    first = client.post("/api/v1/benchmarks", json=smoke(seeds=[2026, 2027])).json()
    wait_job(client, first["job_id"])
    second = client.post("/api/v1/benchmarks", json=smoke()).json()
    wait_job(client, second["job_id"])
    jobs = client.get("/api/v1/benchmarks/jobs").json()
    assert [job["job_id"] for job in jobs] == [second["job_id"], first["job_id"]]
    assert jobs[1]["progress"]["worlds_done"] == 2 and jobs[1]["progress"]["worlds_total"] == 2
    assert jobs[0]["progress"]["worlds_total"] == 1


# -- settings -------------------------------------------------------------------

JUDGE_ENV = (
    "JUDGE_PROVIDER",
    "JUDGE_MODEL",
    "JUDGE_MODEL_FAMILY",
    "JUDGE_API_BASE",
    "JUDGE_TEMPERATURE",
    "JUDGE_REASONING",
)
NOT_RECORDED = frozenset({"git_sha", "git_dirty"})
SECRET_ENV = (
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GENERATION_API_KEY",
    "JUDGE_API_KEY",
    "GENERATION_API_BASE",
    "JUDGE_API_BASE",
)
SENTINEL = "sentinel-3f9c1d7a-secret"


def _without_judge_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Whatever the shell exports, the judge is not configured."""
    for name in JUDGE_ENV:
        monkeypatch.delenv(name, raising=False)


def _recorded_keys() -> set[str]:
    fields = settings_fields(from_env(), FakeJudge(), "official", OFFICIAL_MIN_REPEATS)
    return set(fields) - NOT_RECORDED


def test_settings_returns_the_recorded_fields(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _without_judge_env(monkeypatch)
    response = client.get("/api/v1/settings")
    assert response.status_code == 200
    values = response.json()["values"]
    assert set(values) == _recorded_keys()
    assert values["repeats"] == OFFICIAL_MIN_REPEATS
    assert values["run_kind"] == "official"
    # frontend/scripts/capture-run.mjs records a recording's method from here.
    assert values["method_version"] == METHOD_VERSION
    assert response.json()["judge_configured"] is False


def test_settings_makes_no_model_call(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("the settings route made a model call")

    monkeypatch.setattr(gateway, "complete", refuse)
    monkeypatch.setattr(judge_module, "complete", refuse)
    monkeypatch.setenv("JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("JUDGE_MODEL", "judge-x")
    monkeypatch.setenv("JUDGE_MODEL_FAMILY", "family-j")
    response = client.get("/api/v1/settings")
    assert response.status_code == 200
    assert response.json()["judge_configured"] is True
    assert response.json()["values"]["judge_model"] == "judge-x"


def test_settings_without_a_judge(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _without_judge_env(monkeypatch)
    body = client.get("/api/v1/settings").json()
    assert body["judge_configured"] is False
    assert body["values"]["judge_model"] is None
    assert body["values"]["judge_temperature"] is None


def test_settings_has_no_secret(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _without_judge_env(monkeypatch)
    for name in SECRET_ENV:
        monkeypatch.setenv(name, f"https://user:{SENTINEL}@host" if "BASE" in name else SENTINEL)
    monkeypatch.setenv("JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("JUDGE_MODEL", "judge-x")
    monkeypatch.setenv("JUDGE_MODEL_FAMILY", "family-j")
    response = client.get("/api/v1/settings")
    assert response.status_code == 200
    assert SENTINEL not in response.text
    values = response.json()["values"]
    assert not [key for key in values if key.endswith(("_key", "_token", "_password"))]
    assert not NOT_RECORDED & set(values)


SETTINGS_FIXTURE = REPO_ROOT / "frontend/src/test/settings.fixture.json"


def _flatten(values: dict[str, Any], prefix: str = "") -> set[str]:
    keys: set[str] = set()
    for name, value in values.items():
        if isinstance(value, dict):
            keys |= _flatten(value, f"{prefix}{name}.")
        else:
            keys.add(f"{prefix}{name}")
    return keys


def test_the_frontend_settings_fixture_has_the_recorded_fields() -> None:
    """Help resolves its setting keys against this file, so it names the fields the API serves."""
    fixture = json.loads(SETTINGS_FIXTURE.read_text())
    expected = (
        _flatten(settings_fields(from_env(), FakeJudge(), "official", OFFICIAL_MIN_REPEATS))
        - NOT_RECORDED
    )
    assert _flatten(fixture["values"]) == expected


def test_settings_invalid_judge_is_a_configuration_error(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("JUDGE_REASONING", "sideways")
    response = client.get("/api/v1/settings")
    assert response.status_code == 503
    assert response.json()["error"]["error_code"] == "CONFIGURATION_ERROR"


# -- the second judge (D-100) -----------------------------------------------------


def _second_judge_of(runs_dir: Path, name: str) -> Path:
    """Run the second judge, with a fake gateway, over a published run."""
    settings = JudgeSettings("litellm", "ollama/muse-glimmer:latest", "muse", None, 0.0, "off")
    root = benchmarks.second_judge_dir(runs_dir)
    return second_judge.judge_run(runs_dir / name, settings, root, FakeGateway())


def test_second_judge_is_served_typed(client_with_runs: TestClient, runs_dir: Path) -> None:
    summary_path = _second_judge_of(runs_dir, "official-fixture")
    assert summary_path.is_relative_to(runs_dir.parent / "second-judge")
    response = client_with_runs.get("/api/v1/benchmarks/official-fixture/second-judge")
    assert response.status_code == 200
    body = SecondJudgeOut.model_validate(response.json())
    assert body.run_id == "official-fixture"
    assert body.labels is None
    assert body.run.second_judge.model == "ollama/muse-glimmer:latest"
    published = client_with_runs.get("/api/v1/benchmarks/official-fixture").json()["summary"]
    first = body.run.agreement_with_answer_level.first.model_dump()
    assert first == published["judge_agreement"]
    assert body.run.counts.repeats == body.run.counts.judged > 0
    assert set(body.run.means) == {"A", "B", "C"}


def test_second_judge_carries_the_label_check_of_the_same_model(
    client_with_runs: TestClient, runs_dir: Path
) -> None:
    run = json.loads(_second_judge_of(runs_dir, "official-fixture").read_text(encoding="utf-8"))
    measure = {"n": 4, "agreement": 0.5, "weighted_kappa": None, "kappa_shown": False}
    found = {**measure, "wrong_share": 0.5}
    labels = {
        **{key: run[key] for key in ("schema_version", "second_judge", "judge_prompt_version")},
        **{key: run[key] for key in ("judge_prompt_hash", "first_judge", "generation_model")},
        **{key: run[key] for key in ("started_at", "finished_at", "git_sha", "git_dirty")},
        **{key: run[key] for key in ("min_kappa_items", "counts")},
        "run_id": "official-2026-10-26",
        "kind": "labels",
        "sample": "v0.2.0-sample",
        "agreement_with_labels": {
            "run": "official-2026-10-26",
            "measures": {"judge_abstention_rule": "judge", "second_judge": "second"},
            "overall": {"judge_abstention_rule": found, "second_judge": found},
            "cells": {"agree": {"n": 4, "measures": {"second_judge": {**found, "flagged": False}}}},
        },
    }
    path = runs_dir.parent / "second-judge" / "labels-v0.2.0-sample" / "ollama-muse-glimmer-latest"
    path.mkdir(parents=True)
    (path / "summary.json").write_text(json.dumps(labels), encoding="utf-8")
    body = client_with_runs.get("/api/v1/benchmarks/official-fixture/second-judge").json()
    assert body["labels"]["sample"] == "v0.2.0-sample"
    assert body["labels"]["agreement_with_labels"]["overall"]["second_judge"]["n"] == 4


def test_second_judge_is_404_for_a_run_without_one_or_an_unknown_run(
    client_with_runs: TestClient, runs_dir: Path
) -> None:
    response = client_with_runs.get("/api/v1/benchmarks/official-fixture/second-judge")
    assert response.status_code == 404
    assert response.json()["error"]["error_code"] == "NOT_FOUND"
    assert "no second judge" in response.json()["error"]["message"]
    missing = client_with_runs.get("/api/v1/benchmarks/no-such-run/second-judge")
    assert missing.status_code == 404
    assert "no published benchmark run" in missing.json()["error"]["message"]
