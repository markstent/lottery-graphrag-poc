"""Bank questions in Live Lab: post-run scoring against the answer key and
the demo questions drawn from the frozen bank (Phase 4 Task 13, spec 10a.1).

The service tests use the benchmark runner's offline lab (hashing embedders,
the SCN-007 test corpus, the fake generator) with B and C over the static
SCN-007 neighbourhood, and a frozen bank over that corpus whose every
expected answer carries a sentinel, so a leak into a pipeline, an event or a
stored result is detectable. The demo question routes read the bank frozen
into the planted tiny world where the API finds the presentation world's.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import app.api.runs as runs_module
import pytest
from app.api.errors import ApiError
from app.api.runs import QueryService
from app.api.schemas import LIVE_SCORE_LABEL, LivePipelineScore, LiveScore, QueryRequest
from app.api.scoring import (
    INSTANCE_SCOPE,
    ScoreState,
    demo_questions,
    failed_record,
    interrupted_record,
    score_run,
    score_state,
    scored_record,
    stored_pipeline_run,
)
from app.evaluation import official
from app.evaluation import runner as runner_module
from app.evaluation.bank import BANK_VERSION
from app.evaluation.checks import SCORER_VERSION, TokenCheck
from app.evaluation.claims import Claim
from app.evaluation.grounding import DEMO_STRATA, BankInstance, FrozenBank
from app.evaluation.official import world_paths
from app.evaluation.runner import BenchmarkRunner, score_pipeline_run
from app.lab import Lab
from app.main import create_app
from app.persistence.store import RunRow, RunStore
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION
from fastapi.testclient import TestClient

from tests.helpers import (
    GRAPH,
    FailingGenerator,
    SlowNeighbours,
    offline_wiring,
    wait_until,
)
from tests.test_api_benchmarks import (  # noqa: F401
    data_dir,
    presentation_bank,
    runs_dir,
    tiny_bank,
)
from tests.test_benchmark_runner import indexed_lab
from tests.test_graph_rag import scn007_adjacency

FINISHED = frozenset({"completed", "failed", "cancelled"})
SENTINEL = "ANSWER-KEY-SENTINEL"
AD_HOC = "Which games had incidents?"


# -- the bank -----------------------------------------------------------------


def _instance(question_id: str, stratum: str, text: str, carrier: str) -> BankInstance:
    return BankInstance(
        instance_id=f"{question_id}-2026-INC_S007_GR",
        question_id=question_id,
        stratum=stratum,
        sub_stratum="id_anchored" if stratum == "H2" else None,
        ontology_dependent=stratum == "H2",
        world_seed=2026,
        anchor_id="INC_S007_GR",
        text=text,
        expected_answer=f"{SENTINEL} {question_id}: INC_S007_GR followed PLV_PAYMENTS_3.",
        checks=(TokenCheck("INC_S007_GR"),),
        claims=(
            Claim(f"{question_id}-c1", f"{SENTINEL} claim of {question_id}", frozenset({carrier})),
        ),
    )


@pytest.fixture
def world_dir(tmp_path: Path) -> Path:
    (tmp_path / "_manifest.json").write_text(
        json.dumps({"profile": "tiny", "world_seed": 2026}), encoding="utf-8"
    )
    return tmp_path


@pytest.fixture
def bank(world_dir: Path) -> FrozenBank:
    """A frozen bank over the test corpus, in a bank order that is not stratum order."""
    instances = (
        _instance("L01", "H3", "What is the status of incident INC_S007_GR?", "CHNK_S007_GR_00"),
        _instance(
            "L05", "H1", "Why did checkout fail in Greece after INC_S007_GR?", "CHNK_S007_GR_00"
        ),
        _instance("L06", "H1", "Which release did INC_S007_GR follow?", "CHNK_S007_UK_00"),
        _instance(
            "L09", "H2", "Which incidents elsewhere are like INC_S007_GR?", "CHNK_S007_UK_00"
        ),
        _instance("L20", "H5", "Which accounts share devices with INC_S007_GR?", "SPC_1"),
    )
    return FrozenBank(
        bank_version=BANK_VERSION,
        world_seed=2026,
        world_manifest_hash=hashlib.sha256((world_dir / "_manifest.json").read_bytes()).hexdigest(),
        record_serialiser_version=RECORD_SERIALISER_VERSION,
        scorer_version=SCORER_VERSION,
        ledger_hash="ledger-hash",
        instances=instances,
        unavailable=(),
        bank_hash="bank-hash",
    )


def first(bank: FrozenBank, stratum: str) -> BankInstance:
    return next(i for i in bank.instances if i.stratum == stratum)


# -- doubles ------------------------------------------------------------------


class SpyScore:
    """Scores with ``score_run`` and records what the worker had stored at the call."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.status_at_call: list[str] = []
        self.results_at_call: list[set[str]] = []
        self.last_event_at_call: list[str] = []

    def __call__(
        self, run: RunRow, results: dict[str, Any], events: list[dict[str, Any]], bank: FrozenBank
    ) -> LiveScore:
        self.calls.append(run.run_id)
        self.status_at_call.append(run.status)
        self.results_at_call.append(set(results))
        self.last_event_at_call.append(events[-1]["event_type"])
        return score_run(run, results, events, bank)


def failing_scorer(
    run: RunRow, results: dict[str, Any], events: list[dict[str, Any]], bank: FrozenBank
) -> LiveScore:
    raise RuntimeError("scorer defect")


class RecordingPipelines:
    def __init__(self) -> None:
        self.questions: list[str] = []


# -- fixtures -----------------------------------------------------------------


@pytest.fixture
def lab(world_dir: Path) -> Lab:
    return indexed_lab(world_dir)


@pytest.fixture
def spy_score() -> SpyScore:
    return SpyScore()


def _service(
    tmp_path: Path, lab: Lab, bank: FrozenBank, scorer: Any = score_run
) -> Iterator[QueryService]:
    service = QueryService(
        RunStore(tmp_path / "runs.db", retention=50),
        lambda: lab,
        GRAPH,
        bank=lambda: bank,
        scorer=scorer,
    )
    yield service
    wait_until(lambda: not service._active)
    service.store.close()


@pytest.fixture
def offline_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runs_module, "wired_pipelines", offline_wiring(scn007_adjacency()))
    monkeypatch.setattr(runner_module, "wired_pipelines", offline_wiring(scn007_adjacency()))


@pytest.fixture
def service(
    offline_graph: None, tmp_path: Path, lab: Lab, bank: FrozenBank, spy_score: SpyScore
) -> Iterator[QueryService]:
    yield from _service(tmp_path, lab, bank, spy_score)


@pytest.fixture
def release() -> threading.Event:
    return threading.Event()


@pytest.fixture
def service_with_slow_b(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    lab: Lab,
    bank: FrozenBank,
    spy_score: SpyScore,
    release: threading.Event,
) -> Iterator[QueryService]:
    monkeypatch.setattr(
        runs_module, "wired_pipelines", offline_wiring(SlowNeighbours(scn007_adjacency(), release))
    )
    yield from _service(tmp_path, lab, bank, spy_score)
    release.set()


@pytest.fixture
def recording_pipelines(monkeypatch: pytest.MonkeyPatch) -> RecordingPipelines:
    """Records the question every pipeline run receives."""
    recorder = RecordingPipelines()
    for cls in (StandardRagPipeline, GraphRagPipeline):
        original = cls.run

        def run(self: Any, question: str, *args: Any, _original: Any = original, **kw: Any) -> Any:
            recorder.questions.append(question)
            return _original(self, question, *args, **kw)

        monkeypatch.setattr(cls, "run", run)
    return recorder


@pytest.fixture
def client(offline_graph: None, lab: Lab) -> Iterator[TestClient]:
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as test_client:
        yield test_client
        _wait_idle(test_client)


@pytest.fixture
def client_with_bank(presentation_bank: FrozenBank, client: TestClient) -> TestClient:  # noqa: F811
    return client


@pytest.fixture
def client_without_bank(data_dir: Path, client: TestClient) -> TestClient:  # noqa: F811
    return client


# -- helpers ------------------------------------------------------------------


def request(**fields: Any) -> QueryRequest:
    return QueryRequest(**fields)


def wait_finished(service: QueryService, run_id: str) -> RunRow:
    """The run's final row, once its worker has retired it (scoring included)."""

    def retired() -> bool:
        row = service.store.get_run(run_id)
        return row is not None and row.status in FINISHED and run_id not in service._active

    wait_until(retired)
    row = service.store.get_run(run_id)
    assert row is not None
    return row


def _wait_idle(client: TestClient) -> None:
    def idle() -> bool:
        runs = client.get("/api/v1/queries?limit=100").json()["runs"]
        return all(run["status"] in FINISHED for run in runs)

    wait_until(idle)
    # Retired too: a worker scores a bank question after its final status.
    service = client.app.state.query_service  # type: ignore[attr-defined]
    wait_until(lambda: not service._active)


def run_to_completion(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post("/api/v1/queries", json=body)
    assert response.status_code == 202, response.text
    run_id = response.json()["run_id"]
    payload: dict[str, Any] = {}

    def finished() -> bool:
        payload.update(client.get(f"/api/v1/queries/{run_id}").json())
        return payload["status"] in FINISHED

    wait_until(finished)
    return payload


def scored(client: TestClient, run_id: str) -> dict[str, Any]:
    """The run's results once its score is stored (it follows the final status)."""
    payload: dict[str, Any] = {}

    def has_score() -> bool:
        payload.update(client.get(f"/api/v1/queries/{run_id}").json())
        return payload["score"] is not None

    wait_until(has_score)
    return payload


# -- the brief's tests ----------------------------------------------------------


def test_scoring_happens_only_after_the_run_record_is_complete(
    service: QueryService, bank: FrozenBank, spy_score: SpyScore
) -> None:
    instance = first(bank, "H1")
    run_id = service.start(
        request(benchmark_instance_id=instance.instance_id, configurations=["A", "B"])
    )
    wait_finished(service, run_id)
    assert spy_score.calls == [run_id]
    assert spy_score.status_at_call == ["completed"]
    assert spy_score.results_at_call == [{"A", "B"}]
    assert spy_score.last_event_at_call == ["run.completed"]
    stored = service.store.score(run_id)
    assert stored is not None and stored["status"] == "scored"
    assert stored["score"]["label"] == LIVE_SCORE_LABEL
    assert set(stored["score"]["per_pipeline"]) == {"A", "B"}


def test_pipelines_receive_no_expected_answer(
    service: QueryService, bank: FrozenBank, recording_pipelines: RecordingPipelines
) -> None:
    instance = first(bank, "H5")
    run_id = service.start(request(benchmark_instance_id=instance.instance_id))
    wait_finished(service, run_id)
    assert recording_pipelines.questions == [instance.text] * 3
    assert instance.expected_answer not in " ".join(recording_pipelines.questions)
    # Nothing the run recorded carries the answer key: no event, no result.
    recorded = json.dumps(service.store.events(run_id)) + json.dumps(service.store.results(run_id))
    assert SENTINEL not in recorded
    assert instance.expected_answer not in recorded


def test_cancelled_runs_are_not_scored(
    service_with_slow_b: QueryService,
    bank: FrozenBank,
    spy_score: SpyScore,
    release: threading.Event,
) -> None:
    run_id = service_with_slow_b.start(request(benchmark_instance_id=first(bank, "H1").instance_id))
    assert service_with_slow_b.cancel(run_id)
    release.set()
    assert wait_finished(service_with_slow_b, run_id).status == "cancelled"
    assert spy_score.calls == []
    assert service_with_slow_b.store.score(run_id) is None


def test_demo_questions_are_one_bank_instance_per_stratum(client_with_bank: TestClient) -> None:
    demos = client_with_bank.get("/api/v1/demo/questions").json()
    assert [d["stratum"] for d in demos] == ["H1", "H2", "H3", "H5"]
    assert not any(d["question_id"].startswith("Q") for d in demos)


def test_ad_hoc_questions_state_that_no_answer_key_exists(client: TestClient) -> None:
    results = run_to_completion(client, question=AD_HOC)
    _wait_idle(client)
    results = client.get(f"/api/v1/queries/{results['run_id']}").json()
    assert results["score"] is None and results["answer_key"] == "none"
    assert results["score_status"] == "not_applicable"
    assert results["benchmark_instance_id"] is None


# -- equivalence with the benchmark runner --------------------------------------


def test_a_live_score_equals_the_runner_score_for_the_same_results(
    service: QueryService, lab: Lab, bank: FrozenBank, world_dir: Path
) -> None:
    instance = first(bank, "H1")
    run_id = service.start(request(benchmark_instance_id=instance.instance_id))
    wait_finished(service, run_id)
    record = service.store.score(run_id)
    assert record is not None and record["status"] == "scored"
    live = record["score"]

    one = dataclasses.replace(bank, instances=(instance,))
    world = BenchmarkRunner(lab, GRAPH, one, world_dir, kind="smoke", repeats=1).run()
    result = world.results[0]
    results, events = service.store.results(run_id), service.store.events(run_id)
    for tag in ("A", "B", "C"):
        runner_run, runner_score = result.runs[tag][0], result.scores[tag][0]
        assert runner_score is not None
        stored = stored_pipeline_run(tag, results[tag], events)
        # The fields the scorers read are the runner's own for the same run.
        for field in (
            "verdict",
            "answer",
            "cited_blocks",
            "selected",
            "resolved_ids",
            "seeded",
            "context_tokens",
            "answer_form",
            "finish_reason",
            "token_limit_reached",
            "cut_off",
            "surrogates_replaced",
        ):
            assert getattr(stored, field) == getattr(runner_run, field), (tag, field)
        # A stored run keeps no block texts, so a live score has no groundedness.
        assert runner_score.groundedness is not None
        assert score_pipeline_run(instance, stored) == dataclasses.replace(
            runner_score, judge=None, groundedness=None
        )
        assert LivePipelineScore.model_validate(live["per_pipeline"][tag]) == LivePipelineScore(
            answer=runner_score.answer,
            evidence_recall=runner_score.evidence.recall,
            anchor_resolution=float(runner_score.evidence.anchor_resolved),
            failure_class=runner_score.failure_class,
        )
    # Not a vacuous comparison: B and C resolve the anchor, A finds a claim.
    assert result.runs["B"][0].resolved_ids == ("INC_S007_GR",)
    assert live["per_pipeline"]["A"]["evidence_recall"] is not None


# -- the start rules ------------------------------------------------------------


def test_a_bank_question_runs_with_its_own_text(service: QueryService, bank: FrozenBank) -> None:
    instance = first(bank, "H1")
    with pytest.raises(ApiError) as refused:
        service.start(request(benchmark_instance_id=instance.instance_id, question=AD_HOC))
    assert (refused.value.status, refused.value.message) == (
        422,
        "a bank question runs with its own text",
    )
    run_id = service.start(
        request(benchmark_instance_id=instance.instance_id, question=instance.text)
    )
    row = wait_finished(service, run_id)
    assert (row.question, row.benchmark_instance_id) == (instance.text, instance.instance_id)
    assert len(service.store.list_runs(10, None, None)) == 1


def test_an_instance_the_bank_does_not_hold_is_refused(service: QueryService) -> None:
    with pytest.raises(ApiError) as refused:
        service.start(request(benchmark_instance_id="L99-2026-NOPE"))
    assert refused.value.status == 422 and "L99-2026-NOPE" in refused.value.message
    assert service.store.list_runs(10, None, None) == []
    # The refusal took no lease: the next run starts.
    service.start(request(question=AD_HOC))


def test_a_question_or_an_instance_is_required(client: TestClient) -> None:
    response = client.post("/api/v1/queries", json={"configurations": ["A"]})
    assert response.status_code == 422


def test_a_failed_run_is_not_scored(
    offline_graph: None, tmp_path: Path, lab: Lab, bank: FrozenBank, spy_score: SpyScore
) -> None:
    failing = dataclasses.replace(lab, generator=FailingGenerator())
    for service in _service(tmp_path, failing, bank, spy_score):
        run_id = service.start(request(benchmark_instance_id=first(bank, "H1").instance_id))
        assert wait_finished(service, run_id).status == "failed"
        assert spy_score.calls == [] and service.store.score(run_id) is None


def test_a_scorer_failure_leaves_the_run_completed_and_records_the_failure(
    offline_graph: None,
    tmp_path: Path,
    lab: Lab,
    bank: FrozenBank,
    caplog: pytest.LogCaptureFixture,
) -> None:
    instance = first(bank, "H1")
    for service in _service(tmp_path, lab, bank, failing_scorer):
        with caplog.at_level(logging.ERROR, logger="app.api.runs"):
            run_id = service.start(request(benchmark_instance_id=instance.instance_id))
            row = wait_finished(service, run_id)
        assert row.status == "completed" and row.error is None
        assert service.store.score(run_id) == {"status": "failed"}
    failure = next(r for r in caplog.records if r.message.startswith("live scoring failed"))
    assert failure.__dict__["instance_id"] == instance.instance_id
    assert SENTINEL not in failure.getMessage()


def test_a_scorer_failure_logs_no_message_and_no_traceback(
    offline_graph: None,
    tmp_path: Path,
    lab: Lab,
    bank: FrozenBank,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A scorer's message can quote an expected value, so only its type and
    error code reach the log."""

    def leaking_scorer(
        run: RunRow, results: dict[str, Any], events: list[dict[str, Any]], bank: FrozenBank
    ) -> LiveScore:
        raise ValueError(f"expected {SENTINEL!r}")

    for service in _service(tmp_path, lab, bank, leaking_scorer):
        with caplog.at_level(logging.DEBUG):
            run_id = service.start(request(benchmark_instance_id=first(bank, "H1").instance_id))
            wait_finished(service, run_id)
    failure = next(r for r in caplog.records if r.message.startswith("live scoring failed"))
    assert failure.exc_info is None
    assert failure.__dict__["error_type"] == "ValueError"
    assert failure.__dict__["error_code"] == "RUN_ERROR"
    assert SENTINEL not in caplog.text
    assert all(SENTINEL not in str(value) for value in failure.__dict__.values())


# -- the routes -------------------------------------------------------------------


def test_a_bank_question_over_http_is_scored_against_the_answer_key(
    client_with_bank: TestClient,
    presentation_bank: FrozenBank,  # noqa: F811
) -> None:
    demo = client_with_bank.get("/api/v1/demo/questions").json()[0]
    response = client_with_bank.post(
        "/api/v1/queries", json={"benchmark_instance_id": demo["instance_id"]}
    )
    assert response.status_code == 202, response.text
    results = scored(client_with_bank, response.json()["run_id"])
    assert results["status"] == "completed" and results["question"] == demo["text"]
    assert results["answer_key"] == "available" and results["score_status"] == "scored"
    assert results["benchmark_instance_id"] == demo["instance_id"]
    assert results["score"]["label"] == "scored against the answer key"
    assert results["score"]["instance_id"] == demo["instance_id"]
    assert set(results["score"]["per_pipeline"]) == {"A", "B", "C"}
    assert set(results["score"]["per_pipeline"]["A"]) == {
        "answer",
        "evidence_recall",
        "evidence_f1",
        "anchor_resolution",
        "failure_class",
    }
    # Method v0.3 compares evidence recall (D-087); F1 is not scored live.
    assert all(p["evidence_f1"] is None for p in results["score"]["per_pipeline"].values())


def test_demo_questions_carry_no_answer_key(
    client_with_bank: TestClient,
    presentation_bank: FrozenBank,  # noqa: F811
) -> None:
    demos = client_with_bank.get("/api/v1/demo/questions").json()
    assert demos == [d.model_dump() for d in demo_questions(presentation_bank)]
    assert all(
        set(d) == {"instance_id", "question_id", "text", "stratum", "market_scope", "easy_text"}
        for d in demos
    )
    expected = {i.expected_answer for i in presentation_bank.instances}
    assert not expected & {d["text"] for d in demos}
    assert not expected & {d["easy_text"] for d in demos if d["easy_text"] is not None}


def test_demo_questions_take_the_first_instance_of_each_stratum(bank: FrozenBank) -> None:
    demos = demo_questions(bank)
    assert [d.question_id for d in demos] == ["L05", "L09", "L01", "L20"]
    assert [d.stratum for d in demos] == list(DEMO_STRATA)
    assert all(d.market_scope == list(INSTANCE_SCOPE) for d in demos)


def test_without_a_grounded_bank_demo_questions_and_bank_runs_are_unavailable(
    client_without_bank: TestClient,
) -> None:
    for response in (
        client_without_bank.get("/api/v1/demo/questions"),
        client_without_bank.post("/api/v1/queries", json={"benchmark_instance_id": "L05-x"}),
    ):
        assert response.status_code == 503
        assert response.json()["error"]["message"] == (
            "the question bank has not been grounded; run make ground-bank"
        )
    assert client_without_bank.get("/api/v1/queries").json()["runs"] == []


# -- score status and scope -------------------------------------------------------


def _row(status: str, instance_id: str | None) -> RunRow:
    return RunRow(
        run_id="RUN-X",
        kind="live",
        status=status,
        question="q",
        market_scope=(),
        configurations=("A",),
        benchmark_instance_id=instance_id,
        created_at="2026-10-20T00:00:00+00:00",
        finished_at=None,
        pipeline_status={"A": "completed"},
        error=None,
    )


SCORE = LiveScore(instance_id="L05-x", per_pipeline={})


@pytest.mark.parametrize(
    ("status", "instance_id", "record", "expected"),
    [
        ("completed", None, None, ScoreState("not_applicable")),
        ("cancelled", "L05-x", None, ScoreState("not_applicable")),
        ("failed", "L05-x", None, ScoreState("not_applicable")),
        ("running", "L05-x", None, ScoreState("not_applicable")),
        ("completed", "L05-x", None, ScoreState("pending")),
        ("completed", "L05-x", scored_record(SCORE), ScoreState("scored", SCORE)),
        ("completed", "L05-x", failed_record(), ScoreState("failed")),
        (
            "completed",
            "L05-x",
            interrupted_record(),
            ScoreState("failed", failure_reason="interrupted"),
        ),
    ],
)
def test_score_status_follows_the_run_and_its_score_record(
    status: str, instance_id: str | None, record: dict[str, Any] | None, expected: Any
) -> None:
    assert score_state(_row(status, instance_id), record) == expected


def test_a_score_stored_under_the_old_method_still_reads() -> None:
    """A live score stored before method v0.3 holds evidence F1 and no
    recall; it still reads, with its F1 kept and no recall made up."""
    old = {
        "status": "scored",
        "score": {
            "instance_id": "L05-x",
            "label": LIVE_SCORE_LABEL,
            "per_pipeline": {
                "A": {
                    "answer": 0.0,
                    "evidence_f1": 0.5,
                    "anchor_resolution": 1.0,
                    "failure_class": None,
                }
            },
        },
    }
    state = score_state(_row("completed", "L05-x"), old)
    assert state.score is not None
    a = state.score.per_pipeline["A"]
    assert a.evidence_f1 == 0.5 and a.evidence_recall is None


class BlockedScorer:
    """Scores only once released, so the run reads completed and pending."""

    def __init__(self) -> None:
        self.release = threading.Event()

    def __call__(
        self, run: RunRow, results: dict[str, Any], events: list[dict[str, Any]], bank: FrozenBank
    ) -> LiveScore:
        assert self.release.wait(30), "the test never released the scorer"
        return score_run(run, results, events, bank)


def _bank_run(client: TestClient) -> str:
    demo = client.get("/api/v1/demo/questions").json()[0]
    response = client.post("/api/v1/queries", json={"benchmark_instance_id": demo["instance_id"]})
    assert response.status_code == 202, response.text
    run_id: str = response.json()["run_id"]
    return run_id


def test_a_completed_bank_question_is_pending_until_it_is_scored(
    client_with_bank: TestClient,
) -> None:
    scorer = BlockedScorer()
    client_with_bank.app.state.query_service._scorer = scorer  # type: ignore[attr-defined]
    run_id = _bank_run(client_with_bank)
    try:
        wait_until(
            lambda: (
                client_with_bank.get(f"/api/v1/queries/{run_id}").json()["status"] == "completed"
            )
        )
        pending = client_with_bank.get(f"/api/v1/queries/{run_id}").json()
        assert (pending["score_status"], pending["score"]) == ("pending", None)
    finally:
        scorer.release.set()
    assert scored(client_with_bank, run_id)["score_status"] == "scored"


def test_a_failed_scoring_reads_failed_over_http(client_with_bank: TestClient) -> None:
    client_with_bank.app.state.query_service._scorer = failing_scorer  # type: ignore[attr-defined]
    run_id = _bank_run(client_with_bank)
    payload: dict[str, Any] = {}

    def settled() -> bool:
        payload.update(client_with_bank.get(f"/api/v1/queries/{run_id}").json())
        return payload["score_status"] not in ("pending", "not_applicable")

    wait_until(settled)
    assert (payload["status"], payload["score_status"], payload["score"]) == (
        "completed",
        "failed",
        None,
    )


def test_a_bank_question_runs_with_its_own_scope(service: QueryService, bank: FrozenBank) -> None:
    instance = first(bank, "H1")
    with pytest.raises(ApiError) as refused:
        service.start(request(benchmark_instance_id=instance.instance_id, market_scope=["GR"]))
    assert (refused.value.status, refused.value.message) == (
        422,
        "a bank question runs with its own scope",
    )
    assert service.store.list_runs(10, None, None) == []
    run_id = service.start(request(benchmark_instance_id=instance.instance_id, market_scope=[]))
    assert wait_finished(service, run_id).market_scope == ()
    # An ad hoc question keeps the scope it asks for.
    ad_hoc = service.start(request(question=AD_HOC, market_scope=["GR"]))
    assert wait_finished(service, ad_hoc).market_scope == ("MKT_GR",)


def test_a_bank_run_whose_scoring_a_stop_cut_off_reads_interrupted_at_start_up(
    offline_graph: None, lab: Lab, run_database: Path
) -> None:
    left = RunStore(run_database, retention=50)
    left.create_run(
        dataclasses.replace(
            _row("completed", "L05-2026-INC_S007_GR"),
            run_id="RUN-UNSCORED",
            created_at=datetime.now(UTC).isoformat(),
        )
    )
    left.close()
    with TestClient(create_app(lab_factory=lambda: lab, graph_config=GRAPH)) as client:
        run = client.get("/api/v1/queries/RUN-UNSCORED").json()
    assert (run["status"], run["score_status"], run["score_failure"], run["score"]) == (
        "completed",
        "failed",
        "interrupted",
        None,
    )


def test_a_stale_bank_is_a_configuration_error_not_a_server_error(
    client_with_bank: TestClient,
    data_dir: Path,  # noqa: F811
) -> None:
    """A bank that no longer matches its world or ledger reads as a plain 503."""
    bank_path = world_paths(official.PRESENTATION_SEED).bank_path
    document = json.loads(bank_path.read_text(encoding="utf-8"))
    document["bank_version"] = "0.0.1"
    bank_path.write_text(json.dumps(document), encoding="utf-8")
    for response in (
        client_with_bank.get("/api/v1/demo/questions"),
        client_with_bank.post("/api/v1/queries", json={"benchmark_instance_id": "L05-x"}),
    ):
        assert response.status_code == 503
        error = response.json()["error"]
        assert error["error_code"] == "CONFIGURATION_ERROR"
        assert error["message"] == (
            "the question bank does not match the active world; run make ground-bank"
        )
