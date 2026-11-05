"""Benchmark runner v2 (docs/reference/05-benchmark-spec.md; Phase 3 benchmark v2).

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
import logging
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import (
    LABEL_VERSION,
    METHOD_VERSION,
    PROMPT_EXTRAS,
    REPO_ROOT,
    SELECTION_RULE,
    GraphConfig,
    RetrievalSettings,
    judge_settings_from_env,
)
from app.evaluation.bank import BANK_VERSION
from app.evaluation.checks import (
    SCORER_VERSION,
    CitationMetrics,
    GroundednessScore,
    answer_score,
    citation_metrics,
    groundedness,
)
from app.evaluation.claims import selection_carrier
from app.evaluation.grounding import (
    BankInstance,
    FrozenBank,
    GroundingError,
    Unavailable,
    instance_from_payload,
)
from app.evaluation.judge import (
    JUDGE_PROMPT_VERSION,
    FakeJudge,
    GatewayJudge,
    Judge,
    JudgeItem,
    JudgeScores,
    JudgeVerdict,
    check_families,
    judge_prompt_hash,
)
from app.evaluation.scoring import EvidenceScore, classify_failure, evidence_score
from app.events import GRAPH_ENTITY_RESOLVED
from app.evidence import AnswerForm, EvidenceChunk
from app.lab import Lab, bc_graph_settings, wired_pipelines
from app.observability.logging import run_context, stage_timer
from app.ontology import ONTOLOGY_VERSION
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.standard.context import block_tokens
from app.retrieval.standard.fusion import RRF_K
from app.retrieval.standard.generation import (
    ANSWER_PARSER_VERSION,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    AnswerGenerator,
    FakeAnswerGenerator,
    GenerationError,
    GenerationOutput,
    context_block,
)
from app.retrieval.standard.pipeline import StandardRagPipeline
from app.retrieval.standard.records import RECORD_FACTS_VERSION

# A dev run (D-091) is a development run on the presentation world: real
# generator and judge, any repeats, never a result.
RUN_KINDS = ("smoke", "official", "sweep", "dev")
SMOKE_LABEL = "scorer smoke test"
DEV_LABEL = "development run on seed 2026, not a result"
# The label a run of each kind always carries; other kinds carry none of their own.
KIND_LABELS = {"smoke": SMOKE_LABEL, "dev": DEV_LABEL}
PIPELINES = ("A", "B", "C")
# An official run asks each question once (D-097): at temperature 0 with
# deterministic retrieval the repeats of v0.2.0 gave word-for-word identical
# answers. --repeats N asks each question N times.
OFFICIAL_MIN_REPEATS = 1
WORLD_MANIFEST = "_manifest.json"

logger = logging.getLogger(__name__)


def _git(*args: str) -> str | None:
    """The output of one git command in the repository; None when git is unavailable."""
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, cwd=REPO_ROOT, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None


def git_sha() -> str:
    output = _git("rev-parse", "HEAD")
    return "unknown" if output is None else output.strip()


def git_dirty() -> bool | None:
    """Whether the checkout has uncommitted changes; None when git is unavailable."""
    output = _git("status", "--porcelain")
    return None if output is None else bool(output.strip())


def require_clean_checkout(kind: str) -> None:
    """Refuse an official run, over the whole bank or part of it (the dry
    run, the official settings rehearsal), unless the checkout is known to be
    clean (D-091): uncommitted code must never reach an official result, and
    a checkout git cannot read is not known to be clean. Other kinds only
    record git_dirty."""
    if kind == "official" and git_dirty() is not False:
        raise ValueError(
            "an official run starts or resumes only from a clean checkout, and this one has "
            "uncommitted changes (or git is unavailable); commit them first"
        )


def settings_fields(
    settings: RetrievalSettings, judge: Judge, kind: str, repeats: int
) -> dict[str, Any]:
    """The reproducibility fields that the environment, the configuration, the
    code and git fix, with no world or lab built.

    :meth:`BenchmarkRunner.record` builds its record from these, and a resumed
    run compares them with its kept worlds before any world is prepared, so
    the two cannot drift apart.
    """
    settings_b, settings_c = bc_graph_settings(settings)
    return {
        "git_sha": git_sha(),
        "git_dirty": git_dirty(),
        "question_bank_version": BANK_VERSION,
        "rrf_k": RRF_K,
        "generation_model": settings.generation.model,
        "generation_temperature": settings.generation.temperature,
        "max_tokens": settings.generation.max_tokens,
        "prompt_version": PROMPT_VERSION,
        "answer_parser_version": ANSWER_PARSER_VERSION,
        "top_k": settings.top_k,
        "context_budget_tokens": settings.context.budget_tokens,
        "context": {"dedupe_threshold": settings.context.dedupe_threshold},
        "graph_limits": {
            "depth": settings.graph.max_depth,
            "nodes_per_hop": settings.graph.max_nodes_per_hop,
            "edges_per_node_type": settings.graph.max_edges_per_node_type,
            "total_nodes": settings.graph.max_total_nodes,
            "relationship_types": len(settings.graph.relationship_types),
        },
        "ranking_weights": dataclasses.asdict(settings.graph.ranking),
        "reference_date": settings.graph.reference_date.isoformat(),
        "excluded_labels": list(settings.graph.excluded_labels),
        "ontology_version": ONTOLOGY_VERSION,
        "graph_label_version": LABEL_VERSION,
        "scorer_version": SCORER_VERSION,
        "prompt_hash": hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest(),
        "relationship_types_b": list(settings_b.graph.relationship_types),
        "relationship_types_c": list(settings_c.graph.relationship_types),
        "dedupe_threshold": settings.context.dedupe_threshold,
        "generation_quantisation": settings.generation.quantisation,
        "generation_model_family": settings.generation.model_family,
        "generation_reasoning": settings.generation.reasoning,
        "repeats": repeats,
        "run_kind": kind,
        "judge_model": judge.model_name,
        "judge_model_family": judge.model_family,
        "judge_prompt_version": JUDGE_PROMPT_VERSION,
        "judge_prompt_hash": judge_prompt_hash(),
        "judge_temperature": judge.temperature,
        "judge_reasoning": judge.reasoning,
        "selection_rule": SELECTION_RULE,
        "method_version": METHOD_VERSION,
        "record_facts_version": RECORD_FACTS_VERSION,
        "prompt_extras": {extra: list(tags) for extra, tags in PROMPT_EXTRAS.items()},
    }


@dataclass(frozen=True, slots=True)
class ReproducibilityRecord:
    """The docs/reference/05 section 11 provenance block stored with every run."""

    git_sha: str
    # True when the checkout had uncommitted changes; None when git was unavailable.
    git_dirty: bool | None
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
    graph_label_version: str
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
    # None for the fake judge, which calls no model.
    judge_temperature: float | None
    # Gateway reasoning modes ("default" or "off"); the fake judge has none.
    generation_reasoning: str
    judge_reasoning: str | None
    # Which rule chose the evidence in context; None in a file written before it was recorded.
    selection_rule: str | None = None
    # Method v0.3 (D-092); None in a file written before them, which is method 0.2.0.
    method_version: str | None = None
    record_facts_version: str | None = None
    prompt_extras: dict[str, list[str]] | None = None
    # D-096; None in a file written before it, whose answers parser 1.0.0 read.
    answer_parser_version: str | None = None

    def to_payload(self) -> dict[str, Any]:
        """Every field, JSON-ready."""
        return dataclasses.asdict(self)


@dataclass(frozen=True, slots=True)
class ShownBlock:
    """One context block the generator was shown, with the carrier it is.

    ``text`` is exactly what the model was shown for the source: the
    rendered ``context_block`` without its [n], so groundedness measures
    support against everything the model saw. ``kind`` is the evidence kind
    (chunk, record, node); None in a block recorded before method v0.3,
    whose ``text`` is the bare chunk text.
    """

    carrier_id: str
    title: str
    text: str
    kind: str | None = None

    @property
    def judge_text(self) -> str:
        """What the judge and the labelling sheet read (F12): ``text`` less a
        document chunk's "{title} ({market}, {language})" line. A record's
        heading with its source, a graph node's "<Label> <id>" heading and a
        graph record's path line stay; a block recorded before v0.3 holds no
        title line and is read as is."""
        if self.kind == "chunk":
            return self.text.partition("\n")[2]
        return self.text


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
    # The gateway's message when generation failed, so results.json says why.
    generation_error: str | None = None
    # How the answer was read and how the output ended (RagAnswer, D-096);
    # None when generation failed and in a run recorded before parser 2.0.0.
    answer_form: AnswerForm | None = None
    finish_reason: str | None = None
    token_limit_reached: bool | None = None
    cut_off: bool | None = None
    # Lone surrogates replaced with U+FFFD (parser 2.1.1); None before it.
    surrogates_replaced: int | None = None

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
    # Descriptive (D-088); None in a score written before it was recorded, and
    # in a Live Lab score, whose rebuilt blocks carry no text.
    groundedness: GroundednessScore | None = None

    def to_payload(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


@dataclass(frozen=True, slots=True)
class InstanceResult:
    """Every repeat of every pipeline on one instance; a repeat whose
    generation failed has no score (None at its index)."""

    instance: BankInstance
    runs: dict[str, list[PipelineRun]]
    scores: dict[str, list[RunScore | None]]


def instance_result_from_payload(payload: dict[str, Any]) -> InstanceResult:
    """One entry of a world's ``results`` in ``results.json``, read back."""
    return InstanceResult(
        instance=instance_from_payload(payload["instance"]),
        runs={
            tag: [
                PipelineRun(
                    **{
                        **run,
                        "cited_blocks": tuple(run["cited_blocks"]),
                        "blocks": tuple(ShownBlock(**block) for block in run["blocks"]),
                        "selected": tuple(run["selected"]),
                        "resolved_ids": tuple(run["resolved_ids"]),
                    }
                )
                for run in runs
            ]
            for tag, runs in payload["runs"].items()
        },
        scores={
            tag: [None if score is None else _score_from_payload(score) for score in scores]
            for tag, scores in payload["scores"].items()
        },
    )


def _score_from_payload(payload: dict[str, Any]) -> RunScore:
    judge = payload["judge"]
    grounded = payload.get("groundedness")
    return RunScore(
        answer=payload["answer"],
        evidence=EvidenceScore(**payload["evidence"]),
        citations=CitationMetrics(**payload["citations"]),
        failure_class=payload["failure_class"],
        judge=None
        if judge is None
        else JudgeVerdict(
            **{
                **judge,
                "scores": None if judge["scores"] is None else JudgeScores(**judge["scores"]),
            }
        ),
        groundedness=None if grounded is None else GroundednessScore(**grounded),
    )


@dataclass(frozen=True, slots=True)
class WorldRun:
    """One world's results under one frozen bank, with the record of the
    runner that produced them (None only for hand-built runs)."""

    world_seed: int
    bank_hash: str
    results: list[InstanceResult]
    unavailable: tuple[Unavailable, ...]
    record: ReproducibilityRecord | None = None

    def to_payload(self) -> dict[str, Any]:
        """The world as ``results.json`` lists it (without its record, which
        the run publishes under ``reproducibility``)."""
        return {
            "world_seed": self.world_seed,
            "bank_hash": self.bank_hash,
            "unavailable": [dataclasses.asdict(u) for u in self.unavailable],
            "results": [
                {
                    "instance": result.instance.to_payload(),
                    "runs": {
                        tag: [run.to_payload() for run in runs] for tag, runs in result.runs.items()
                    },
                    "scores": {
                        tag: [None if s is None else s.to_payload() for s in scores]
                        for tag, scores in result.scores.items()
                    },
                }
                for result in self.results
            ],
        }


def world_run_from_payload(payload: dict[str, Any], record: dict[str, Any]) -> WorldRun:
    """A world read back from :meth:`WorldRun.to_payload` and its record payload."""
    return WorldRun(
        world_seed=payload["world_seed"],
        bank_hash=payload["bank_hash"],
        results=[instance_result_from_payload(result) for result in payload["results"]],
        unavailable=tuple(Unavailable(**item) for item in payload["unavailable"]),
        record=ReproducibilityRecord(**record),
    )


@dataclass(frozen=True, slots=True)
class Selection:
    """Which part of the bank a run scored: strata and logical questions
    (None for all of either) and at most ``limit`` instances per logical
    question (None for all)."""

    strata: tuple[str, ...] | None = None
    limit: int | None = None
    questions: tuple[str, ...] | None = None

    @property
    def full(self) -> bool:
        return self.strata is None and self.limit is None and self.questions is None

    def describe(self) -> str:
        """Plain words, for example "strata H1; at most 2 instances per question"."""
        if self.full:
            return "the whole bank"
        parts = []
        if self.strata is not None:
            parts.append("strata " + ", ".join(self.strata))
        if self.questions is not None:
            parts.append("questions " + ", ".join(self.questions))
        if self.limit is not None:
            noun = "instance" if self.limit == 1 else "instances"
            parts.append(f"at most {self.limit} {noun} per question")
        return "; ".join(parts)

    def to_payload(self) -> dict[str, Any]:
        """``questions`` is written only when set, so the payload of a run
        over all questions is the one earlier runs stored."""
        payload: dict[str, Any] = {
            "strata": None if self.strata is None else list(self.strata),
            "limit": self.limit,
        }
        if self.questions is not None:
            payload["questions"] = list(self.questions)
        return payload


@dataclass(frozen=True, slots=True)
class BenchmarkRun:
    """A complete run: its kind, its label, its record and every world.

    ``record`` stands in for the worlds' records only when no world carries
    one (hand-built runs); the published record is :meth:`reproducibility`.
    """

    kind: str
    label: str | None
    record: ReproducibilityRecord
    worlds: list[WorldRun]
    selection: Selection = Selection()

    def reproducibility(self) -> dict[str, Any]:
        """``run``: the fields every world's record shares, plus the run's
        ``started_at`` (its first world's); ``worlds``: each world's record."""
        records = [world.record for world in self.worlds if world.record is not None]
        payloads = [record.to_payload() for record in records or [self.record]]
        first = payloads[0]
        shared = {
            key: value for key, value in first.items() if all(p[key] == value for p in payloads)
        }
        return {"run": {**shared, "started_at": first["started_at"]}, "worlds": payloads}

    def to_payload(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "label": self.label,
            "selection": self.selection.to_payload(),
            "reproducibility": self.reproducibility(),
            "worlds": [world.to_payload() for world in self.worlds],
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
        self.world_manifest = check_bank(bank, world_dir, lab)
        self.lab = lab
        self.graph_config = graph_config
        self.bank = bank
        self.world_dir = world_dir
        self.kind = kind
        self.label = KIND_LABELS.get(kind)
        self.repeats = repeats
        self.pipelines = pipelines
        self.started_at = datetime.now(UTC).isoformat(timespec="seconds")
        self._shown = _ShownContext(lab.generator)
        # Every pipeline shares the one recording generator, as they share the lab's.
        self._run_lab = dataclasses.replace(lab, generator=self._shown)

    def run(self, on_instance: Callable[[int, int], None] | None = None) -> WorldRun:
        """Run the bank's instances in bank order.

        A run over part of the bank selects it before the runner is built
        (``official.select_instances``), so the selection is recorded.
        ``on_instance(done, total)`` is called before each instance and once
        after the last; an exception it raises stops the world there, which
        is how a benchmark job is cancelled between instances.
        """
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
            instances = self.bank.instances
            results: list[InstanceResult] = []
            for done, instance in enumerate(instances):
                if on_instance is not None:
                    on_instance(done, len(instances))
                results.append(self._run_instance(instance, pipelines))
            if on_instance is not None:
                on_instance(len(instances), len(instances))
        finally:
            if wired is not None:
                wired.reader.close()
        return WorldRun(
            self.bank.world_seed, self.bank.bank_hash, results, self.bank.unavailable, self.record()
        )

    def record(self) -> ReproducibilityRecord:
        manifest = self.world_manifest
        return ReproducibilityRecord(
            **{
                **settings_fields(self.lab.settings, self.judge, self.kind, self.repeats),
                "generation_model": self.lab.generator.model_name,
            },
            world_dir=self.world_dir.as_posix(),
            generator_version=str(manifest.get("generator_version", "unknown")),
            profile=str(manifest.get("profile", "unknown")),
            world_seed=manifest.get("world_seed"),
            scenario_seed=manifest.get("scenario_seed"),
            embedding_model=self.lab.embeddings.model_name,
            embedding_dimensions=self.lab.embeddings.dimensions,
            sparse_model=self.lab.sparse.model_name,
            record_serialiser_version=self.lab.record_serialiser_version,
            reranker=self.lab.reranker.model_name,
            started_at=self.started_at,
            bank_version=self.bank.bank_version,
            bank_hash=self.bank.bank_hash,
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
            with (
                run_context(question_id=instance.question_id, pipeline=tag),
                stage_timer("evaluation"),
            ):
                scores[tag] = [
                    None
                    if r.generation_failed
                    else score_pipeline_run(instance, r, self._judge(instance, r))
                    for r in repeats
                ]
            for run, score in zip(repeats, scores[tag], strict=True):
                self._log_repeat(instance, run, score)
        return InstanceResult(instance=instance, runs=runs, scores=scores)

    def _log_repeat(self, instance: BankInstance, run: PipelineRun, score: RunScore | None) -> None:
        """One structured INFO record per repeat: identifiers, timings and
        failures only, never an answer or an expected answer."""
        verdict = None if score is None else score.judge
        with run_context(question_id=instance.question_id, pipeline=run.pipeline):
            logger.info(
                "benchmark repeat scored",
                extra={
                    "world_seed": self.bank.world_seed,
                    "bank_hash": self.bank.bank_hash,
                    "instance_id": instance.instance_id,
                    "repeat": run.repeat,
                    "latency_ms": run.latency_ms,
                    "generation_error": run.generation_error,
                    "judge_failure": None if verdict is None else verdict.failure,
                    "judge_latency_ms": None if verdict is None else verdict.latency_ms,
                },
            )

    def _judge(self, instance: BankInstance, run: PipelineRun) -> JudgeVerdict:
        """Judge one successful repeat."""
        return self.judge.judge(judge_item(instance, run))

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
        error: str | None = None
        try:
            answer = pipeline.run(question).answer
        except GenerationError as failure:
            answer, error = None, str(failure)
        latency_ms = (time.perf_counter() - started) * 1000
        contexts = self._shown.contexts
        blocks = tuple(
            ShownBlock(
                selection_carrier(c.kind, c.chunk_id, c.document_id),
                c.title,
                context_block(c),
                c.kind,
            )
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
                # The selection's rendered-block tokens, as a pipeline records them.
                sum(block_tokens(c) for c in contexts) if answer is None else answer.context_tokens
            ),
            latency_ms=latency_ms,
            generation_failed=answer is None,
            generation_error=error,
            answer_form=None if answer is None else answer.answer_form,
            finish_reason=None if answer is None else answer.finish_reason,
            token_limit_reached=None if answer is None else answer.token_limit_reached,
            cut_off=None if answer is None else answer.cut_off,
            surrogates_replaced=None if answer is None else answer.surrogates_replaced,
        )


def judge_item(instance: BankInstance, run: PipelineRun) -> JudgeItem:
    """What the judge sees of one repeat; the seed blinds the block order.
    The second judge (D-100) rebuilds a stored repeat's item with it."""
    return JudgeItem(
        question=instance.text,
        expected_answer=instance.expected_answer,
        claim_statements=tuple(claim.statement for claim in instance.claims),
        blocks=run.blocks,
        answer=run.answer,
        cited_blocks=run.cited_blocks,
        blind_seed=f"{instance.instance_id}:{run.pipeline}:{run.repeat}",
    )


def score_pipeline_run(
    instance: BankInstance, run: PipelineRun, verdict: JudgeVerdict | None = None
) -> RunScore:
    """The deterministic scores of one successful run, beside its judgement.

    The benchmark runner passes the judge's verdict; Live Lab scoring
    (``app.api.scoring``) runs no judge and passes none, so a live score
    equals the deterministic part of the runner's score for the same run,
    groundedness apart: a stored run keeps no block texts, so when every
    shown block's text is empty there is no groundedness (None).
    """
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
    texts = [block.text for block in run.blocks]
    grounded = (
        None
        if texts and not any(texts)
        else groundedness(instance.text, run.verdict, run.answer, texts)
    )
    return RunScore(
        answer,
        evidence,
        citations,
        classify_failure(answer, evidence, run.seeded),
        verdict,
        grounded,
    )


def _check_run(lab: Lab, kind: str, repeats: int, pipelines: Sequence[str]) -> None:
    """Refuse a run whose kind, repeats, pipelines or generator do not fit."""
    unknown = [tag for tag in pipelines if tag not in PIPELINES]
    if unknown or not pipelines:
        raise ValueError(f"unknown pipelines {unknown}; expected some of {PIPELINES}")
    check_run_config(
        kind,
        repeats,
        isinstance(lab.generator, FakeAnswerGenerator),
        lab.settings.generation.model_family,
    )


def check_run_config(
    kind: str, repeats: int, fake_generator: bool, generation_family: str | None
) -> None:
    """Refuse a run kind, repeat count or generator that do not fit together.

    Smoke runs need the fake generator; sweep, dev and official runs refuse
    it, so no answer metric of theirs comes from the fake model; an official
    run needs at least OFFICIAL_MIN_REPEATS repeats and the generation model family. Which seeds a
    kind may run is checked by the orchestration (``official.check_seeds``).
    """
    if kind not in RUN_KINDS:
        raise ValueError(f"unknown run kind {kind!r}; expected one of {RUN_KINDS}")
    if repeats < 1:
        raise ValueError(f"repeats must be at least 1, got {repeats}")
    if kind == "smoke" and not fake_generator:
        raise ValueError("a smoke run requires the fake generator")
    if kind != "smoke" and fake_generator:
        raise ValueError(f"a {kind} run refuses the fake generator")
    if kind == "official":
        if repeats < OFFICIAL_MIN_REPEATS:
            raise ValueError(
                f"an official run needs at least {OFFICIAL_MIN_REPEATS} repeats, got {repeats}"
            )
        if not generation_family:
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


def check_bank(bank: FrozenBank, world_dir: Path, lab: Lab) -> dict[str, Any]:
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
    if bank.scorer_version != SCORER_VERSION:
        raise GroundingError(
            f"the frozen bank was grounded for scorer {bank.scorer_version or 'unrecorded'}, "
            f"the code has scorer {SCORER_VERSION}; ground the bank again"
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
