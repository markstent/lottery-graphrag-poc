# Evidence Ranking

Status: implemented (HITL-08). Reference implementation:
`backend/app/retrieval/graph/ranking.py`. Worked examples:
`docs/retrieval/example-traces.md`.

## Principles

- Transparent: every component is recorded per candidate; no hidden rule
  favours graph results. The baseline must stay credible (AGENTS.md,
  Experimental Integrity).
- Shared by pipelines B and C; A is untouched. C differs from B only by the
  ontology layer: ontology relationships, concept seeds, query expansion and concept texts.
- The relationship weight table is defined once
  (`RELATIONSHIP_WEIGHTS` in `app/retrieval/graph/traversal.py`) and is used
  for both ranking and traversal cut priority, so the two can never disagree.

## Score

```text
score = w_distance * graph_distance
      + w_relation * relationship_type
      + w_semantic * semantic_relevance
      + w_temporal * temporal_validity
```

Default weights (`DEFAULT_RANKING_WEIGHTS`, overridable per experiment):

| component          | weight | rationale                                              |
| ------------------ | ------ | ------------------------------------------------------ |
| graph_distance     | 0.25   | gentle decay keeps causally connected 2-hop records    |
| relationship_type  | 0.25   | path quality: bottleneck edge weight of the whole path |
| semantic_relevance | 0.35   | question alignment, shared embedding model with A      |
| temporal_validity  | 0.15   | superseded records rank lower, never disappear         |

## Components

- `graph_distance = 1 / (1 + hops / 2)`: 1.0 at the seeds, 0.667 at one hop,
  0.5 at two. Depth is capped at 2, so decay is bounded and a 2-hop causal
  link (incident -> platform version -> sibling incident) stays competitive.
- `relationship_type`: the **bottleneck** relationship weight along the
  discovered path (minimum edge weight from the seed to the node): evidence is
  as strong as its weakest link. A document referenced by an incident that was
  only reached through a weak market edge inherits the weak edge's strength.
  `SEED` and direct document edges (`REFERENCES`, `HAS_CHUNK`) weigh 1.0;
  `RELATED_TO_VERSION` 0.9; `AFFECTS` / `USES_PAYMENT` 0.8; market-level
  associations 0.4 to 0.6; `MAPS_TO` 0.5 (the ontology evidence path);
  unknown types default to 0.3.
- `semantic_relevance`: cosine between the question vector and the node text using the same embedding model as pipeline A.
  The node text is the one text a node has everywhere: the record block A indexes for the same row when one exists, else one humanised sentence from the authoritative columns, a concept's ontology text in pipeline C, or "<Label> <id>" for a node without facts.
  The graph never uses a different semantic model.
- `temporal_validity`: read from the authoritative row of the node.
  The end of the validity window is `retirement_date` for games, `retired_at` for platform versions, `end_at` for campaigns and experiments and `valid_to` for documents.
  Incidents and app versions have no end, so they are always current (a resolved incident stays a valid record).
  The component is 1.0 when the record has no end date or its end is on or after the reference date, and 0.3 when it ended before.
  The reference date is `GRAPH_REFERENCE_DATE` (an ISO date), defaulting to the end of the dataset window (2026-01-01).
  A node without an authoritative row is treated as current.

## Selection

- The composite score orders the structured channel, drives telemetry and supplies the lexical judge's incoming rank; it does not select context.
- Every traversal node (bounded by `max_total_nodes`) becomes a structured candidate, except nodes with an excluded label (default `Document`), which are discarded with `excluded_label`.
- Seeds get no special treatment: they usually rank first (distance and relationship components are 1.0) and are judged like every other node.
- The structured candidates and pipeline A's document channel are judged together by the shared reranker on the raw question, and one selection under the shared budget and slots decides what enters the context (`docs/retrieval/context-budgeting.md`).
- Every node keeps its components, its `rerank_score` (absent when it never reached the judge) and its outcome.
  A discarded node carries `excluded_label`, `out_of_scope_market`, or a selection reason (`context_budget`, `slot_limit`).
  Discards are first-class telemetry for the UI.

## Fairness notes

- Identical components and weights are used for B and C; only the traversal
  allow-list differs (`MAPS_TO` removed in B).
- Structured and document candidates compete for one token budget and one slot count under one judge; no channel has reserved slots.
  A node with a record block is judged on that record's exact text, so the judge cannot prefer a fact because of the channel it came through.
- Do not tune any weight to make a specific scenario pass. Changes to this
  table are experimental-configuration changes and must be re-validated
  against the benchmark (Phase 10) before official runs.
