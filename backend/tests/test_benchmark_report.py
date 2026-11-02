"""summary.json v2 and report.md over a hand-built BenchmarkRun with known scores."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest
from app.api.benchmarks import _instances, _published, _summary_out
from app.config import METHOD_VERSION
from app.evaluation.checks import CitationMetrics, GroundednessScore, TokenCheck
from app.evaluation.claims import Claim
from app.evaluation.grounding import BankInstance, Unavailable
from app.evaluation.judge import JudgeScores, JudgeVerdict
from app.evaluation.report import (
    HOLM_FAMILY,
    METHOD_NOTE,
    SMOKE_HEADLINE,
    SUMMARY_SCHEMA_VERSION,
    _agreement_section,
    instance_means,
    judge_agreement,
    observe,
    render_report,
    summarize,
)
from app.evaluation.runner import (
    DEV_LABEL,
    BenchmarkRun,
    InstanceResult,
    PipelineRun,
    ReproducibilityRecord,
    RunScore,
    WorldRun,
    instance_result_from_payload,
)
from app.evaluation.scoring import EvidenceScore

SEEDS = (2026, 2027)
FAMILY = {
    ("H1", "evidence_recall"),
    ("H2", "evidence_recall"),
    ("H5", "evidence_recall"),
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
        context={"budget_tokens": 4000, "dedupe_threshold": 0.9},
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
    grounded = GroundednessScore(
        atoms=4, supported_share=0.75, unsupported_share=0.25, abstained=False
    )
    return RunScore(answer, evidence, CitationMetrics(1.0, 0.5), failure_class, verdict, grounded)


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
    """A run of method v0.3, the only method that writes summary schema 3."""
    record = dataclasses.replace(_record(kind), method_version=METHOD_VERSION)
    return BenchmarkRun(kind, label, record, [_world(s, h5_per_world) for s in SEEDS])


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


def _of_method(run: BenchmarkRun, method_version: str | None) -> BenchmarkRun:
    return dataclasses.replace(
        run, record=dataclasses.replace(run.record, method_version=method_version)
    )


@pytest.mark.parametrize("kind", ["official", "dev", "smoke", "sweep"])
def test_every_v03_report_declares_the_method_change(kind: str) -> None:
    """D-093: a method v0.3 run of any kind says, in its report header and its
    summary, that the method was made after seeing v0.2.0."""
    run = _of_method(_benchmark(kind, h5_per_world=6), METHOD_VERSION)
    assert summarize(run)["method_note"] == METHOD_NOTE
    assert "after seeing the v0.2.0 result" in METHOD_NOTE and "D-093" in METHOD_NOTE
    header = render_report(run).split("## Headlines")[0]
    assert header.startswith(f"# Benchmark run\n\n{METHOD_NOTE}\n\nRun kind: {kind}.")
    assert render_report(run).count(METHOD_NOTE) == 1


def test_a_v02_report_carries_no_method_note(synthetic_run: BenchmarkRun) -> None:
    run = _of_method(synthetic_run, None)
    assert summarize(run)["method_note"] is None
    assert METHOD_NOTE not in render_report(run)
    assert "after seeing" not in render_report(run)


def test_observations_average_repeats_and_skip_failures(synthetic_run: BenchmarkRun) -> None:
    summary = summarize(synthetic_run)
    assert summary["schema_version"] == SUMMARY_SCHEMA_VERSION == "3"
    assert summary["metrics"]["H3"]["answer"]["A"]["mean"] == pytest.approx(0.75)
    cell = summary["metrics"]["H3"]["answer"]["A"]
    assert (cell["n"], cell["repeats"]) == (12, 24)


def test_comparisons_use_holm_over_the_declared_family(synthetic_run: BenchmarkRun) -> None:
    family = [c for c in summarize(synthetic_run)["comparisons"] if c["in_family"]]
    assert {(c["stratum"], c["metric"]) for c in family} <= FAMILY
    assert len(family) == 2 * len(FAMILY)
    assert all(c["p_holm"] >= c["p"] for c in family)


def test_tested_family_uses_evidence_recall_and_excludes_c_vs_a(
    synthetic_summary: dict[str, Any],
) -> None:
    comparisons = synthetic_summary["comparisons"]
    c_vs_a = [c for c in comparisons if c["comparison"] == "C_vs_A"]
    assert c_vs_a and all(c["reason"] == "not_in_family" for c in c_vs_a)
    assert all(c["p"] is None and c["p_holm"] is None for c in c_vs_a)
    # Descriptive: C_vs_A still reports its interval.
    h1 = next(c for c in c_vs_a if c["stratum"] == "H1" and c["metric"] == "evidence_recall")
    assert h1["n"] == 12 and h1["low"] <= h1["mean"] <= h1["high"]
    family = [c for c in comparisons if c["in_family"]]
    assert {c["metric"] for c in family} == {"evidence_recall", "answer"}
    assert {c["comparison"] for c in family} == {"B_vs_A", "C_vs_B"}
    assert {
        (comparison, stratum, metric)
        for comparison in ("B_vs_A", "C_vs_B")
        for stratum, metric in FAMILY
    } == HOLM_FAMILY
    assert not any("C_vs_A" in str(cell) for cell in synthetic_summary["ontology_split"])
    assert not any(line.startswith("Ontology") for line in synthetic_summary["headlines"])


def test_summary_reports_groundedness_descriptively(synthetic_run: BenchmarkRun) -> None:
    summary = summarize(synthetic_run)
    for stratum in ("H1", "overall"):
        for tag in ("A", "B", "C"):
            assert summary["metrics"][stratum]["grounded_supported"][tag]["mean"] == (
                pytest.approx(0.75)
            )
            assert summary["metrics"][stratum]["grounded_unsupported"][tag]["mean"] == (
                pytest.approx(0.25)
            )
    assert not any("grounded" in c["metric"] for c in summary["comparisons"])
    report = render_report(synthetic_run)
    assert "## Groundedness (descriptive)" in report
    section = report.split("## Groundedness (descriptive)")[1].split("\n## ")[0]
    assert "| H1 | A | 0.750 (n 12) | 0.250 (n 12) |" in section


def test_small_strata_make_no_claim(run_with_eight_h5_pairs: BenchmarkRun) -> None:
    summary = summarize(run_with_eight_h5_pairs)
    h5 = next(
        c
        for c in summary["comparisons"]
        if c["stratum"] == "H5" and c["metric"] == "evidence_recall"
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
    assert all(c["n"] == 6 and c["clusters"] == 6 for c in name if c["metric"] == "evidence_recall")


def test_pairs_cluster_by_question_and_world(synthetic_summary: dict[str, Any]) -> None:
    comparisons = synthetic_summary["comparisons"]
    assert isinstance(comparisons, list)
    h1 = next(c for c in comparisons if c["stratum"] == "H1" and c["metric"] == "evidence_recall")
    assert (h1["comparison"], h1["n"], h1["clusters"]) == ("B_vs_A", 12, 12)
    assert h1["low"] <= h1["mean"] <= h1["high"]


def _first_repeat_only(run: BenchmarkRun) -> BenchmarkRun:
    """The same run as if every question had been asked once (D-097)."""

    def once(result: InstanceResult) -> InstanceResult:
        return dataclasses.replace(
            result,
            runs={tag: runs[:1] for tag, runs in result.runs.items()},
            scores={tag: scores[:1] for tag, scores in result.scores.items()},
        )

    worlds = [
        dataclasses.replace(world, results=[once(r) for r in world.results]) for world in run.worlds
    ]
    return dataclasses.replace(
        run, record=dataclasses.replace(run.record, repeats=1), worlds=worlds
    )


def test_one_repeat_gives_the_same_pairs_groups_and_tests(
    synthetic_run: BenchmarkRun, synthetic_summary: dict[str, Any]
) -> None:
    """D-097: a pair is one instance and a group one question in one world, so
    asking once instead of twice changes no count, interval or p-value when
    the repeats agree; only the repeat counts follow the number of answers."""
    once = _first_repeat_only(synthetic_run)
    summary = summarize(once)

    def kept(cells: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # H3 is left out: its A repeats differ by design, so its answer mean moves.
        return [c for c in cells if c["stratum"] != "H3" or c["metric"] == "evidence_recall"]

    assert kept(summary["comparisons"]) == kept(synthetic_summary["comparisons"])
    for c, d in zip(summary["ontology_split"], synthetic_summary["ontology_split"], strict=True):
        assert (c["n"], c["clusters"]) == (d["n"], d["clusters"])
        if c["metric"] == "evidence_recall":
            assert c == d

    def not_h3(lines: list[str]) -> list[str]:
        return [line for line in lines if not line.endswith("on single facts.")]

    assert not_h3(summary["headlines"]) == not_h3(synthetic_summary["headlines"])
    assert len(not_h3(summary["headlines"])) == len(summary["headlines"]) - 2
    tested = [c for c in summary["comparisons"] if c["reason"] == "tested"]
    assert tested and all(c["p_holm"] is not None for c in tested)
    h1 = summary["metrics"]["H1"]["evidence_recall"]
    assert all((h1[tag]["n"], h1[tag]["repeats"]) == (12, 12) for tag in ("A", "B", "C"))
    h3 = summary["metrics"]["H3"]["answer"]["A"]
    assert (h3["mean"], h3["n"], h3["repeats"]) == (pytest.approx(1.0), 12, 12)
    # One answer per instance and approach: 54 instances, none failed.
    assert summary["failures"]["repeats"] == {"A": 54, "B": 54, "C": 54}
    assert summary["failures"]["generation"] == {"A": 0, "B": 0, "C": 0}
    assert summary["judge_agreement"]["overall"]["answered"]["n"] == 3 * 54
    assert summary["reproducibility"]["run"]["repeats"] == 1
    report = render_report(once)
    assert "three repeats" not in report and "3 repeats" not in report
    json.dumps(summary, allow_nan=False)


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
    assert summary["judge_agreement"]["overall"]["answered"]["n"] > 0
    assert summary["judge_agreement"]["overall"]["abstained"]["n"] == 0
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
    reasons = {(c["stratum"], c["metric"], c["comparison"]): c["reason"] for c in comparisons}
    assert reasons[("H1", "evidence_recall", "B_vs_A")] == "tested"
    assert reasons[("H1", "evidence_recall", "C_vs_A")] == "not_in_family"
    assert reasons[("H3", "evidence_recall", "B_vs_A")] == "not_in_family"
    assert reasons[("H2_name", "evidence_recall", "C_vs_B")] == "not_in_family"
    assert all((c["reason"] == "tested") == c["in_family"] for c in comparisons)


def test_agreement_section_reports_answered_and_abstained() -> None:
    instance = _instance("L10", "H1", 2026)
    runs = {
        "A": [
            dataclasses.replace(_run("A", 0), verdict="answer"),
            dataclasses.replace(_run("A", 1), verdict="unknown"),
            _run("A", 2, failed=True),
        ],
        "B": [dataclasses.replace(_run("B", i), verdict="answer") for i in range(2)],
    }
    scores: dict[str, list[RunScore | None]] = {
        "A": [_score(1.0, 1.0, judged=2), _score(0.0, 0.0, judged=2), None],
        "B": [_score(0.5, 1.0, judged=1), _score(0.0, 1.0, judged=0)],
    }
    agreements = judge_agreement([InstanceResult(instance, runs, scores)], ["A", "B"])
    # Answered pairs (answer level, judge correctness): A (2, 2), B (1, 1) and (0, 0).
    assert agreements["overall"]["answered"] == {"n": 3, "agreement": 1.0, "weighted_kappa": 1.0}
    # The one abstention scores 0 where the judge gave 2: no agreement, and
    # chance agreement is 0, so the weighted kappa is 0.
    assert agreements["overall"]["abstained"] == {
        "n": 1,
        "agreement": 0.0,
        "weighted_kappa": 0.0,
    }
    assert agreements["pipelines"]["A"]["answered"]["n"] == 1
    assert agreements["pipelines"]["B"]["abstained"] == {
        "n": 0,
        "agreement": None,
        "weighted_kappa": None,
    }
    section = "\n".join(_agreement_section(agreements))
    assert "| Pipeline | Answers | Judged repeats | Agreement | Weighted kappa |" in section
    assert "| all | answered | 3 | 1.000 | too few to say |" in section
    assert "| all | abstained | 1 | 0.000 | too few to say |" in section
    assert "| B | abstained | 0 | - | too few to say |" in section
    for level in ("Level 0", "Level 1", "Level 2"):
        assert level in section
    assert "0.5" not in section


def test_agreement_table_shows_kappa_only_from_ten_repeats() -> None:
    cell = {"agreement": 0.9, "weighted_kappa": 0.75}
    split = {"answered": {"n": 10, **cell}, "abstained": {"n": 9, **cell}}
    section = "\n".join(_agreement_section({"overall": split, "pipelines": {}}))
    assert "| all | answered | 10 | 0.900 | 0.750 |" in section
    assert "| all | abstained | 9 | 0.900 | too few to say |" in section
    assert "shown only over at least 10 judged repeats" in section


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
        if c["stratum"] == "H1" and c["metric"] == "evidence_recall" and c["comparison"] == "B_vs_A"
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


def test_dev_comparisons_say_they_are_not_a_result() -> None:
    report = render_report(_benchmark("dev", h5_per_world=6, label=DEV_LABEL))
    assert "| tested (development run, not a result) |" in report
    assert "| tested |" not in report
    assert f"Label: {DEV_LABEL}." in report


def test_dev_runs_make_no_headline_claims() -> None:
    summary = summarize(_benchmark("dev", h5_per_world=6, label=DEV_LABEL))
    assert summary["headlines"] == [
        "Development run on seed 2026, not a result: the tables are descriptive and no claim "
        "is made."
    ]
    assert not any("Holm" in line or "p " in line for line in summary["headlines"])
    # The descriptive tables stay.
    assert summary["comparisons"] and summary["metrics"]["H1"]["evidence_recall"]["B"]["n"]


def _with_flags(run: BenchmarkRun, flagged: set[str]) -> BenchmarkRun:
    """The run with ontology_dependent set exactly on the named questions."""
    worlds = [
        dataclasses.replace(
            world,
            results=[
                dataclasses.replace(
                    r,
                    instance=dataclasses.replace(
                        r.instance, ontology_dependent=r.instance.question_id in flagged
                    ),
                )
                for r in world.results
            ],
        )
        for world in run.worlds
    ]
    return dataclasses.replace(run, worlds=worlds)


@pytest.fixture
def run_with_ontology_flags() -> BenchmarkRun:
    # One H5 and one H2 question are flagged; the flag, not the stratum, decides.
    return _with_flags(_benchmark("official", h5_per_world=6), {"L50", "L20"})


@pytest.fixture
def same_run_all_flags_false() -> BenchmarkRun:
    return _with_flags(_benchmark("official", h5_per_world=6), set())


def test_ontology_split_cells_cover_both_groups_and_comparisons(
    run_with_ontology_flags: BenchmarkRun,
) -> None:
    cells = summarize(run_with_ontology_flags)["ontology_split"]
    assert {(c["group"], c["metric"], c["comparison"]) for c in cells} == {
        (g, m, k)
        for g in ("ontology_dependent", "other")
        for m in ("evidence_recall", "answer")
        for k in ("B_vs_A", "C_vs_B")
    }
    assert len(cells) == 8
    assert all(c["in_family"] is False and c["p"] is None and c["p_holm"] is None for c in cells)


def test_ontology_split_uses_the_flag_not_the_stratum(
    run_with_ontology_flags: BenchmarkRun,
) -> None:
    cells = summarize(run_with_ontology_flags)["ontology_split"]

    def cell(group: str) -> dict[str, Any]:
        return next(
            c
            for c in cells
            if c["group"] == group
            and c["metric"] == "evidence_recall"
            and c["comparison"] == "C_vs_B"
        )

    # L50 (H5) and L20 (H2) in two worlds; the other H2 questions are not flagged.
    assert (cell("ontology_dependent")["n"], cell("ontology_dependent")["clusters"]) == (4, 4)
    assert cell("ontology_dependent")["reason"] == "too_few"
    assert cell("other")["reason"] == "not_in_family"
    assert cell("other")["n"] == 2 * (6 * 3 + 3 + 6) - 4
    assert cell("other")["low"] <= cell("other")["mean"] <= cell("other")["high"]


def test_ontology_split_does_not_change_the_comparisons(
    run_with_ontology_flags: BenchmarkRun, same_run_all_flags_false: BenchmarkRun
) -> None:
    flagged, unflagged = summarize(run_with_ontology_flags), summarize(same_run_all_flags_false)
    assert flagged["comparisons"] == unflagged["comparisons"]
    assert flagged["headlines"] == unflagged["headlines"]
    assert all(c["n"] == 0 and c["mean"] is None for c in unflagged["ontology_split"][:4])


def test_instance_means_matches_the_observation(run_with_ontology_flags: BenchmarkRun) -> None:
    results = [r for world in run_with_ontology_flags.worlds for r in world.results]
    h3 = next(r for r in results if r.instance.stratum == "H3")
    # A's failed repeat is excluded: (1.0 + 0.5) / 2.
    assert instance_means(h3)["A"]["answer"] == pytest.approx(0.75)
    for r in results:
        means, observed = instance_means(r), observe(r).values
        for tag in r.scores:
            for metric in ("evidence_recall", "answer"):
                assert means[tag][metric] == observed[metric][tag][0]


def test_the_report_renders_the_ontology_split(run_with_ontology_flags: BenchmarkRun) -> None:
    report = render_report(run_with_ontology_flags)
    assert "## Ontology-dependent split" in report
    assert "| ontology_dependent | evidence_recall | C_vs_B | 4 | 4 |" in report


def test_a_result_reads_back_from_results_json(synthetic_run: BenchmarkRun) -> None:
    payload = json.loads(json.dumps(synthetic_run.to_payload()))
    written = [result for world in synthetic_run.worlds for result in world.results]
    read = [
        instance_result_from_payload(result)
        for world in payload["worlds"]
        for result in world["results"]
    ]
    assert read == written


# The Results screen's fixtures of a method v0.3 run (frontend/e2e/fixtures/
# results-v03-summary.json and results-v03-instances.json): this module's
# synthetic run through ``summarize`` and the API's own builders, so they are
# real output with test values. Rewrite them from backend/ with
#     uv run python -m tests.test_benchmark_report
# They are the writer's output byte for byte; frontend/.prettierignore leaves
# them alone.
V03_FIXTURES = Path(__file__).parents[2] / "frontend" / "e2e" / "fixtures"
V03_FIXTURE_RUN = "fixture-v03"
V03_FIXTURE_LABEL = "Fixture run (test values)"


def v03_fixture_texts(directory: Path) -> dict[str, str]:
    """Each v0.3 Results fixture's file name and text, byte for byte, as
    the API serves the synthetic run published under ``directory``."""
    run = _benchmark("official", h5_per_world=6, label=V03_FIXTURE_LABEL)
    run_dir = directory / V03_FIXTURE_RUN
    run_dir.mkdir()
    (run_dir / "results.json").write_text(json.dumps(run.to_payload()), encoding="utf-8")
    (run_dir / "summary.json").write_text(json.dumps(summarize(run)), encoding="utf-8")
    served = _summary_out(_published(directory, V03_FIXTURE_RUN))
    instances = _instances(directory, V03_FIXTURE_RUN)
    return {
        "results-v03-summary.json": json.dumps(served.model_dump(mode="json"), indent=2) + "\n",
        "results-v03-instances.json": json.dumps(
            [row.model_dump(mode="json") for row in instances], indent=2
        )
        + "\n",
    }


def test_the_v03_results_fixtures_are_the_writers_output(tmp_path: Path) -> None:
    for name, text in v03_fixture_texts(tmp_path).items():
        assert (V03_FIXTURES / name).read_text(encoding="utf-8") == text, name


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        for name, text in v03_fixture_texts(Path(directory)).items():
            (V03_FIXTURES / name).write_text(text, encoding="utf-8")
