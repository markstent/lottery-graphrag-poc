"""Side-by-side A/B/C execution traces (docs/08 HITL-08).

Runs the same questions through pipeline A (conventional RAG), B (graph,
no ontology) and C (graph + ontology) against the live development world:
Qdrant (shared vector index), Neo4j (dev graph), Ollama embeddings, and the
configured generator. Prints a markdown trace per question so the output can
be committed verbatim as docs/retrieval/example-traces.md.

Usage:
    uv run python -m app.retrieval.graph.traces [--generator fake|litellm]

Requires: services up (make services-up), the dev graph ingested
(make ingest-graph) and the vector index built (make index-vector).
The truth ledger is never read here; questions are phrased from the public
benchmark_questions in the scenario library only.
"""

from __future__ import annotations

import argparse

from app.config import RetrievalSettings, from_env
from app.events import ListEventSink, RetrievalEvent
from app.evidence import GraphRunResult, RagRunResult
from app.graph.config import GraphConfig
from app.graph.config import from_env as from_graph_env
from app.retrieval.graph.lab import build_generator, build_lab, wired_pipelines

# Questions are the scenario library's own benchmark questions (HITL-05),
# phrased with the ids a support analyst would have open. The evaluator
# truth ledger is not consulted.
QUESTIONS: list[tuple[str, str, str, str | None]] = [
    (
        "SCN-007",
        "cross-market platform incident",
        (
            "Have we seen this digital checkout problem in other markets? "
            "Which platform version connects incident INC_S007_GR to the other "
            "markets, and why was the UK unaffected?"
        ),
        None,
    ),
    (
        "SCN-015",
        "document vs structured record conflict",
        (
            "What is the current ticket price for GAME_UK_01, and why does the "
            "rules document disagree with the source record?"
        ),
        None,
    ),
    (
        "SCN-003",
        "shared payment instrument cluster",
        (
            "Which accounts share payment instruments with PLAYER_GR_001283, "
            "and how many accounts are involved?"
        ),
        # Fraud-topology questions need the player-instrument relationship;
        # it is excluded from the default operational allow-list.
        "fraud",
    ),
]


def run_all(settings: RetrievalSettings, graph_config: GraphConfig, generator_name: str) -> str:
    lines: list[str] = []
    lab = build_lab(settings, build_generator(generator_name, settings))

    for scenario, label, question, profile in QUESTIONS:
        lines.append(f"## {scenario}: {label}")
        lines.append("")
        lines.append(f"**Question:** {question}")
        lines.append("")

        sink_a = ListEventSink()
        result_a = lab.pipeline_a(sink=sink_a).run(question)
        lines.extend(_trace_a(result_a, sink_a.events))

        wired = wired_pipelines(lab, graph_config, profile)
        try:
            for tag, pipeline in wired.pipelines:
                result_g = pipeline.run(question)
                lines.extend(_trace_g(tag, result_g, pipeline.events))
        finally:
            wired.reader.close()

        lines.append("")
    return "\n".join(lines)


def _fmt_events(events: list[RetrievalEvent]) -> str:
    counts: dict[str, int] = {}
    for event in events:
        counts[event.event_type] = counts.get(event.event_type, 0) + 1
    return ", ".join(f"{name}={count}" for name, count in sorted(counts.items()))


def _trace_a(result: RagRunResult, events: list[RetrievalEvent]) -> list[str]:
    selected = [chunk for chunk in result.evidence if chunk.selected]
    discarded = [chunk for chunk in result.evidence if not chunk.selected]
    lines = ["### Pipeline A: conventional RAG", ""]
    lines.append(f"- selected context ({len(selected)}):")
    for chunk in selected:
        lines.append(
            f"  - `{chunk.chunk_id}` {chunk.title} "
            f"(similarity {chunk.similarity:.3f}, rank {chunk.rank})"
        )
    if discarded:
        reasons = {chunk.discard_reason for chunk in discarded}
        lines.append(
            f"- discarded: {len(discarded)} ({', '.join(sorted(str(r) for r in reasons))})"
        )
    lines.append(f"- events: {_fmt_events(events)}")
    lines.append(f"- context tokens: {result.answer.context_tokens}")
    lines.append("")
    lines.append(f"**Answer** ({result.answer.model}, {result.answer.latency_ms:.0f} ms):")
    lines.append("")
    lines.append(result.answer.text)
    lines.append("")
    lines.append(f"**Citations:** {len(result.answer.citations)}")
    lines.append("")
    return lines


def _trace_g(tag: str, result: GraphRunResult, events: list[RetrievalEvent]) -> list[str]:
    selected = [node for node in result.node_evidence if node.selected]
    discarded = [node for node in result.node_evidence if not node.selected]
    lines = [f"### Pipeline {tag}: {tag_label(tag)}", ""]
    lines.append("- resolved seeds and traversal:")
    seeds = [
        event.payload["node_id"] for event in events if event.event_type == "graph.seed.selected"
    ]
    traversal = next(
        (event for event in events if event.event_type == "graph.traversal.started"), None
    )
    if traversal is not None:
        payload = traversal.payload
        lines.append(
            f"  - seeds: {', '.join(f'`{seed}`' for seed in seeds) or '(vector fallback)'}"
        )
        lines.append(
            f"  - limits: depth<={payload.get('max_depth')}, "
            f"nodes/hop<={payload.get('max_nodes_per_hop')}, "
            f"total<={payload.get('max_total_nodes')}, "
            f"rel types={payload.get('relationship_types')}"
        )
    traversed = [event for event in events if event.event_type == "graph.relationship.traversed"]
    if traversed:
        lines.append(f"  - edges traversed: {len(traversed)}")
    if result.ontology_concepts:
        lines.append(
            f"  - ontology concepts: {', '.join(f'`{c}`' for c in result.ontology_concepts)}"
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
            f"{node.rel_type}, score {node.score:.3f}, "
            f"components {node.components}){facts}"
        )
    lines.append(f"- discarded nodes: {len(discarded)}")
    doc_selected = [chunk for chunk in result.document_evidence if chunk.selected]
    if doc_selected:
        lines.append(f"- document chunks, shared vector channel ({len(doc_selected)}):")
        for chunk in doc_selected:
            lines.append(
                f"  - `{chunk.chunk_id}` {chunk.title} (similarity {chunk.similarity:.3f})"
            )
    lines.append(f"- events: {_fmt_events(events)}")
    lines.append(f"- context tokens: {result.answer.context_tokens}")
    lines.append("")
    lines.append(f"**Answer** ({result.answer.model}, {result.answer.latency_ms:.0f} ms):")
    lines.append("")
    lines.append(result.answer.text)
    lines.append("")
    lines.append(f"**Citations:** {len(result.answer.citations)}")
    lines.append("")
    return lines


def tag_label(tag: str) -> str:
    return {
        "B": "graph relationships (no ontology)",
        "C": "graph relationships + enterprise ontology",
    }[tag]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run side-by-side A/B/C traces")
    parser.add_argument(
        "--generator",
        choices=("fake", "litellm"),
        default="fake",
        help="answer generator (fake is deterministic; litellm uses the gateway)",
    )
    args = parser.parse_args()

    settings = from_env()
    graph_config = from_graph_env()
    output = run_all(settings, graph_config, args.generator)
    print(output)


if __name__ == "__main__":
    main()
