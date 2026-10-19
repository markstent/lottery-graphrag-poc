"""Benchmark runner v2 (docs/05-benchmark-spec.md; Phase 3 benchmark v2).

Runs the instances of one frozen bank through pipelines A, B and C against
the world the bank was grounded in, ``repeats`` times each, and scores every
repeat deterministically: answer checks, evidence over discoveries,
citation metrics and the failure class. Beside those scores the blinded
judge scores every successful repeat: the fake judge in smoke runs, a
gateway judge in sweep and official runs (of another model family than the
generator in an official run).

The runner refuses, before any question runs, a lab over another world
than the bank's, a bank grounded in another world, by another bank version,
or over record blocks of another serialiser than the lab's index.
Retrieval must select the same carriers in every repeat; only generation
may vary. A gateway failure in one repeat is recorded and the run
continues; any other error fails the run.

Evaluator-only (ADR-008): retrieval code never imports this package, and the
pipelines see the question text alone.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import subprocess
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.evaluation.bank import BANK_VERSION, question_by_id
from app.evaluation.checks import CitationMetrics, answer_score, citation_metrics
from app.evaluation.claims import selection_carrier
from app.evaluation.grounding import BankInstance, FrozenBank, GroundingError, Unavailable
from app.evaluation.judge import (
    JUDGE_PROMPT_VERSION,
    FakeJudge,
    GatewayJudge,
    Judge,
    JudgeItem,
    JudgeVerdict,
    check_families,
    judge_prompt_hash,
    judge_settings_from_env,
)
from app.evaluation.scoring import EvidenceScore, classify_failure, evidence_score
from app.events import GRAPH_ENTITY_RESOLVED
from app.evidence import EvidenceChunk
from app.graph.config import GraphConfig
from app.ontology import ONTOLOGY_VERSION
from app.retrieval.graph.lab import Lab, bc_graph_settings, wired_pipelines
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.standard.context import estimate_tokens
from app.retrieval.standard.fusion import RRF_K
from app.retrieval.standard.generation import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    AnswerGenerator,
    FakeAnswerGenerator,
    GenerationError,
    GenerationOutput,
)
from app.retrieval.standard.pipeline import StandardRagPipeline

RUN_KINDS = ("smoke", "official", "sweep")
SMOKE_LABEL = "scorer smoke test"
SCORER_VERSION = "2.0.0"
PIPELINES = ("A", "B", "C")
# An official result reports repeat variance, which needs at least three repeats.
OFFICIAL_MIN_REPEATS = 3
WORLD_MANIFEST = "_manifest.json"

REPO_ROOT = Path(__file__).resolve().parents[3]


def _git_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


@dataclass(frozen=True, slots=True)
class ReproducibilityRecord:
    """The docs/05 section 11 provenance block stored with every run."""

    git_sha: str
    question_bank_version: str
    world_dir: str
    generator_version: str
    profile: str
    world_seed: int | None
    scenario_seed: int | None
    embedding_model: str
    embedding_dimensions: int
    sparse_model: str
    rrf_k: int
    # From the manifest of the index the lab loaded; None when it started empty.
    record_serialiser_version: str | None
    generation_model: str
    generation_temperature: float
    max_tokens: int
    prompt_version: str
    reranker: str
    top_k: int
    context_budget_tokens: int
    context: dict[str, Any]
    graph_limits: dict[str, Any]
    ranking_weights: dict[str, float]
    reference_date: str
    excluded_labels: list[str]
    ontology_version: str
    started_at: str
    # Benchmark v2.
    bank_version: str
    bank_hash: str
    scorer_version: str
    prompt_hash: str
    relationship_types_b: list[str]
    relationship_types_c: list[str]
    dedupe_threshold: float
    generation_quantisation: str | None
    generation_model_family: str | None
    repeats: int
    run_kind: str
    judge_model: str | None
    judge_model_family: str | None
    judge_prompt_version: str | None
    judge_prompt_hash: str | None

    def to_payload(self) -> dict[str, Any]:
        """Every field, JSON-ready."""
        return dataclasses.asdict(self)


@dataclass(frozen=True, slots=True)
class ShownBlock:
    """One context block the generator was shown, with the carrier it is."""

    carrier_id: str
    title: str
    text: str


@dataclass(frozen=True, slots=True)
class PipelineRun:
    """One repeat of one pipeline on one instance.

    ``selected`` holds the carriers of the selected evidence in selection
    order and ``blocks`` the same items as the prompt numbered them.
    ``seeded`` says the pipeline has an entity-resolution stage (B and C).
    """

    pipeline: str
    repeat: int
    verdict: str
    answer: str
    raw_text: str
    cited_blocks: tuple[int, ...]
    blocks: tuple[ShownBlock, ...]
    selected: tuple[str, ...]
    resolved_ids: tuple[str, ...]
    seeded: bool
    context_tokens: int
    latency_ms: float
    generation_failed: bool

    def to_payload(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


@dataclass(frozen=True, slots=True)
class RunScore:
    """The deterministic scores of one successful repeat, and its judgement."""

    answer: float | None
    evidence: EvidenceScore
    citations: CitationMetrics
    failure_class: str | None
    judge: JudgeVerdict | None = None

    def to_payload(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


@dataclass(frozen=True, slots=True)
class InstanceResult:
    """Every repeat of every pipeline on one instance; a repeat whose
    generation failed has no score (None at its index)."""

    instance: BankInstance
    runs: dict[str, list[PipelineRun]]
    scores: dict[str, list[RunScore | None]]


@dataclass(frozen=True, slots=True)
class WorldRun:
    """One world's results under one frozen bank, with the record of the
    runner that produced them (None only for hand-built runs)."""

    world_seed: int
    bank_hash: str
    results: list[InstanceResult]
    unavailable: tuple[Unavailable, ...]
    record: ReproducibilityRecord | None = None


@dataclass(frozen=True, slots=True)
class BenchmarkRun:
    """A complete run: its kind, its label, its record and every world.

    Over several worlds the run record is the first world's; each world
    keeps its own record (world, seed, bank and start time differ)."""

    kind: str
    label: str | None
    record: ReproducibilityRecord
    worlds: list[WorldRun]

    def to_payload(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "label": self.label,
            "reproducibility": self.record.to_payload(),
            "worlds": [
                {
                    "world_seed": world.world_seed,
                    "bank_hash": world.bank_hash,
                    "unavailable": [dataclasses.asdict(u) for u in world.unavailable],
                    "reproducibility": None if world.record is None else world.record.to_payload(),
                    "results": [
                        {
                            "instance": result.instance.to_payload(),
                            "runs": {
                                tag: [run.to_payload() for run in runs]
                                for tag, runs in result.runs.items()
                            },
                            "scores": {
                                tag: [None if s is None else s.to_payload() for s in scores]
                                for tag, scores in result.scores.items()
                            },
                        }
                        for result in world.results
                    ],
                }
                for world in self.worlds
            ],
        }


class _ShownContext:
    """The lab's generator, keeping the blocks of the latest prompt.

    The pipelines hand the generator their selected evidence in prompt
    order, whatever its kind; this is the one place the runner sees that
    list, texts included, even when the gateway then fails.
    """

    def __init__(self, generator: AnswerGenerator) -> None:
        self.generator = generator
        self.model_name = generator.model_name
        self.contexts: list[EvidenceChunk] = []

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        self.contexts = list(contexts)
        return self.generator.generate(question, contexts)


class BenchmarkRunner:
    """Run one frozen bank through the pipelines and score every repeat."""

    def __init__(
        self,
        lab: Lab,
        graph_config: GraphConfig,
        bank: FrozenBank,
        world_dir: Path,
        kind: str,
        repeats: int,
        pipelines: tuple[str, ...] = PIPELINES,
        judge: Judge | None = None,
    ) -> None:
        """``judge`` defaults to the fake judge for a smoke run and to a
        gateway judge from the JUDGE_* environment otherwise."""
        _check_run(lab, kind, repeats, pipelines)
        self.judge = _check_judge(lab, kind, judge)
        self.world_manifest = _check_bank(bank, world_dir, lab)
        self.lab = lab
        self.graph_config = graph_config
        self.bank = bank
        self.world_dir = world_dir
        self.kind = kind
        self.label = SMOKE_LABEL if kind == "smoke" else None
        self.repeats = repeats
        self.pipelines = pipelines
        self.started_at = datetime.now(UTC).isoformat(timespec="seconds")
        self._shown = _ShownContext(lab.generator)
        # Every pipeline shares the one recording generator, as they share the lab's.
        self._run_lab = dataclasses.replace(lab, generator=self._shown)

    def run(self, question_ids: Sequence[str] | None = None, limit: int | None = None) -> WorldRun:
        """Run the bank's instances in bank order, optionally only those of
        ``question_ids`` (unknown ids raise ``KeyError``) and at most ``limit``."""
        instances = list(self.bank.instances)
        unavailable = self.bank.unavailable
        if question_ids is not None:
            wanted = {question_by_id(question_id).question_id for question_id in question_ids}
            instances = [i for i in instances if i.question_id in wanted]
            unavailable = tuple(u for u in unavailable if u.question_id in wanted)
        if limit is not None:
            instances = instances[:limit]

        wired = None
        if set(self.pipelines) & {"B", "C"}:
            wired = wired_pipelines(self._run_lab, self.graph_config)
        try:
            available: dict[str, StandardRagPipeline | GraphRagPipeline] = {
                "A": self._run_lab.pipeline_a()
            }
            if wired is not None:
                available.update(wired.pipelines)
            pipelines = {tag: available[tag] for tag in self.pipelines}
            results = [self._run_instance(instance, pipelines) for instance in instances]
        finally:
            if wired is not None:
                wired.reader.close()
        return WorldRun(
            self.bank.world_seed, self.bank.bank_hash, results, unavailable, self.record()
        )

    def record(self) -> ReproducibilityRecord:
        settings = self.lab.settings
        settings_b, settings_c = bc_graph_settings(settings)
        manifest = self.world_manifest
        return ReproducibilityRecord(
            git_sha=_git_sha(),
            question_bank_version=BANK_VERSION,
            world_dir=self.world_dir.as_posix(),
            generator_version=str(manifest.get("generator_version", "unknown")),
            profile=str(manifest.get("profile", "unknown")),
            world_seed=manifest.get("world_seed"),
            scenario_seed=manifest.get("scenario_seed"),
            embedding_model=self.lab.embeddings.model_name,
            embedding_dimensions=self.lab.embeddings.dimensions,
            sparse_model=self.lab.sparse.model_name,
            rrf_k=RRF_K,
            record_serialiser_version=self.lab.record_serialiser_version,
            generation_model=self.lab.generator.model_name,
            generation_temperature=settings.generation.temperature,
            max_tokens=settings.generation.max_tokens,
            prompt_version=PROMPT_VERSION,
            reranker=self.lab.reranker.model_name,
            top_k=settings.top_k,
            context_budget_tokens=settings.context.budget_tokens,
            context={
                "dedupe_threshold": settings.context.dedupe_threshold,
                "evidence_slots": settings.context.evidence_slots,
            },
            graph_limits={
                "depth": settings.graph.max_depth,
                "nodes_per_hop": settings.graph.max_nodes_per_hop,
                "edges_per_node_type": settings.graph.max_edges_per_node_type,
                "total_nodes": settings.graph.max_total_nodes,
                "relationship_types": len(settings.graph.relationship_types),
            },
            ranking_weights=dataclasses.asdict(settings.graph.ranking),
            reference_date=settings.graph.reference_date.isoformat(),
            excluded_labels=list(settings.graph.excluded_labels),
            ontology_version=ONTOLOGY_VERSION,
            started_at=self.started_at,
            bank_version=self.bank.bank_version,
            bank_hash=self.bank.bank_hash,
            scorer_version=SCORER_VERSION,
            prompt_hash=hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest(),
            relationship_types_b=list(settings_b.graph.relationship_types),
            relationship_types_c=list(settings_c.graph.relationship_types),
            dedupe_threshold=settings.context.dedupe_threshold,
            generation_quantisation=settings.generation.quantisation,
            generation_model_family=settings.generation.model_family,
            repeats=self.repeats,
            run_kind=self.kind,
            judge_model=self.judge.model_name,
            judge_model_family=self.judge.model_family,
            judge_prompt_version=JUDGE_PROMPT_VERSION,
            judge_prompt_hash=judge_prompt_hash(),
        )

    def _run_instance(
        self,
        instance: BankInstance,
        pipelines: dict[str, StandardRagPipeline | GraphRagPipeline],
    ) -> InstanceResult:
        runs: dict[str, list[PipelineRun]] = {}
        scores: dict[str, list[RunScore | None]] = {}
        for tag, pipeline in pipelines.items():
            repeats: list[PipelineRun] = []
            for repeat in range(self.repeats):
                run = self._execute(tag, pipeline, repeat, instance.text)
                if repeats and run.selected != repeats[0].selected:
                    raise RuntimeError(
                        f"retrieval is not deterministic: {instance.instance_id} pipeline "
                        f"{tag} selected {list(run.selected)} in repeat {repeat} but "
                        f"{list(repeats[0].selected)} in repeat 0"
                    )
                repeats.append(run)
            runs[tag] = repeats
            scores[tag] = [
                None if r.generation_failed else _score(instance, r, self._judge(instance, r))
                for r in repeats
            ]
        return InstanceResult(instance=instance, runs=runs, scores=scores)

    def _judge(self, instance: BankInstance, run: PipelineRun) -> JudgeVerdict:
        """Judge one successful repeat; the seed blinds the block order."""
        return self.judge.judge(
            JudgeItem(
                question=instance.text,
                expected_answer=instance.expected_answer,
                claim_statements=tuple(claim.statement for claim in instance.claims),
                blocks=run.blocks,
                answer=run.answer,
                cited_blocks=run.cited_blocks,
                blind_seed=f"{instance.instance_id}:{run.pipeline}:{run.repeat}",
            )
        )

    def _execute(
        self,
        tag: str,
        pipeline: StandardRagPipeline | GraphRagPipeline,
        repeat: int,
        question: str,
    ) -> PipelineRun:
        """Run one repeat; only a ``GenerationError`` is contained.

        The gateway is an external dependency where one flaky call must not
        destroy an official run, so its failure is recorded. Anything else
        (Neo4j down, a bug) fails loudly.
        """
        pipeline.events.clear()
        self._shown.contexts = []
        started = time.perf_counter()
        try:
            answer = pipeline.run(question).answer
        except GenerationError:
            answer = None
        latency_ms = (time.perf_counter() - started) * 1000
        contexts = self._shown.contexts
        blocks = tuple(
            ShownBlock(selection_carrier(c.kind, c.chunk_id, c.document_id), c.title, c.text)
            for c in contexts
        )
        resolved = tuple(
            str(event.payload["entity_id"])
            for event in pipeline.events
            if event.event_type == GRAPH_ENTITY_RESOLVED
        )
        return PipelineRun(
            pipeline=tag,
            repeat=repeat,
            verdict="" if answer is None else answer.verdict,
            answer="" if answer is None else answer.text,
            raw_text="" if answer is None else answer.raw_text,
            cited_blocks=() if answer is None else tuple(answer.cited_blocks),
            blocks=blocks,
            selected=tuple(block.carrier_id for block in blocks),
            resolved_ids=resolved,
            seeded=isinstance(pipeline, GraphRagPipeline),
            context_tokens=(
                sum(estimate_tokens(c.text) for c in contexts)
                if answer is None
                else answer.context_tokens
            ),
            latency_ms=latency_ms,
            generation_failed=answer is None,
        )


def _score(instance: BankInstance, run: PipelineRun, verdict: JudgeVerdict) -> RunScore:
    answer = answer_score(instance.checks, run.verdict, run.answer)
    evidence = evidence_score(
        instance.claims, run.selected, instance.anchor_id, run.resolved_ids, run.context_tokens
    )
    citations = citation_metrics(
        run.answer,
        run.cited_blocks,
        [frozenset({block.carrier_id}) for block in run.blocks],
        instance.claims,
    )
    return RunScore(
        answer, evidence, citations, classify_failure(answer, evidence, run.seeded), verdict
    )


def _check_run(lab: Lab, kind: str, repeats: int, pipelines: Sequence[str]) -> None:
    """Refuse a run whose kind, repeats, pipelines or generator do not fit."""
    if kind not in RUN_KINDS:
        raise ValueError(f"unknown run kind {kind!r}; expected one of {RUN_KINDS}")
    if repeats < 1:
        raise ValueError(f"repeats must be at least 1, got {repeats}")
    unknown = [tag for tag in pipelines if tag not in PIPELINES]
    if unknown or not pipelines:
        raise ValueError(f"unknown pipelines {unknown}; expected some of {PIPELINES}")
    fake = isinstance(lab.generator, FakeAnswerGenerator)
    if kind == "smoke" and not fake:
        raise ValueError("a smoke run requires the fake generator")
    if kind == "official":
        if fake:
            raise ValueError("an official run refuses the fake generator")
        if repeats < OFFICIAL_MIN_REPEATS:
            raise ValueError(
                f"an official run needs at least {OFFICIAL_MIN_REPEATS} repeats, got {repeats}"
            )
        if not lab.settings.generation.model_family:
            raise ValueError(
                "an official run requires the generation model family (GENERATION_MODEL_FAMILY)"
            )


def _check_judge(lab: Lab, kind: str, judge: Judge | None) -> Judge:
    """The judge of this run kind: the fake judge for smoke, a gateway judge
    otherwise, of another model family than the generator when official."""
    if judge is None:
        judge = FakeJudge() if kind == "smoke" else GatewayJudge(judge_settings_from_env())
    fake = isinstance(judge, FakeJudge)
    if kind == "smoke" and not fake:
        raise ValueError("a smoke run requires the fake judge")
    if kind != "smoke" and fake:
        raise ValueError(f"a {kind} run requires a gateway judge, not the fake judge")
    if kind == "official":
        check_families(lab.settings.generation.model_family, judge.model_family)
    return judge


def _check_bank(bank: FrozenBank, world_dir: Path, lab: Lab) -> dict[str, Any]:
    """Refuse a bank this world and lab cannot score; return the world manifest."""
    dataset_dir = Path(lab.settings.dataset_dir).resolve()
    if dataset_dir != world_dir.resolve():
        raise GroundingError(
            f"the lab's dataset directory {dataset_dir} is not the world directory "
            f"{world_dir.resolve()}; build the lab over the world the bank was grounded in"
        )
    path = world_dir / WORLD_MANIFEST
    if not path.exists():
        raise GroundingError(f"world manifest {path} is missing")
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if bank.world_manifest_hash != actual:
        raise GroundingError(
            f"the frozen bank was grounded in a world with manifest hash "
            f"{bank.world_manifest_hash}, but the world manifest of {world_dir} hashes to "
            f"{actual}; ground the bank in this world"
        )
    if bank.bank_version != BANK_VERSION:
        raise GroundingError(
            f"the frozen bank has bank version {bank.bank_version}, the code has "
            f"{BANK_VERSION}; ground the bank again"
        )
    built_by = lab.record_serialiser_version
    if bank.record_serialiser_version != built_by:
        raise GroundingError(
            f"the frozen bank was grounded over record serialiser "
            f"{bank.record_serialiser_version}, but the lab's index was built by record "
            f"serialiser {built_by or 'unknown (no index manifest)'}; rebuild the index"
        )
    manifest: dict[str, Any] = json.loads(data)
    return manifest
