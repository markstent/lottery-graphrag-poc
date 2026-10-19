"""Benchmark runner v2 (Phase 3 benchmark v2, Tasks 7 and 8): repeats,
per-repeat scoring, the judge, frozen-bank checks and the reproducibility
record.

Everything runs offline: the lab is the hashing lab over an in-memory
store, B and C walk the static SCN-007 neighbourhood instead of Neo4j, and
the bank is a two-instance frozen bank over the test corpus. The gateway
judge replies through a stub gateway.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from pathlib import Path
from typing import cast

import pytest
from app.config import from_env
from app.evaluation import runner as runner_module
from app.evaluation.bank import BANK_VERSION
from app.evaluation.checks import TokenCheck, answer_score, citation_metrics
from app.evaluation.claims import Claim
from app.evaluation.grounding import (
    BankInstance,
    FrozenBank,
    GroundingError,
    Unavailable,
)
from app.evaluation.judge import (
    JUDGE_PROMPT_VERSION,
    FakeJudge,
    GatewayJudge,
    JudgeItem,
    JudgeSettings,
    build_judge_prompt,
    judge_prompt_hash,
)
from app.evaluation.runner import (
    RUN_KINDS,
    SCORER_VERSION,
    SMOKE_LABEL,
    BenchmarkRun,
    BenchmarkRunner,
    RunScore,
)
from app.evaluation.scoring import classify_failure, evidence_score
from app.evidence import EvidenceChunk
from app.graph.config import GraphConfig
from app.models.gateway import CompletionRequest
from app.ontology import ONTOLOGY_VERSION
from app.retrieval.graph.lab import Lab, WiredGraphPipelines, bc_graph_settings, graph_pipelines
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.graph.resolution import StaticEntityResolver
from app.retrieval.standard.fusion import RRF_K
from app.retrieval.standard.generation import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    GenerationError,
    GenerationOutput,
)
from app.retrieval.standard.index import index_corpus
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION
from app.retrieval.standard.sparse import SparseVector
from app.retrieval.standard.vector_store import InMemoryVectorStore, SearchHit, VectorStore

from tests.conftest import build_lab_offline
from tests.test_graph_rag import build_corpus, record_corpus_chunk, resolved, scn007_adjacency
from tests.test_judge import GOOD_REPLY, stub_gateway

GRAPH = GraphConfig(uri="bolt://unused", user="unused", password="unused", database="unused")
MANIFEST = {"generator_version": "2.0.0", "profile": "tiny", "world_seed": 2026, "scenario_seed": 7}
INCIDENT = record_corpus_chunk(
    "incidents", "INC_S007_GR", "Incident INC_S007_GR in Greece: checkout failed."
)


class _Reader:
    def close(self) -> None:
        pass


def _offline_wiring(lab: Lab, graph_config: GraphConfig) -> WiredGraphPipelines:
    """B and C over the static SCN-007 neighbourhood: no Neo4j."""
    del graph_config
    pipelines = graph_pipelines(
        lab, scn007_adjacency(), StaticEntityResolver(resolved()), StaticEntityResolver(resolved())
    )
    return WiredGraphPipelines(reader=cast(GraphReader, _Reader()), pipelines=pipelines)


@pytest.fixture(autouse=True)
def offline_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner_module, "wired_pipelines", _offline_wiring)


class FlakyStore(InMemoryVectorStore):
    """Drops the best hit on every second search: retrieval that drifts."""

    def __init__(self) -> None:
        super().__init__()
        self.searches = 0

    def search(
        self,
        dense: list[float],
        sparse: SparseVector,
        limit: int,
        markets: object = None,
        kinds: object = None,
    ) -> list[SearchHit]:
        self.searches += 1
        hits = super().search(dense, sparse, limit, markets, kinds)  # type: ignore[arg-type]
        return hits[1:] if self.searches % 2 == 0 else hits


class FailingGenerator:
    """A gateway that always fails, as a GenerationError or as ``error``."""

    model_name = "failing-model"

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error or GenerationError("gateway down")

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        raise self.error


class ScriptedGenerator:
    """A non-fake generator with a fixed JSON reply."""

    model_name = "scripted-model"

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        return GenerationOutput(json.dumps({"verdict": "yes", "answer": "INC_S007_GR [1]."}), 1.0)


def indexed_lab(world_dir: Path, store: VectorStore | None = None, **overrides: object) -> Lab:
    """The offline lab over ``world_dir`` with the test corpus indexed and a
    current index manifest."""
    lab = build_lab_offline()
    values: dict[str, object] = {
        "settings": dataclasses.replace(lab.settings, dataset_dir=str(world_dir)),
        "store": store or InMemoryVectorStore(),
        "index_manifest": {"record_serialiser_version": RECORD_SERIALISER_VERSION},
        **overrides,
    }
    lab = dataclasses.replace(lab, **values)  # type: ignore[arg-type]
    index_corpus(lab.store, lab.embeddings, lab.sparse, [*build_corpus().values(), INCIDENT])
    return lab


def gateway_judge(
    raw: str = GOOD_REPLY,
    family: str | None = "gemma",
    calls: list[CompletionRequest] | None = None,
) -> GatewayJudge:
    """A gateway judge of another family than any generator here, replying ``raw``."""
    settings = JudgeSettings("litellm", "judge-model", family, None, 0.0)
    return GatewayJudge(settings, gateway=stub_gateway(raw, calls))


def with_family(lab: Lab, family: str) -> Lab:
    generation = dataclasses.replace(lab.settings.generation, model_family=family)
    return dataclasses.replace(
        lab, settings=dataclasses.replace(lab.settings, generation=generation)
    )


def _instance(question_id: str, text: str, carrier: str) -> BankInstance:
    return BankInstance(
        instance_id=f"{question_id}-2026-INC_S007_GR",
        question_id=question_id,
        stratum="H1",
        sub_stratum=None,
        ontology_dependent=False,
        world_seed=2026,
        anchor_id="INC_S007_GR",
        text=text,
        expected_answer="INC_S007_GR followed PLV_PAYMENTS_3.",
        checks=(TokenCheck("INC_S007_GR"),),
        claims=(Claim(f"{question_id}-c1", "a statement", frozenset({carrier})),),
    )


@pytest.fixture
def world_dir(tmp_path: Path) -> Path:
    (tmp_path / "_manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
    return tmp_path


@pytest.fixture
def frozen_bank(world_dir: Path) -> FrozenBank:
    manifest_hash = hashlib.sha256((world_dir / "_manifest.json").read_bytes()).hexdigest()
    return FrozenBank(
        bank_version=BANK_VERSION,
        world_seed=2026,
        world_manifest_hash=manifest_hash,
        record_serialiser_version=RECORD_SERIALISER_VERSION,
        ledger_hash="ledger-hash",
        instances=(
            _instance(
                "L05", "Why did checkout fail in Greece after INC_S007_GR?", "CHNK_S007_GR_00"
            ),
            _instance("L06", "Which release did INC_S007_GR follow?", "CHNK_S007_UK_00"),
        ),
        unavailable=(Unavailable("L22", "scenario not planted"),),
        bank_hash="bank-hash",
    )


@pytest.fixture
def bank_for_other_world(frozen_bank: FrozenBank) -> FrozenBank:
    return dataclasses.replace(frozen_bank, world_manifest_hash="0" * 64)


@pytest.fixture
def offline_lab(world_dir: Path) -> Lab:
    return indexed_lab(world_dir)


@pytest.fixture
def runner_smoke(offline_lab: Lab, frozen_bank: FrozenBank, world_dir: Path) -> BenchmarkRunner:
    return BenchmarkRunner(offline_lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=2)


@pytest.fixture
def runner_with_flaky_store(frozen_bank: FrozenBank, world_dir: Path) -> BenchmarkRunner:
    lab = indexed_lab(world_dir, FlakyStore())
    return BenchmarkRunner(
        lab, GRAPH, frozen_bank, world_dir, kind="sweep", repeats=2, judge=gateway_judge()
    )


@pytest.fixture
def runner_with_failing_generator(frozen_bank: FrozenBank, world_dir: Path) -> BenchmarkRunner:
    lab = indexed_lab(world_dir, generator=FailingGenerator())
    return BenchmarkRunner(
        lab, GRAPH, frozen_bank, world_dir, kind="sweep", repeats=2, judge=gateway_judge()
    )


# --- The brief's tests --------------------------------------------------------


def test_runner_refuses_a_bank_from_another_world(
    tmp_path: Path, offline_lab: Lab, bank_for_other_world: FrozenBank
) -> None:
    with pytest.raises(GroundingError, match="world manifest"):
        BenchmarkRunner(
            offline_lab, GRAPH, bank_for_other_world, world_dir=tmp_path, kind="smoke", repeats=1
        )


def test_each_repeat_is_recorded_and_scored(runner_smoke: BenchmarkRunner) -> None:
    world = runner_smoke.run()
    result = world.results[0]
    assert {tag: len(runs) for tag, runs in result.runs.items()} == {"A": 2, "B": 2, "C": 2}
    assert all(len(result.scores[tag]) == 2 for tag in ("A", "B", "C"))


def test_retrieval_must_not_change_between_repeats(
    runner_with_flaky_store: BenchmarkRunner,
) -> None:
    with pytest.raises(RuntimeError, match="not deterministic"):
        runner_with_flaky_store.run()


def test_a_generation_failure_is_recorded_not_fatal(
    runner_with_failing_generator: BenchmarkRunner,
) -> None:
    run = runner_with_failing_generator.run().results[0].runs["A"][0]
    assert run.generation_failed and run.answer == ""


def test_smoke_runs_are_labelled_and_official_runs_refuse_the_fake_generator(
    offline_lab: Lab, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    smoke = BenchmarkRunner(offline_lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1)
    assert smoke.label == SMOKE_LABEL
    with pytest.raises(ValueError, match="fake generator"):
        BenchmarkRunner(offline_lab, GRAPH, frozen_bank, world_dir, kind="official", repeats=3)


def test_reproducibility_record_names_the_bank_and_scorer(runner_smoke: BenchmarkRunner) -> None:
    payload = runner_smoke.record().to_payload()
    assert payload["bank_version"] == "2.0.0" and payload["scorer_version"] == "2.0.0"
    assert payload["repeats"] == 2


# --- Bank checks ---------------------------------------------------------------


def test_runner_refuses_a_bank_of_another_version(
    offline_lab: Lab, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    old = dataclasses.replace(frozen_bank, bank_version="1.0.0")
    with pytest.raises(GroundingError, match=r"bank version 1\.0\.0"):
        BenchmarkRunner(offline_lab, GRAPH, old, world_dir, kind="smoke", repeats=1)


def test_runner_refuses_a_world_without_a_manifest(tmp_path: Path, frozen_bank: FrozenBank) -> None:
    empty = tmp_path / "empty"
    with pytest.raises(GroundingError, match="world manifest"):
        BenchmarkRunner(indexed_lab(empty), GRAPH, frozen_bank, empty, kind="smoke", repeats=1)


def test_runner_refuses_a_lab_over_another_world(
    tmp_path: Path, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    """The lab's index must be built from the world the bank was grounded in."""
    other = tmp_path / "other-world"
    store = FlakyStore()
    lab = indexed_lab(other, store)
    with pytest.raises(GroundingError, match="dataset") as raised:
        BenchmarkRunner(lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1)
    assert str(other.resolve()) in str(raised.value)
    assert str(world_dir.resolve()) in str(raised.value)
    assert store.searches == 0


def test_the_lab_world_is_compared_as_resolved_paths(
    frozen_bank: FrozenBank, world_dir: Path
) -> None:
    lab = indexed_lab(world_dir / "." / ".." / world_dir.name)
    BenchmarkRunner(lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1)


@pytest.mark.parametrize("built_by", [None, "2.0.0"])
def test_runner_refuses_an_index_of_another_serialiser_before_any_question(
    frozen_bank: FrozenBank, world_dir: Path, built_by: str | None
) -> None:
    """The bank was frozen over record blocks of one serialiser; the lab's
    index must be built by the same one, or the claim carriers would not be
    the blocks the pipelines retrieve. Refused at construction, so no
    question runs."""
    manifest = None if built_by is None else {"record_serialiser_version": built_by}
    store = FlakyStore()
    lab = indexed_lab(world_dir, store, index_manifest=manifest)
    with pytest.raises(GroundingError, match="record serialiser"):
        BenchmarkRunner(lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1)
    assert store.searches == 0


# --- Run kinds -----------------------------------------------------------------


def test_run_kinds_and_their_rules(frozen_bank: FrozenBank, world_dir: Path) -> None:
    assert RUN_KINDS == ("smoke", "official", "sweep")
    fake, scripted = indexed_lab(world_dir), indexed_lab(world_dir, generator=ScriptedGenerator())
    with pytest.raises(ValueError, match="run kind"):
        BenchmarkRunner(fake, GRAPH, frozen_bank, world_dir, kind="trial", repeats=1)
    with pytest.raises(ValueError, match="repeats"):
        BenchmarkRunner(fake, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=0)
    with pytest.raises(ValueError, match="fake generator"):
        BenchmarkRunner(scripted, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1)
    with pytest.raises(ValueError, match="repeats"):
        BenchmarkRunner(scripted, GRAPH, frozen_bank, world_dir, kind="official", repeats=2)
    with pytest.raises(ValueError, match="model family"):
        BenchmarkRunner(
            scripted,
            GRAPH,
            frozen_bank,
            world_dir,
            kind="official",
            repeats=3,
            judge=gateway_judge(),
        )
    official = BenchmarkRunner(
        with_family(scripted, "qwen"),
        GRAPH,
        frozen_bank,
        world_dir,
        kind="official",
        repeats=3,
        judge=gateway_judge(),
    )
    assert official.label is None
    sweep = BenchmarkRunner(
        scripted, GRAPH, frozen_bank, world_dir, kind="sweep", repeats=1, judge=gateway_judge()
    )
    assert sweep.label is None


def test_unknown_pipelines_are_refused(
    offline_lab: Lab, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    with pytest.raises(ValueError, match="pipeline"):
        BenchmarkRunner(
            offline_lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1, pipelines=("D",)
        )


# --- What a run records ------------------------------------------------------------


def test_runs_record_the_shown_blocks_and_selected_carriers(
    runner_smoke: BenchmarkRunner,
) -> None:
    result = runner_smoke.run().results[0]
    a, b = result.runs["A"][0], result.runs["B"][0]
    # A shows the incident's record block: its carrier is the record id.
    assert "INC_S007_GR" in a.selected and "CHNK_S007_GR_00" in a.selected
    # The blocks are the prompt, in order, and carry the same items.
    assert tuple(block.carrier_id for block in a.blocks) == a.selected
    assert a.blocks[a.selected.index("CHNK_S007_GR_00")].title == "Incident Report: INC_S007_GR"
    assert all(block.text for block in a.blocks)
    # A resolves no entity; B and C resolve the anchor.
    assert (a.resolved_ids, a.seeded) == ((), False)
    assert (b.resolved_ids, b.seeded) == (("INC_S007_GR",), True)
    assert result.runs["C"][0].resolved_ids == ("INC_S007_GR",)
    assert a.answer.startswith("[fake-model]") and a.raw_text and a.verdict
    assert a.cited_blocks == (1,) and a.context_tokens > 0 and a.latency_ms >= 0
    assert [run.repeat for run in result.runs["A"]] == [0, 1]
    assert {run.pipeline for run in result.runs["C"]} == {"C"}


def test_every_repeat_is_scored_with_the_v2_scorers(runner_smoke: BenchmarkRunner) -> None:
    world = runner_smoke.run()
    for result in world.results:
        instance = result.instance
        for tag, runs in result.runs.items():
            for run, score in zip(runs, result.scores[tag], strict=True):
                assert score is not None
                answer = answer_score(instance.checks, run.verdict, run.answer)
                evidence = evidence_score(
                    instance.claims,
                    run.selected,
                    instance.anchor_id,
                    run.resolved_ids,
                    run.context_tokens,
                )
                citations = citation_metrics(
                    run.answer,
                    run.cited_blocks,
                    [frozenset({block.carrier_id}) for block in run.blocks],
                    instance.claims,
                )
                expected = RunScore(
                    answer, evidence, citations, classify_failure(answer, evidence, run.seeded)
                )
                assert dataclasses.replace(score, judge=None) == expected


def test_a_failed_repeat_has_no_score_and_the_run_continues(
    runner_with_failing_generator: BenchmarkRunner,
) -> None:
    world = runner_with_failing_generator.run()
    assert len(world.results) == 2
    for result in world.results:
        for tag in ("A", "B", "C"):
            assert [run.generation_failed for run in result.runs[tag]] == [True, True]
            assert result.scores[tag] == [None, None]
            run = result.runs[tag][0]
            assert (run.verdict, run.raw_text, run.cited_blocks) == ("", "", ())
            # Retrieval still ran: the selection the generator was handed is kept.
            assert run.selected and run.blocks


def test_any_other_pipeline_error_fails_the_run(frozen_bank: FrozenBank, world_dir: Path) -> None:
    lab = indexed_lab(world_dir, generator=FailingGenerator(RuntimeError("bug")))
    runner = BenchmarkRunner(
        lab, GRAPH, frozen_bank, world_dir, kind="sweep", repeats=1, judge=gateway_judge()
    )
    with pytest.raises(RuntimeError, match="bug"):
        runner.run()


def test_question_ids_limit_and_pipelines_select_the_work(
    offline_lab: Lab, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    runner = BenchmarkRunner(
        offline_lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1, pipelines=("A",)
    )
    world = runner.run(question_ids=["L06"])
    assert [r.instance.question_id for r in world.results] == ["L06"]
    assert set(world.results[0].runs) == {"A"}
    assert [r.instance.question_id for r in runner.run(limit=1).results] == ["L05"]
    with pytest.raises(KeyError):
        runner.run(question_ids=["L99"])


def test_world_run_carries_the_bank_identity(
    runner_smoke: BenchmarkRunner, frozen_bank: FrozenBank
) -> None:
    world = runner_smoke.run()
    assert (world.world_seed, world.bank_hash) == (2026, "bank-hash")
    assert world.unavailable == frozen_bank.unavailable


def test_world_run_carries_its_own_record(runner_smoke: BenchmarkRunner) -> None:
    world = runner_smoke.run()
    assert world.record is not None
    assert (world.record.world_seed, world.record.run_kind) == (2026, "smoke")
    payload = BenchmarkRun("smoke", SMOKE_LABEL, world.record, [world]).to_payload()
    assert payload["worlds"][0]["reproducibility"]["world_seed"] == 2026


def test_benchmark_run_payload_is_json(runner_smoke: BenchmarkRunner) -> None:
    run = BenchmarkRun(
        kind="smoke",
        label=runner_smoke.label,
        record=runner_smoke.record(),
        worlds=[runner_smoke.run()],
    )
    payload = json.loads(json.dumps(run.to_payload()))
    assert (payload["kind"], payload["label"]) == ("smoke", SMOKE_LABEL)
    assert payload["reproducibility"]["run_kind"] == "smoke"
    (world,) = payload["worlds"]
    assert world["unavailable"] == [{"question_id": "L22", "reason": "scenario not planted"}]
    first = world["results"][0]
    assert first["instance"]["instance_id"] == "L05-2026-INC_S007_GR"
    assert [run["repeat"] for run in first["runs"]["A"]] == [0, 1]
    assert first["runs"]["A"][0]["blocks"][0].keys() == {"carrier_id", "title", "text"}
    score = first["scores"]["B"][0]
    assert score.keys() == {"answer", "evidence", "citations", "failure_class", "judge"}
    assert "recall" in score["evidence"] and "accuracy" in score["citations"]


# --- Reproducibility record (Phase 2 fields kept, v2 fields added) ----------------


PHASE2_FIELDS = {
    "git_sha",
    "question_bank_version",
    "world_dir",
    "generator_version",
    "profile",
    "world_seed",
    "scenario_seed",
    "embedding_model",
    "embedding_dimensions",
    "sparse_model",
    "rrf_k",
    "record_serialiser_version",
    "generation_model",
    "generation_temperature",
    "max_tokens",
    "prompt_version",
    "reranker",
    "top_k",
    "context_budget_tokens",
    "context",
    "graph_limits",
    "ranking_weights",
    "reference_date",
    "excluded_labels",
    "ontology_version",
    "started_at",
}
V2_FIELDS = {
    "bank_version",
    "bank_hash",
    "scorer_version",
    "prompt_hash",
    "relationship_types_b",
    "relationship_types_c",
    "dedupe_threshold",
    "generation_quantisation",
    "generation_model_family",
    "repeats",
    "run_kind",
    "judge_model",
    "judge_model_family",
    "judge_prompt_version",
    "judge_prompt_hash",
}


def test_reproducibility_payload_carries_every_field(
    runner_smoke: BenchmarkRunner, offline_lab: Lab, world_dir: Path
) -> None:
    """Every record field reaches the stored payload (docs/05 section 11)."""
    record = runner_smoke.record()
    payload = record.to_payload()
    assert set(payload) == {field.name for field in dataclasses.fields(record)}
    assert set(payload) == PHASE2_FIELDS | V2_FIELDS
    settings = offline_lab.settings
    settings_b, settings_c = bc_graph_settings(settings)
    assert payload["question_bank_version"] == BANK_VERSION
    assert payload["world_dir"] == world_dir.as_posix()
    assert (payload["generator_version"], payload["profile"]) == ("2.0.0", "tiny")
    assert (payload["world_seed"], payload["scenario_seed"]) == (2026, 7)
    assert (payload["embedding_model"], payload["embedding_dimensions"]) == ("hashing-256", 256)
    assert payload["sparse_model"] == offline_lab.sparse.model_name
    assert payload["rrf_k"] == RRF_K
    assert payload["generation_model"] == "fake-answer-v1"
    assert payload["generation_temperature"] == 0.0
    assert payload["max_tokens"] == settings.generation.max_tokens
    assert payload["prompt_version"] == PROMPT_VERSION
    assert payload["prompt_hash"] == hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()
    assert payload["reranker"] == offline_lab.reranker.model_name
    assert payload["top_k"] == settings.top_k
    assert payload["context_budget_tokens"] == settings.context.budget_tokens
    assert payload["dedupe_threshold"] == settings.context.dedupe_threshold
    assert payload["reference_date"] == settings.graph.reference_date.isoformat()
    assert payload["ranking_weights"] == dataclasses.asdict(settings.graph.ranking)
    assert payload["excluded_labels"] == ["Document"]
    assert payload["ontology_version"] == ONTOLOGY_VERSION
    assert payload["relationship_types_b"] == list(settings_b.graph.relationship_types)
    assert payload["relationship_types_c"] == list(settings_c.graph.relationship_types)
    assert payload["bank_hash"] == "bank-hash" and payload["scorer_version"] == SCORER_VERSION
    assert (payload["run_kind"], payload["repeats"]) == ("smoke", 2)
    assert payload["generation_model_family"] is None
    assert payload["generation_quantisation"] is None
    assert (payload["judge_model"], payload["judge_model_family"]) == ("fake-judge-v1", None)
    assert payload["judge_prompt_version"] == JUDGE_PROMPT_VERSION
    assert payload["judge_prompt_hash"] == judge_prompt_hash()
    json.dumps(payload)  # stored as JSON


def test_record_reads_the_serialiser_from_the_index_manifest(
    frozen_bank: FrozenBank, world_dir: Path
) -> None:
    """The serialiser that built the index in use, never the code constant."""
    lab = indexed_lab(world_dir, index_manifest={"record_serialiser_version": "from-the-manifest"})
    bank = dataclasses.replace(frozen_bank, record_serialiser_version="from-the-manifest")
    runner = BenchmarkRunner(lab, GRAPH, bank, world_dir, kind="smoke", repeats=1)
    assert runner.record().record_serialiser_version == "from-the-manifest"


def test_generation_family_and_quantisation_come_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GENERATION_MODEL_FAMILY", "qwen")
    monkeypatch.setenv("GENERATION_MODEL_QUANTISATION", "q4_K_M")
    generation = from_env().generation
    assert (generation.model_family, generation.quantisation) == ("qwen", "q4_K_M")
    monkeypatch.delenv("GENERATION_MODEL_FAMILY")
    monkeypatch.delenv("GENERATION_MODEL_QUANTISATION")
    generation = from_env().generation
    assert (generation.model_family, generation.quantisation) == (None, None)


# --- The judge (Task 8) ------------------------------------------------------------


def test_a_smoke_run_judges_every_repeat_with_the_fake_judge(
    runner_smoke: BenchmarkRunner,
) -> None:
    assert isinstance(runner_smoke.judge, FakeJudge)
    for result in runner_smoke.run().results:
        for scores in result.scores.values():
            for score in scores:
                assert score is not None and score.judge is not None
                assert score.judge.model == "fake-judge-v1" and score.judge.scores is not None


def test_the_judge_sees_each_blinded_repeat_and_nothing_else(
    offline_lab: Lab, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    calls: list[CompletionRequest] = []
    judge = gateway_judge(calls=calls)
    runner = BenchmarkRunner(
        offline_lab, GRAPH, frozen_bank, world_dir, kind="sweep", repeats=2, judge=judge
    )
    world = runner.run()
    expected = [
        build_judge_prompt(
            JudgeItem(
                question=result.instance.text,
                expected_answer=result.instance.expected_answer,
                claim_statements=tuple(c.statement for c in result.instance.claims),
                blocks=run.blocks,
                answer=run.answer,
                cited_blocks=run.cited_blocks,
                blind_seed=f"{result.instance.instance_id}:{tag}:{run.repeat}",
            )
        )
        for result in world.results
        for tag, runs in result.runs.items()
        for run in runs
    ]
    assert [(call.system, call.user) for call in calls] == expected
    verdicts = [s.judge for r in world.results for scores in r.scores.values() for s in scores if s]
    assert len(verdicts) == len(calls) == 2 * 3 * 2
    assert all(
        v is not None and v.scores is not None and v.model == "judge-model" for v in verdicts
    )


def test_a_judge_failure_is_recorded_beside_the_deterministic_scores(
    offline_lab: Lab, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    runner = BenchmarkRunner(
        offline_lab,
        GRAPH,
        frozen_bank,
        world_dir,
        kind="sweep",
        repeats=1,
        judge=gateway_judge("not json"),
    )
    for result in runner.run().results:
        for scores in result.scores.values():
            (score,) = scores
            assert score is not None and score.judge is not None
            assert score.judge.scores is None and score.judge.failure
            assert score.evidence.claims_total == 1


def test_failed_repeats_are_not_judged(frozen_bank: FrozenBank, world_dir: Path) -> None:
    calls: list[CompletionRequest] = []
    lab = indexed_lab(world_dir, generator=FailingGenerator())
    runner = BenchmarkRunner(
        lab,
        GRAPH,
        frozen_bank,
        world_dir,
        kind="sweep",
        repeats=1,
        judge=gateway_judge(calls=calls),
    )
    runner.run()
    assert calls == []


def test_each_run_kind_takes_its_judge(
    monkeypatch: pytest.MonkeyPatch, frozen_bank: FrozenBank, world_dir: Path
) -> None:
    fake = indexed_lab(world_dir)
    scripted = with_family(indexed_lab(world_dir, generator=ScriptedGenerator()), "qwen")
    with pytest.raises(ValueError, match="fake judge"):
        BenchmarkRunner(
            fake, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1, judge=gateway_judge()
        )
    for kind, repeats in (("sweep", 1), ("official", 3)):
        with pytest.raises(ValueError, match="gateway judge"):
            BenchmarkRunner(
                scripted,
                GRAPH,
                frozen_bank,
                world_dir,
                kind=kind,
                repeats=repeats,
                judge=FakeJudge(),
            )
    # Without an explicit judge a sweep reads the judge settings from the environment.
    monkeypatch.setenv("JUDGE_PROVIDER", "fake")
    with pytest.raises(ValueError, match="JUDGE_PROVIDER"):
        BenchmarkRunner(scripted, GRAPH, frozen_bank, world_dir, kind="sweep", repeats=1)
    monkeypatch.setenv("JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("JUDGE_MODEL", "ollama/gemma4:31b")
    monkeypatch.setenv("JUDGE_MODEL_FAMILY", "gemma")
    sweep = BenchmarkRunner(scripted, GRAPH, frozen_bank, world_dir, kind="sweep", repeats=1)
    assert isinstance(sweep.judge, GatewayJudge) and sweep.judge.model_name == "ollama/gemma4:31b"


@pytest.mark.parametrize("judge_family", [None, "QWEN"])
def test_an_official_run_needs_a_judge_of_another_family(
    frozen_bank: FrozenBank, world_dir: Path, judge_family: str | None
) -> None:
    lab = with_family(indexed_lab(world_dir, generator=ScriptedGenerator()), "qwen")
    with pytest.raises(ValueError, match="family"):
        BenchmarkRunner(
            lab,
            GRAPH,
            frozen_bank,
            world_dir,
            kind="official",
            repeats=3,
            judge=gateway_judge(family=judge_family),
        )


def test_the_record_names_the_judge(frozen_bank: FrozenBank, world_dir: Path) -> None:
    lab = with_family(indexed_lab(world_dir, generator=ScriptedGenerator()), "qwen")
    runner = BenchmarkRunner(
        lab, GRAPH, frozen_bank, world_dir, kind="official", repeats=3, judge=gateway_judge()
    )
    payload = runner.record().to_payload()
    assert (payload["judge_model"], payload["judge_model_family"]) == ("judge-model", "gemma")
    assert payload["judge_prompt_version"] == JUDGE_PROMPT_VERSION
    assert payload["judge_prompt_hash"] == judge_prompt_hash()
