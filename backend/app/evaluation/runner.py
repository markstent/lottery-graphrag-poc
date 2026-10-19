"""Benchmark harness (docs/05-benchmark-spec.md; HITL-09).

Runs the grounded question bank through pipelines A/B/C against one live
world and scores every execution deterministically. The truth ledger is
read only here and only through :mod:`app.evaluation.grounding`; retrieval
modules never see expected answers (ADR-008).

Usage:
    uv run python -m app.evaluation [--generator fake|litellm]
        [--questions Q01,Q25] [--pipelines ABC] [--out DIR]
"""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import RetrievalSettings
from app.evaluation.bank import BANK, BANK_VERSION, BankQuestion
from app.evaluation.grounding import GroundedQuestion, WorldGrounding
from app.evaluation.scoring import (
    PipelineRunResult,
    QuestionScore,
    classify_failure,
    evidence_metrics,
    score_checks,
)
from app.events import ListEventSink, RetrievalEvent
from app.graph.config import GraphConfig
from app.ontology import ONTOLOGY_VERSION
from app.retrieval.graph.lab import Lab, build_lab, wired_pipelines
from app.retrieval.graph.pipeline import GraphRagPipeline
from app.retrieval.standard.generation import AnswerGenerator, GenerationError
from app.retrieval.standard.pipeline import StandardRagPipeline

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
    generation_model: str
    generation_temperature: float
    reranker: str
    top_k: int
    context_budget_tokens: int
    graph_limits: dict[str, Any]
    ontology_version: str
    started_at: str

    def to_payload(self) -> dict[str, Any]:
        return {
            "git_sha": self.git_sha,
            "question_bank_version": self.question_bank_version,
            "world_dir": self.world_dir,
            "generator_version": self.generator_version,
            "profile": self.profile,
            "world_seed": self.world_seed,
            "scenario_seed": self.scenario_seed,
            "embedding_model": self.embedding_model,
            "generation_model": self.generation_model,
            "generation_temperature": self.generation_temperature,
            "reranker": self.reranker,
            "top_k": self.top_k,
            "context_budget_tokens": self.context_budget_tokens,
            "graph_limits": self.graph_limits,
            "ontology_version": self.ontology_version,
            "started_at": self.started_at,
        }


@dataclass(slots=True)
class QuestionResult:
    grounded: GroundedQuestion
    runs: dict[str, PipelineRunResult] = field(default_factory=dict)
    scores: dict[str, QuestionScore] = field(default_factory=dict)


@dataclass(slots=True)
class BenchmarkRun:
    record: ReproducibilityRecord
    results: list[QuestionResult]

    def to_payload(self) -> dict[str, Any]:
        return {
            "reproducibility": self.record.to_payload(),
            "results": [
                {
                    "question_id": result.grounded.question.question_id,
                    "category": result.grounded.question.category,
                    "binding_key": result.grounded.question.binding_key,
                    "status": result.grounded.status,
                    "note": result.grounded.note,
                    "question_text": result.grounded.text,
                    "checks": [
                        {
                            "kind": kind,
                            "expected": sorted(value)
                            if isinstance(value, (set, frozenset))
                            else value,
                        }
                        for kind, value in result.grounded.checks
                    ],
                    "required_evidence": list(result.grounded.required_evidence),
                    "runs": {tag: run.to_payload() for tag, run in result.runs.items()},
                    "scores": {tag: score.to_payload() for tag, score in result.scores.items()},
                }
                for result in self.results
            ],
        }


class BenchmarkRunner:
    """Execute the bank through A/B/C and score deterministically."""

    def __init__(
        self,
        settings: RetrievalSettings,
        graph_config: GraphConfig,
        generator: AnswerGenerator,
        world_dir: Path,
        ledger_path: Path | None = None,
    ) -> None:
        self.lab: Lab = build_lab(settings, generator)
        self.graph_config = graph_config
        self.grounding = WorldGrounding(world_dir, ledger_path=ledger_path)
        self.world_dir = world_dir

    def close(self) -> None:
        self.grounding.close()

    def run(self, question_ids: list[str] | None = None) -> BenchmarkRun:
        questions = _select_questions(question_ids)
        results: list[QuestionResult] = []
        for question in questions:
            grounded = self.grounding.ground(question)
            result = QuestionResult(grounded=grounded)
            if grounded.status == "ok":
                self._run_pipelines(question, grounded, result)
                self._score(grounded, result)
            results.append(result)
            print(
                f"[benchmark] {question.question_id} {grounded.status}: "
                + ", ".join(
                    f"{tag}={_fmt_scores(result.scores.get(tag))}" for tag in ("A", "B", "C")
                )
            )
        return BenchmarkRun(record=self._record(), results=results)

    def _run_pipelines(
        self, question: BankQuestion, grounded: GroundedQuestion, result: QuestionResult
    ) -> None:
        sink_a = ListEventSink()
        pipeline_a: StandardRagPipeline = self.lab.pipeline_a()
        result.runs["A"] = self._execute(pipeline_a, "A", grounded.text, sink_a.events)

        wired = wired_pipelines(self.lab, self.graph_config)
        try:
            for tag, pipeline in wired.pipelines:
                result.runs[tag] = self._execute(pipeline, tag, grounded.text, pipeline.events)
        finally:
            wired.reader.close()

    def _execute(
        self,
        pipeline: StandardRagPipeline | GraphRagPipeline,
        tag: str,
        question: str,
        events: list[RetrievalEvent],
    ) -> PipelineRunResult:
        """Run one pipeline; a gateway failure is recorded, not fatal.

        Only GenerationError is contained: the gateway is an external
        dependency where one flaky call must not destroy an official run,
        and the report marks the result generation_failure. Anything else
        (Neo4j down, a bug) fails loudly.
        """
        started = time.perf_counter()
        try:
            run = pipeline.run(question)
        except GenerationError:
            latency = (time.perf_counter() - started) * 1000
            return PipelineRunResult(
                pipeline=tag,
                answer="",
                selected_nodes=(),
                discarded_nodes=(),
                seed_ids=(),
                selected_document_ids=(),
                context_tokens=0,
                latency_ms=latency,
                event_counts={},
                generation_failed=True,
            )
        latency = (time.perf_counter() - started) * 1000
        return _pipeline_result(tag, run, latency, events)

    def _score(self, grounded: GroundedQuestion, result: QuestionResult) -> None:
        for tag, run in result.runs.items():
            if run.generation_failed:
                # The gateway failed; classify from the recorded fact rather
                # than heuristics that would read the empty run as retrieval
                # failure.
                result.scores[tag] = QuestionScore(
                    answer_score=0.0,
                    evidence_recall=0.0,
                    evidence_precision=0.0,
                    failure_class="generation_failure",
                )
                continue
            answer_score = score_checks(grounded.checks, run.answer)
            recall, precision = evidence_metrics(
                grounded.required_evidence, run.retrieved_evidence()
            )
            failure = classify_failure(
                answer_score,
                recall,
                run.seed_ids,
                grounded.required_evidence,
                run.selected_nodes,
                run.discarded_nodes,
            )
            result.scores[tag] = QuestionScore(
                answer_score=answer_score,
                evidence_recall=recall,
                evidence_precision=precision,
                failure_class=failure,
            )

    def _record(self) -> ReproducibilityRecord:
        settings = self.lab.settings
        manifest_path = self.world_dir / "_manifest.json"
        manifest: dict[str, Any] = {}
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        return ReproducibilityRecord(
            git_sha=_git_sha(),
            question_bank_version=BANK_VERSION,
            world_dir=self.world_dir.as_posix(),
            generator_version=str(manifest.get("generator_version", "unknown")),
            profile=str(manifest.get("profile", "unknown")),
            world_seed=manifest.get("world_seed"),
            scenario_seed=manifest.get("scenario_seed"),
            embedding_model=self.lab.embeddings.model_name,
            generation_model=self.lab.generator.model_name,
            generation_temperature=settings.generation.temperature,
            reranker=self.lab.reranker.model_name,
            top_k=settings.top_k,
            context_budget_tokens=settings.context.budget_tokens,
            graph_limits={
                "depth": settings.graph.max_depth,
                "nodes_per_hop": settings.graph.max_nodes_per_hop,
                "edges_per_node_type": settings.graph.max_edges_per_node_type,
                "total_nodes": settings.graph.max_total_nodes,
                "evidence_nodes": settings.graph.max_evidence_nodes,
                "relationship_types": len(settings.graph.relationship_types),
            },
            ontology_version=ONTOLOGY_VERSION,
            started_at=datetime.now(UTC).isoformat(timespec="seconds"),
        )


def _pipeline_result(
    tag: str, run: Any, latency_ms: float, events: list[RetrievalEvent]
) -> PipelineRunResult:
    counts: dict[str, int] = {}
    for event in events:
        counts[event.event_type] = counts.get(event.event_type, 0) + 1
    nodes = list(run.node_evidence) if hasattr(run, "node_evidence") else []
    chunks = (
        list(run.document_evidence) if hasattr(run, "document_evidence") else list(run.evidence)
    )
    return PipelineRunResult(
        pipeline=tag,
        answer=run.answer.text,
        selected_nodes=tuple(item.node_id for item in nodes if item.selected),
        discarded_nodes=tuple(item.node_id for item in nodes if not item.selected),
        seed_ids=tuple(item.node_id for item in nodes if item.hops == 0),
        selected_document_ids=tuple(chunk.document_id for chunk in chunks if chunk.selected),
        context_tokens=run.answer.context_tokens,
        latency_ms=latency_ms,
        event_counts=counts,
    )


def _select_questions(question_ids: list[str] | None) -> list[BankQuestion]:
    if question_ids is None:
        return list(BANK)
    wanted = set(question_ids)
    selected = [question for question in BANK if question.question_id in wanted]
    missing = wanted - {question.question_id for question in selected}
    if missing:
        raise KeyError(f"unknown question ids: {sorted(missing)}")
    return selected


def _fmt_scores(score: QuestionScore | None) -> str:
    if score is None:
        return "n/a"
    answer = "-" if score.answer_score is None else f"{score.answer_score:.2f}"
    recall = "-" if score.evidence_recall is None else f"{score.evidence_recall:.2f}"
    return f"ans {answer} ev {recall}"
