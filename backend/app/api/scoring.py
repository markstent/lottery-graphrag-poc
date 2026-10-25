"""Live Lab and the frozen bank: demo questions, bank questions and their
post-run scores (spec 10a.1).

A bank question run in Live Lab sends only the instance's text to the
pipelines. Once the run has completed, the worker scores the stored
results against the instance's answer key with the benchmark runner's own
deterministic scorer (``score_pipeline_run``), so a live score equals what
the runner computes for the same pipeline results. The judge never runs
here: it runs only in official runs.

This is one of the two API modules that may import ``app.evaluation``
(ADR-008); the expected answer, checks and claims stay in this module and
never reach a pipeline, an event or a log record.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.api.errors import ApiError, ErrorCode
from app.api.schemas import (
    DemoQuestion,
    LivePipelineScore,
    LiveScore,
    QueryRequest,
    ScoreStatus,
)
from app.evaluation.claims import selection_carrier
from app.evaluation.grounding import BankInstance, FrozenBank, demo_instances
from app.evaluation.official import ground_command
from app.evaluation.report import METRICS
from app.evaluation.runner import PipelineRun, ShownBlock, score_pipeline_run
from app.events import GRAPH_ENTITY_RESOLVED
from app.persistence.store import RunRow

OWN_TEXT = "a bank question runs with its own text"
OWN_SCOPE = "a bank question runs with its own scope"
# The bank defines no market scope of its own: every instance runs unscoped.
INSTANCE_SCOPE: tuple[str, ...] = ()
# The stored score record: the status beside the score, so a failed scoring
# is recorded too (the store keeps one JSON document per run).
SCORED = "scored"
FAILED = "failed"
INTERRUPTED = "interrupted"
# The pipelines that resolve entities before retrieval (the runner's ``seeded``).
SEEDED_PIPELINES = frozenset({"B", "C"})
LIVE_METRICS = ("answer", "evidence_f1", "anchor_resolution")

Results = dict[str, dict[str, Any]]
Events = list[dict[str, Any]]
Scorer = Callable[[RunRow, Results, Events, FrozenBank], LiveScore]
BankSource = Callable[[], FrozenBank | None]


@dataclass(frozen=True, slots=True)
class BankQuestion:
    """A bank instance a live run asks, with the bank it is scored against."""

    bank: FrozenBank
    instance: BankInstance


def demo_questions(bank: FrozenBank) -> list[DemoQuestion]:
    """The first instance in bank order of each demo stratum, in stratum order."""
    return [
        DemoQuestion(
            instance_id=first.instance_id,
            question_id=first.question_id,
            text=first.text,
            stratum=first.stratum,
            market_scope=list(INSTANCE_SCOPE),
        )
        for first in demo_instances(bank)
    ]


def bank_not_grounded() -> str:
    """The 503 message of a bank that does not exist, naming the command that grounds it."""
    return f"the question bank has not been grounded; run {ground_command()}"


def require_bank(bank: FrozenBank | None) -> FrozenBank:
    """The bank, or a 503 that says how to ground it."""
    if bank is None:
        raise ApiError(503, ErrorCode.CONFIGURATION_ERROR, bank_not_grounded())
    return bank


def bank_question(request: QueryRequest, bank: FrozenBank | None) -> BankQuestion:
    """The bank instance a request asks for; a 422 for an id the bank does
    not hold, for question text other than the instance's own, or for a
    market scope other than the instance's own, so a live score is always
    comparable with the benchmark's."""
    instance_id = request.benchmark_instance_id
    frozen = require_bank(bank)
    instance = next((i for i in frozen.instances if i.instance_id == instance_id), None)
    if instance is None:
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            f"unknown benchmark_instance_id {instance_id!r}: not an instance of the frozen bank",
        )
    if request.question is not None and request.question != instance.text:
        raise ApiError(422, ErrorCode.VALIDATION_ERROR, OWN_TEXT)
    if tuple(request.market_scope) != INSTANCE_SCOPE:
        raise ApiError(422, ErrorCode.VALIDATION_ERROR, OWN_SCOPE)
    return BankQuestion(bank=frozen, instance=instance)


def scored_record(score: LiveScore) -> dict[str, Any]:
    return {"status": SCORED, "score": score.model_dump(mode="json")}


def failed_record() -> dict[str, Any]:
    return {"status": FAILED}


def interrupted_record() -> dict[str, Any]:
    """The score of a completed bank run whose scoring a server stop cut off."""
    return {"status": FAILED, "reason": INTERRUPTED}


@dataclass(frozen=True, slots=True)
class ScoreState:
    """Where a run stands with its answer key, as the results route reports it."""

    status: ScoreStatus
    score: LiveScore | None = None
    # Why scoring failed when the reason is known: "interrupted" by a server stop.
    failure_reason: str | None = None


def score_state(row: RunRow, record: dict[str, Any] | None) -> ScoreState:
    """The run's score state, from its row and stored score record."""
    if row.benchmark_instance_id is None or row.status != "completed":
        return ScoreState("not_applicable")
    if record is None:
        return ScoreState("pending")
    if record["status"] == SCORED:
        return ScoreState("scored", LiveScore.model_validate(record["score"]))
    return ScoreState("failed", failure_reason=record.get("reason"))


def score_run(run: RunRow, results: Results, events: Events, bank: FrozenBank) -> LiveScore:
    """Score a completed bank question's stored results against its answer key.

    Every stored pipeline result is turned back into the runner's
    ``PipelineRun`` and scored by ``score_pipeline_run`` with no judge.
    """
    instance = next(i for i in bank.instances if i.instance_id == run.benchmark_instance_id)
    per_pipeline: dict[str, LivePipelineScore] = {}
    for tag, result in results.items():
        pipeline_run = stored_pipeline_run(tag, result, events)
        score = score_pipeline_run(instance, pipeline_run)
        values = {name: METRICS[name](score, pipeline_run) for name in LIVE_METRICS}
        per_pipeline[tag] = LivePipelineScore(**values, failure_class=score.failure_class)
    return LiveScore(instance_id=instance.instance_id, per_pipeline=per_pipeline)


def stored_pipeline_run(tag: str, result: dict[str, Any], events: Events) -> PipelineRun:
    """The runner's view of one stored pipeline result.

    The prompt blocks are the answer's citations (one per block shown, in
    prompt order), each mapped to its carrier as the runner maps it; the
    resolved ids are the pipeline's ``graph.entity.resolved`` events. The
    stored result does not keep block texts, which only the judge reads,
    nor the pipeline's wall-clock latency: the generation latency stands in.
    """
    answer = result["answer"]
    kinds = _evidence_kinds(result)
    blocks = tuple(
        ShownBlock(
            carrier_id=selection_carrier(
                kinds[citation["chunk_id"]], citation["chunk_id"], citation["document_id"]
            ),
            title=citation["title"],
            text="",
        )
        for citation in answer["citations"]
    )
    return PipelineRun(
        pipeline=tag,
        repeat=0,
        verdict=answer["verdict"],
        answer=answer["text"],
        raw_text=answer["raw_text"],
        cited_blocks=tuple(answer["cited_blocks"]),
        blocks=blocks,
        selected=tuple(block.carrier_id for block in blocks),
        resolved_ids=_resolved_ids(tag, events),
        seeded=tag in SEEDED_PIPELINES,
        context_tokens=answer["context_tokens"],
        latency_ms=answer["latency_ms"],
        generation_failed=False,
    )


def _evidence_kinds(result: dict[str, Any]) -> dict[str, str]:
    """Each candidate's kind by chunk id: A's evidence, or B and C's
    document evidence plus their graph nodes (a node block's chunk id is its
    node id)."""
    chunks = [*result.get("evidence", []), *result.get("document_evidence", [])]
    kinds = {chunk["chunk_id"]: chunk["kind"] for chunk in chunks}
    kinds.update((node["node_id"], "node") for node in result.get("node_evidence", []))
    return kinds


def _resolved_ids(tag: str, events: Events) -> tuple[str, ...]:
    return tuple(
        str(event["payload"]["entity_id"])
        for event in events
        if event["pipeline"] == tag and event["event_type"] == GRAPH_ENTITY_RESOLVED
    )
