"""summary.json v2 and report.md over a hand-built BenchmarkRun with known scores."""

from __future__ import annotations

import json
from typing import Any

import pytest
from app.evaluation.checks import CitationMetrics, TokenCheck
from app.evaluation.claims import Claim
from app.evaluation.grounding import BankInstance, Unavailable
from app.evaluation.judge import JudgeScores, JudgeVerdict
from app.evaluation.report import (
    SMOKE_HEADLINE,
    SUMMARY_SCHEMA_VERSION,
    render_report,
    summarize,
)
from app.evaluation.runner import (
    BenchmarkRun,
    InstanceResult,
    PipelineRun,
    ReproducibilityRecord,
    RunScore,
    WorldRun,
)
from app.evaluation.scoring import EvidenceScore

SEEDS = (2026, 2027)
FAMILY = {
    ("H1", "evidence_f1"),
    ("H2", "evidence_f1"),
    ("H5", "evidence_f1"),
    ("H1", "answer"),
    ("H2", "answer"),
    ("H3", "answer"),
    ("H5", "answer"),
}


def _record(kind: str) -> ReproducibilityRecord:
    return ReproducibilityRecord(
        git_sha="abc123",
        git_dirty=False,
        question_bank_version="2.0.0",
        world_dir="data/generated/dev-seed2026",
        generator_version="1.0.0",
        profile="dev",
        world_seed=2026,
        scenario_seed=7,
        embedding_model="fake-embed",
        embedding_dimensions=8,
        sparse_model="fake-sparse",
        rrf_k=60,
        record_serialiser_version="2.1.0",
        generation_model="fake-gen",
        generation_temperature=0.0,
        max_tokens=512,
        prompt_version="1",
        reranker="fake-rerank",
        top_k=8,
        context_budget_tokens=4000,
        context={"dedupe_threshold": 0.9, "evidence_slots": 8},
        graph_limits={"depth": 2},
        ranking_weights={"w": 1.0},
        reference_date="2026-01-01",
        excluded_labels=[],
        ontology_version="1",
        graph_label_version="v2",
        started_at="2026-10-19T10:00:00+00:00",
        bank_version="2.0.0",
        bank_hash="bankhash",
        scorer_version="2.0.0",
        prompt_hash="prompthash",
        relationship_types_b=["R"],
        relationship_types_c=["R", "O"],
        dedupe_threshold=0.9,
        generation_quantisation=None,
        generation_model_family="fake",
        repeats=3,
        run_kind=kind,
        judge_model="fake-judge-v1",
        judge_model_family="fake",
        judge_prompt_version="1.0.0",
        judge_prompt_hash="judgehash",
        judge_temperature=0.0,
        generation_reasoning="default",
        judge_reasoning="default",
    )


def _instance(
    question_id: str, stratum: str, seed: int, sub: str | None = None, anchor: str = "X"
) -> BankInstance:
    return BankInstance(
        instance_id=f"{question_id}-{seed}-{anchor}",
        question_id=question_id,
        stratum=stratum,
        sub_stratum=sub,
        ontology_dependent=stratum == "H2",
        world_seed=seed,
        anchor_id="X",
        text="question?",
        expected_answer="answer",
        checks=(TokenCheck("X"),),
        claims=(Claim(f"{question_id}-c1", "a statement", frozenset({"Y"})),),
    )


def _run(tag: str, repeat: int, failed: bool = False) -> PipelineRun:
    return PipelineRun(
        pipeline=tag,
        repeat=repeat,
        verdict="",
        answer="text",
        raw_text="text",
        cited_blocks=(),
        blocks=(),
        selected=(),
        resolved_ids=(),
        seeded=tag != "A",
        context_tokens=1000,
        latency_ms=100.0 * (1 + repeat),
        generation_failed=failed,
    )


def _score(answer: float, f1: float, judged: int | None = 2) -> RunScore:
    verdict = JudgeVerdict(
        scores=None if judged is None else JudgeScores(judged, judged, judged, judged, judged),
        failure="judge reply was not JSON" if judged is None else None,
        model="fake-judge-v1",
        latency_ms=1.0,
    )
    evidence = EvidenceScore(f1, f1, f1, 1, 1, 1.0, f1 > 0.3)
    failure_class = "retrieval_failure" if f1 < 0.5 else None
    return RunScore(answer, evidence, CitationMetrics(1.0, 0.5), failure_class, verdict)


def _result(
    instance: BankInstance, values: dict[str, list[tuple[float, float] | None]]
) -> InstanceResult:
    """values maps a pipeline to (answer, f1) per repeat; None is a failed generation."""
    runs = {
        tag: [_run(tag, i, failed=v is None) for i, v in enumerate(repeats)]
        for tag, repeats in values.items()
    }
    scores: dict[str, list[RunScore | None]] = {
        tag: [None if v is None else _score(*v) for v in repeats] for tag, repeats in values.items()
    }
    return InstanceResult(instance=instance, runs=runs, scores=scores)


def _graded(k: int) -> dict[str, list[tuple[float, float] | None]]:
    """B beats A, C beats B, by amounts that vary with k so the test is not degenerate."""
    a, b, c = 0.2, 0.4 + 0.02 * k, 0.5 + 0.03 * k
    return {"A": [(a, a)] * 2, "B": [(b, b)] * 2, "C": [(c, c)] * 2}


def _world(seed: int, h5_questions: int) -> WorldRun:
    results: list[InstanceResult] = []
    for q in range(6):
        results.append(_result(_instance(f"L1{q}", "H1", seed), _graded(q)))
        results.append(_result(_instance(f"L2{q}", "H2", seed, "id_anchored"), _graded(q)))
        results.append(
            _result(
                _instance(f"L3{q}", "H3", seed),
                {
                    "A": [(1.0, 0.2), (0.5, 0.2), None],
                    "B": [(0.5 + 0.05 * q, 0.2)] * 2,
                    "C": [(0.6 + 0.05 * q, 0.2)] * 2,
                },
            )
        )
    for q in range(3):
        results.append(_result(_instance(f"L4{q}", "H2", seed, "name_anchored"), _graded(q)))
    for q in range(h5_questions):
        results.append(_result(_instance(f"L5{q}", "H5", seed), _graded(q)))
    return WorldRun(seed, "bankhash", results, (Unavailable("L99", "no anchor"),))


def _benchmark(kind: str, h5_per_world: int, label: str | None = None) -> BenchmarkRun:
    return BenchmarkRun(kind, label, _record(kind), [_world(s, h5_per_world) for s in SEEDS])


@pytest.fixture(scope="module")
def synthetic_run() -> BenchmarkRun:
    return _benchmark("official", h5_per_world=6)


@pytest.fixture(scope="module")
def synthetic_summary(synthetic_run: BenchmarkRun) -> dict[str, Any]:
    return summarize(synthetic_run)


@pytest.fixture
def run_with_eight_h5_pairs() -> BenchmarkRun:
    return _benchmark("official", h5_per_world=4)


@pytest.fixture
def smoke_run() -> BenchmarkRun:
    # The label comes from the run kind, whatever the run carries.
    return _benchmark("smoke", h5_per_world=6)


def test_observations_average_repeats_and_skip_failures(synthetic_run: BenchmarkRun) -> None:
    summary = summarize(synthetic_run)
    assert summary["schema_version"] == SUMMARY_SCHEMA_VERSION == "2"
    assert summary["metrics"]["H3"]["answer"]["A"]["mean"] == pytest.approx(0.75)
    cell = summary["metrics"]["H3"]["answer"]["A"]
    assert (cell["n"], cell["repeats"]) == (12, 24)


def test_comparisons_use_holm_over_the_declared_family(synthetic_run: BenchmarkRun) -> None:
    family = [c for c in summarize(synthetic_run)["comparisons"] if c["in_family"]]
    assert {(c["stratum"], c["metric"]) for c in family} <= FAMILY
    assert len(family) == 2 * len(FAMILY)
    assert all(c["p_holm"] >= c["p"] for c in family)


def test_small_strata_make_no_claim(run_with_eight_h5_pairs: BenchmarkRun) -> None:
    summary = summarize(run_with_eight_h5_pairs)
    h5 = next(
        c for c in summary["comparisons"] if c["stratum"] == "H5" and c["metric"] == "evidence_f1"
    )
    assert not h5["in_family"] and h5["p"] is None and h5["p_holm"] is None
    assert any(
        line.startswith("Too few pairs") and "planted patterns" in line
        for line in summary["headlines"]
    )


def test_smoke_runs_carry_the_label_and_no_headline_claims(smoke_run: BenchmarkRun) -> None:
    summary = summarize(smoke_run)
    assert summary["label"] == "scorer smoke test" and len(summary["headlines"]) == 1
    assert summary["headlines"] == [SMOKE_HEADLINE]
    assert summary["run_kind"] == "smoke"
    assert any(c["in_family"] for c in summary["comparisons"])


def test_report_shows_only_summarised_numbers(synthetic_run: BenchmarkRun) -> None:
    summary, report = summarize(synthetic_run), render_report(synthetic_run)
    assert all(line in report for line in summary["headlines"])
    assert report.index(summary["headlines"][0]) < report.index("## H1")
    assert "selection only" in report


def test_headlines_cover_each_stratum_and_the_name_anchored_subgroup(
    synthetic_summary: dict[str, Any],
) -> None:
    headlines = synthetic_summary["headlines"]
    assert isinstance(headlines, list)
    assert len(headlines) == 10
    assert headlines[0].startswith("Graph exceeds text search by")
    assert "evidence points" in headlines[0] and "multi-hop questions" in headlines[0]
    assert any("answer points" in line and "single facts" in line for line in headlines)
    subgroup = [line for line in headlines if line.startswith("Name-anchored questions:")]
    assert len(subgroup) == 2
    assert all(line.endswith("no test is run on this sub-group.") for line in subgroup)


def test_out_of_family_cells_run_no_test(synthetic_summary: dict[str, Any]) -> None:
    comparisons = synthetic_summary["comparisons"]
    assert isinstance(comparisons, list)
    name = [c for c in comparisons if c["stratum"] == "H2_name"]
    assert name and all(not c["in_family"] and c["p"] is None for c in name)
    assert all(c["n"] == 6 and c["clusters"] == 6 for c in name if c["metric"] == "evidence_f1")


def test_pairs_cluster_by_question_and_world(synthetic_summary: dict[str, Any]) -> None:
    comparisons = synthetic_summary["comparisons"]
    assert isinstance(comparisons, list)
    h1 = next(c for c in comparisons if c["stratum"] == "H1" and c["metric"] == "evidence_f1")
    assert (h1["comparison"], h1["n"], h1["clusters"]) == ("B_vs_A", 12, 12)
    assert h1["low"] <= h1["mean"] <= h1["high"]


def test_counts_failures_agreement_and_basis(synthetic_summary: dict[str, Any]) -> None:
    summary = synthetic_summary
    assert summary["worlds"] == [2026, 2027]
    assert summary["bank_version"] == "2.0.0"
    assert summary["instances"]["total"] == {
        "H1": 12,
        "H2": 12,
        "H2_name": 6,
        "H3": 12,
        "H5": 12,
        "overall": 54,
    }
    assert summary["instances"]["per_world"]["2026"]["H2_name"] == 3
    missing = [{"question_id": "L99", "reason": "no anchor"}]
    assert summary["unavailable"] == {"2026": missing, "2027": missing}
    assert summary["failures"]["generation"] == {"A": 12, "B": 0, "C": 0}
    assert summary["failures"]["judge"] == {"A": 0, "B": 0, "C": 0}
    assert summary["failures"]["classes"]["A"]["retrieval_failure"] > 0
    assert summary["judge_agreement"]["overall"]["n"] > 0
    assert set(summary["judge_agreement"]["pipelines"]) == {"A", "B", "C"}
    assert summary["anchor_resolution_basis"] == {
        "A": "selection",
        "B": "resolution",
        "C": "resolution",
    }
    assert summary["reproducibility"]["run"]["bank_hash"] == "bankhash"
    assert summary["metrics"]["overall"]["judge_correctness"]["B"]["mean"] == pytest.approx(2.0)
    assert summary["metrics"]["H1"]["latency_ms"]["A"]["mean"] == pytest.approx(150.0)
    json.dumps(summary, allow_nan=False)


def test_judge_failures_are_counted_and_not_zero() -> None:
    instance = _instance("L10", "H1", 2026)
    result = _result(instance, {"A": [(1.0, 1.0)]})
    failed = RunScore(
        1.0,
        EvidenceScore(1.0, 1.0, 1.0, 1, 1, 1.0, True),
        CitationMetrics(None, None),
        None,
        JudgeVerdict(None, "judge reply was not JSON", "fake-judge-v1", 1.0),
    )
    result.scores["A"].append(failed)
    result.runs["A"].append(_run("A", 1))
    run = BenchmarkRun("sweep", None, _record("sweep"), [WorldRun(2026, "h", [result], ())])
    summary = summarize(run)
    assert summary["failures"]["judge"]["A"] == 1
    cell = summary["metrics"]["H1"]["judge_correctness"]["A"]
    assert (cell["mean"], cell["repeats"]) == (2.0, 1)


def test_comparisons_name_why_they_were_or_were_not_tested(
    synthetic_summary: dict[str, Any],
) -> None:
    comparisons = synthetic_summary["comparisons"]
    assert isinstance(comparisons, list)
    reasons = {(c["stratum"], c["metric"]): c["reason"] for c in comparisons}
    assert reasons[("H1", "evidence_f1")] == "tested"
    assert reasons[("H3", "evidence_f1")] == "not_in_family"
    assert reasons[("H2_name", "evidence_f1")] == "not_in_family"
    assert all((c["reason"] == "tested") == c["in_family"] for c in comparisons)


def test_report_reads_counts_and_reasons_from_the_summary(synthetic_run: BenchmarkRun) -> None:
    report = render_report(synthetic_run)
    assert "## overall: every question\n\nInstances: 54." in report
    assert "| tested |" in report and "| not tested: outside the family |" in report


def test_twelve_pairs_in_four_groups_make_no_claim() -> None:
    results = [
        _result(_instance(f"L1{q}", "H1", seed, anchor=f"X{k}"), _graded(q + k))
        for seed in SEEDS
        for q in range(2)
        for k in range(3)
    ]
    world = {seed: [r for r in results if r.instance.world_seed == seed] for seed in SEEDS}
    run = BenchmarkRun(
        "official",
        None,
        _record("official"),
        [WorldRun(seed, "bankhash", world[seed], ()) for seed in SEEDS],
    )
    summary = summarize(run)
    cell = next(
        c
        for c in summary["comparisons"]
        if c["stratum"] == "H1" and c["metric"] == "evidence_f1" and c["comparison"] == "B_vs_A"
    )
    assert (cell["n"], cell["clusters"]) == (12, 4)
    assert not cell["in_family"] and cell["p_holm"] is None and cell["reason"] == "too_few"
    assert summary["headlines"][0] == (
        "Too few pairs to say for Graph and text search on multi-hop questions "
        "(12 pairs in 4 groups)."
    )


def test_the_run_start_is_printed_once_outside_the_shared_list(
    synthetic_run: BenchmarkRun,
) -> None:
    report = render_report(synthetic_run)
    assert "Run started: 2026-10-19T10:00:00+00:00 (when the first world started)." in report
    shared = report.split("Shared by every world:")[1].split("### World")[0]
    assert "started_at" not in shared
    worlds = report.split("Shared by every world:")[1].split("### World")[1:]
    assert all("- started_at: `2026-10-19T10:00:00+00:00`" in world for world in worlds)


def test_smoke_comparisons_say_they_are_not_a_result(smoke_run: BenchmarkRun) -> None:
    report = render_report(smoke_run)
    assert "| tested (smoke run, not a result) |" in report
    assert "| tested |" not in report
    assert "| tested |" in render_report(_benchmark("official", h5_per_world=6))
