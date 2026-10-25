"""Side-by-side A/B/C execution traces (docs/reference/08 HITL-08).

Runs the demo questions (``app.api.scoring.demo_questions``: the first
instance of each demo stratum in the presentation world's frozen bank) through
pipeline A (conventional RAG), B (graph, no ontology) and C (graph plus
ontology) against the live development world: Qdrant (shared hybrid index),
Neo4j (dev graph), Ollama embeddings and the configured generator. Prints a
markdown document so the output can be committed verbatim as
docs/evaluation/example-traces.md.

Usage:
    uv run python -m app.traces [--generator fake|litellm]
        [--question L05] [--pipeline A]

The litellm generator reads its model from GENERATION_MODEL and
GENERATION_API_BASE (app.config.from_env).

Requires: services up (make services-up), the dev graph ingested
(make ingest-graph), the vector index built (make index-vector) and the
bank grounded (make ground-bank). The truth ledger is never read here, and
only each demo question's text reaches the pipelines, never its answer key.
"""

from __future__ import annotations

import argparse
import time

from app.api.benchmarks import presentation_bank
from app.api.errors import ApiError
from app.api.schemas import DemoQuestion
from app.api.scoring import bank_not_grounded, demo_questions
from app.config import GraphConfig, RetrievalSettings, from_env
from app.events import (
    GRAPH_CANDIDATE_RERANKED,
    GRAPH_ENTITY_RESOLVED,
    GRAPH_NODE_DISCOVERED,
    GRAPH_QUERY_EXPANDED,
    GRAPH_RELATIONSHIP_TRAVERSED,
    GRAPH_RERANK_STARTED,
    GRAPH_SEED_SELECTED,
    GRAPH_TRAVERSAL_STARTED,
    RAG_CANDIDATE_RERANKED,
    RAG_RERANK_STARTED,
    ListEventSink,
    RetrievalEvent,
)
from app.evidence import EvidenceChunk, GraphRunResult, RagAnswer, RagRunResult
from app.lab import PipelineId, build_generator, build_lab, wired_pipelines

PIPELINE_IDS: tuple[PipelineId, ...] = ("A", "B", "C")
# Node ids listed per ontology concept before the remainder is summarised.
VIA_CONCEPT_SHOWN = 5

# Document header, one markdown line per entry (one sentence per line).
HEADER_LINES: tuple[str, ...] = (
    "# Example Traces: A/B/C Retrieval Comparison",
    "",
    "Status: HITL-08 artefact, regenerated for pipelines v2 against the development world.",
    "",
    "## What this document is",
    "",
    "Verbatim output of the side-by-side trace CLI over the demo questions of the frozen bank.",
    "Each question runs through three retrieval pipelines:",
    "",
    (
        "- **A, conventional RAG**: dense (bge-m3) plus sparse embedding, hybrid search "
        "fused by reciprocal rank, cross-encoder reranking, one shared context budget "
        "and slot limit, generation."
    ),
    (
        "  The index holds document chunks and structured record blocks, so A can "
        "retrieve table rows as well as document text."
    ),
    (
        "- **B, graph relationships**: an id and market resolver seeds a bounded "
        "traversal over the structured-record subgraph (when nothing resolves, the "
        "graph node of the best-matching record block); every traversal node joins A's "
        "document channel as a structured candidate, judged and shown as the record "
        "block A indexes for its row (or only `<Label> <id>` when the row has none); "
        "nodes carry authoritative facts from the source tables for citations."
    ),
    "  No ontology: no concept seeds, no `MAPS_TO` expansion, no query expansion.",
    (
        "- **C, graph relationships + enterprise ontology**: B plus the ontology term "
        "resolver (concept seeds and concept-bound entities, shown as `via_concept`), "
        "query expansion with concept labels and synonyms (`graph.query.expanded`), and "
        "ontology expansion during traversal."
    ),
    "",
    (
        "Same question, same synthetic world, same embedding model, one reranker that "
        "judges every candidate against the raw question, same generator and prompt "
        "(the selection in judge order), one context budget and slot count."
    ),
    "Only the retrieval layers differ.",
    "",
    "## How it was produced",
    "",
    "```bash",
    "make index-vector   # hybrid dense + sparse index in Qdrant",
    "make ingest-graph   # development world graph in Neo4j",
    "cd backend",
    "uv run python -m app.traces --generator fake",
    "```",
    "",
    (
        "The answers come from the deterministic fake generator, which returns the "
        "structured JSON answer (verdict plus prose with [n] citations) built from the "
        "context titles only."
    ),
    (
        "The timings line (run wall clock, and judge time from the rerank events) is "
        "measured and varies run to run."
    ),
    (
        "Everything else (resolution, seeds, traversal, scores, discards, budgets) is "
        "the real retrieval telemetry and is reproducible run to run."
    ),
    "Run with `--generator litellm` and `GENERATION_MODEL` set to see a real model answer.",
    "",
    "The evaluator truth ledger is not consulted anywhere in this pipeline.",
    "",
    "## How to read a trace",
    "",
    (
        "- *selected context*: how many graph nodes, record blocks and document chunks "
        "the one selection placed in context; for A and the shared document channel, "
        "each block with its kind (`chunk` for document text, `record` for a table "
        "row), fused score, dense and sparse ranks, cross-encoder score and final rank."
    ),
    (
        "- *resolved entities* (B, C): resolver output with its origin; concept-bound "
        "entities name the concept they came through (`via_concept`)."
    ),
    "- *graph.query.expanded* (C): how many concept terms were added to the search text.",
    (
        "- *discovered via_concept* (C): nodes reached through ontology expansion, "
        "grouped by the concept that bound them."
    ),
    (
        "- *selected node evidence*: graph nodes chosen as evidence with hop distance, "
        "relationship, graph score components, cross-encoder score and authoritative facts."
    ),
    "- *events*: counts of the structured telemetry stream that drives the UI.",
    "- *Answer*: the parsed verdict, the prose answer and the cited context blocks.",
    "",
    "---",
    "",
)
HEADER = "\n".join(HEADER_LINES)


def run_all(
    settings: RetrievalSettings,
    graph_config: GraphConfig,
    generator_name: str,
    questions: list[DemoQuestion],
    pipelines: tuple[PipelineId, ...] = PIPELINE_IDS,
) -> str:
    lines: list[str] = [HEADER]
    lab = build_lab(settings, build_generator(generator_name, settings))

    for demo in questions:
        lines.append(f"## {demo.question_id}: stratum {demo.stratum}")
        lines.append("")
        lines.append(f"**Question:** {demo.text}")
        lines.append("")

        if "A" in pipelines:
            sink_a = ListEventSink()
            started = time.perf_counter()
            result_a = lab.pipeline_a(sink=sink_a).run(demo.text)
            wall_ms = (time.perf_counter() - started) * 1000.0
            lines.extend(trace_a(result_a, sink_a.events, wall_ms))

        if "B" in pipelines or "C" in pipelines:
            wired = wired_pipelines(lab, graph_config)
            try:
                for tag, pipeline in wired.pipelines:
                    if tag not in pipelines:
                        continue
                    started = time.perf_counter()
                    result_g = pipeline.run(demo.text)
                    wall_ms = (time.perf_counter() - started) * 1000.0
                    lines.extend(trace_g(tag, result_g, pipeline.events, wall_ms))
            finally:
                wired.reader.close()

        lines.append("")
    return "\n".join(lines)


def _fmt_events(events: list[RetrievalEvent]) -> str:
    counts: dict[str, int] = {}
    for event in events:
        counts[event.event_type] = counts.get(event.event_type, 0) + 1
    return ", ".join(f"{name}={count}" for name, count in sorted(counts.items()))


def _fmt_chunk(chunk: EvidenceChunk) -> str:
    kind = f"record {chunk.record_table}" if chunk.kind == "record" else chunk.kind
    parts = [
        f"fused {chunk.similarity:.4f}",
        f"dense rank {chunk.dense_rank}, sparse rank {chunk.sparse_rank}",
    ]
    if chunk.rerank_score is not None:
        parts.append(f"rerank {chunk.rerank_score:.3f}")
    parts.append(f"rank {chunk.rank}")
    return f"`{chunk.chunk_id}` [{kind}] {chunk.title} ({', '.join(parts)})"


def _fmt_timings(
    events: list[RetrievalEvent], started_type: str, reranked_type: str, wall_ms: float
) -> str:
    """Run wall clock and judge time (rerank started to first reranked event)."""
    line = f"- timings: run {wall_ms:.0f} ms"
    started = next((e for e in events if e.event_type == started_type), None)
    first = next((e for e in events if e.event_type == reranked_type), None)
    if started is not None and first is not None:
        judged = sum(1 for e in events if e.event_type == reranked_type)
        line += f", judge {first.t_ms - started.t_ms:.0f} ms over {judged} candidates"
    return line


def _fmt_score(score: float | None) -> str:
    return "-" if score is None else f"{score:.3f}"


def _fmt_answer(answer: RagAnswer) -> list[str]:
    shown = len(answer.citations)
    cited = (
        f"{answer.cited_blocks} of {shown} shown"
        if answer.cited_blocks
        else f"none ({shown} shown)"
    )
    return [
        f"**Answer** ({answer.model}, {answer.latency_ms:.0f} ms):",
        "",
        f"- verdict: {answer.verdict or '(none)'}",
        f"- cited blocks: {cited}",
        "",
        answer.text,
        "",
    ]


def trace_a(
    result: RagRunResult, events: list[RetrievalEvent], wall_ms: float | None = None
) -> list[str]:
    selected = [chunk for chunk in result.evidence if chunk.selected]
    discarded = [chunk for chunk in result.evidence if not chunk.selected]
    records = sum(1 for chunk in selected if chunk.kind == "record")
    lines = ["### Pipeline A: conventional RAG", ""]
    lines.append(
        f"- selected context ({len(selected)}: {records} record, "
        f"{len(selected) - records} document):"
    )
    for chunk in selected:
        lines.append(f"  - {_fmt_chunk(chunk)}")
    if discarded:
        reasons = {chunk.discard_reason for chunk in discarded}
        lines.append(
            f"- discarded: {len(discarded)} ({', '.join(sorted(str(r) for r in reasons))})"
        )
    lines.append(f"- events: {_fmt_events(events)}")
    lines.append(f"- context tokens: {result.answer.context_tokens}")
    if wall_ms is not None:
        lines.append(_fmt_timings(events, RAG_RERANK_STARTED, RAG_CANDIDATE_RERANKED, wall_ms))
    lines.append("")
    lines.extend(_fmt_answer(result.answer))
    return lines


def trace_g(
    tag: PipelineId,
    result: GraphRunResult,
    events: list[RetrievalEvent],
    wall_ms: float | None = None,
) -> list[str]:
    selected = [node for node in result.node_evidence if node.selected]
    discarded = [node for node in result.node_evidence if not node.selected]
    lines = [f"### Pipeline {tag}: {tag_label(tag)}", ""]

    resolved = [event.payload for event in events if event.event_type == GRAPH_ENTITY_RESOLVED]
    lines.append(f"- resolved entities ({len(resolved)}):")
    for payload in resolved:
        via = payload.get("via_concept")
        lines.append(
            f"  - `{payload['entity_id']}` ({payload['node_label']}, {payload['origin']}, "
            f"matched '{payload['matched_text']}'" + (f", via_concept `{via}`" if via else "") + ")"
        )
    expanded = next((e for e in events if e.event_type == GRAPH_QUERY_EXPANDED), None)
    if expanded is not None:
        lines.append(
            f"- graph.query.expanded: {expanded.payload['added_terms']} term(s) added, "
            f"search text {expanded.payload['expanded_length']} chars"
        )

    seeds = [
        event.payload["node_id"] for event in events if event.event_type == GRAPH_SEED_SELECTED
    ]
    lines.append(f"- seeds: {', '.join(f'`{seed}`' for seed in seeds) or '(none)'}")
    traversal = next((e for e in events if e.event_type == GRAPH_TRAVERSAL_STARTED), None)
    if traversal is not None:
        payload = traversal.payload
        lines.append(
            f"- limits: depth<={payload.get('max_depth')}, "
            f"nodes/hop<={payload.get('max_nodes_per_hop')}, "
            f"edges/node type<={payload.get('max_edges_per_node_type')}, "
            f"total<={payload.get('max_total_nodes')}, "
            f"rel types={payload.get('relationship_types')}, "
            f"ontology expansion={payload.get('ontology_expansion')}"
        )
    traversed = [e for e in events if e.event_type == GRAPH_RELATIONSHIP_TRAVERSED]
    lines.append(f"- edges traversed: {len(traversed)}")
    if result.ontology_concepts:
        lines.append(
            f"- ontology concepts: {', '.join(f'`{c}`' for c in result.ontology_concepts)}"
        )

    via_concept: dict[str, list[str]] = {}
    for event in events:
        concept = event.payload.get("via_concept")
        if event.event_type == GRAPH_NODE_DISCOVERED and concept:
            via_concept.setdefault(str(concept), []).append(str(event.payload["node_id"]))
    for concept, node_ids in sorted(via_concept.items()):
        shown = ", ".join(f"`{node_id}`" for node_id in node_ids[:VIA_CONCEPT_SHOWN])
        more = (
            f" (+{len(node_ids) - VIA_CONCEPT_SHOWN} more)"
            if len(node_ids) > VIA_CONCEPT_SHOWN
            else ""
        )
        lines.append(
            f"- discovered via_concept `{concept}`: {len(node_ids)} node(s): {shown}{more}"
        )

    doc_selected = [chunk for chunk in result.document_evidence if chunk.selected]
    records = sum(1 for chunk in doc_selected if chunk.kind == "record")
    lines.append(
        f"- selected context ({len(selected) + len(doc_selected)}: {len(selected)} node, "
        f"{records} record, {len(doc_selected) - records} document)"
    )
    lines.append(f"- selected node evidence ({len(selected)}):")
    for node in selected:
        facts = ""
        if node.authoritative is not None:
            facts = "; " + ", ".join(
                f"{key}={value}" for key, value in list(node.authoritative.items())[:8]
            )
        lines.append(
            f"  - `{node.node_id}` ({node.node_label}, {node.hops} hop(s) via "
            f"{node.rel_type}, score {node.score:.3f}, rerank {_fmt_score(node.rerank_score)}, "
            f"components {node.components}){facts}"
        )
    reasons: dict[str, int] = {}
    for node in discarded:
        reasons[str(node.discard_reason)] = reasons.get(str(node.discard_reason), 0) + 1
    lines.append(
        f"- discarded nodes: {len(discarded)}"
        + (f" ({', '.join(f'{r}={n}' for r, n in sorted(reasons.items()))})" if reasons else "")
    )
    if doc_selected:
        lines.append(f"- hybrid channel blocks, shared with A ({len(doc_selected)}):")
        for chunk in doc_selected:
            lines.append(f"  - {_fmt_chunk(chunk)}")
    lines.append(f"- events: {_fmt_events(events)}")
    lines.append(f"- context tokens: {result.answer.context_tokens}")
    if wall_ms is not None:
        lines.append(_fmt_timings(events, GRAPH_RERANK_STARTED, GRAPH_CANDIDATE_RERANKED, wall_ms))
    lines.append("")
    lines.extend(_fmt_answer(result.answer))
    return lines


def tag_label(tag: PipelineId) -> str:
    return {
        "A": "conventional RAG",
        "B": "graph relationships (no ontology)",
        "C": "graph relationships + enterprise ontology",
    }[tag]


def select_questions(questions: list[DemoQuestion], ids: list[str] | None) -> list[DemoQuestion]:
    """The demo questions with the given question ids, in demo order; all of them by default."""
    if not ids:
        return list(questions)
    known = {demo.question_id for demo in questions}
    unknown = sorted(set(ids) - known)
    if unknown:
        raise ValueError(f"Unknown demo question id(s): {', '.join(unknown)}")
    return [demo for demo in questions if demo.question_id in ids]


def main() -> None:
    try:
        bank = presentation_bank()
    except ApiError as error:
        raise SystemExit(error.message) from None
    if bank is None:
        raise SystemExit(bank_not_grounded())
    questions = demo_questions(bank)
    parser = argparse.ArgumentParser(description="Run side-by-side A/B/C traces")
    parser.add_argument(
        "--generator",
        choices=("fake", "litellm"),
        default="fake",
        help="answer generator (fake is deterministic; litellm uses the gateway)",
    )
    parser.add_argument(
        "--question",
        action="append",
        choices=[demo.question_id for demo in questions],
        help="demo question id to run, such as L05 (repeatable; default: all)",
    )
    parser.add_argument(
        "--pipeline",
        action="append",
        choices=PIPELINE_IDS,
        help="pipeline to run (repeatable; default: A, B and C)",
    )
    args = parser.parse_args()

    pipelines: tuple[PipelineId, ...] = tuple(args.pipeline) if args.pipeline else PIPELINE_IDS
    output = run_all(
        from_env(),
        GraphConfig.from_env(),
        args.generator,
        select_questions(questions, args.question),
        pipelines,
    )
    print(output)


if __name__ == "__main__":
    main()
