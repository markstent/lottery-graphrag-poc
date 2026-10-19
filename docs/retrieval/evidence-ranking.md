# Evidence Ranking

Status: implemented (HITL-08). Reference implementation:
`backend/app/retrieval/graph/ranking.py`. Worked examples:
`docs/retrieval/example-traces.md`.

## Principles

- Transparent: every component is recorded per candidate; no hidden rule
  favours graph results. The baseline must stay credible (AGENTS.md,
  Experimental Integrity).
- Shared by pipelines B and C; A is untouched. C differs from B only by the
  ontology relationships and concept seeds.
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
- `semantic_relevance`: cosine between the question vector and the node text
  (label + id + authoritative fact snippet) using the same embedding model as
  pipeline A. The graph never uses a different semantic model.
- `temporal_validity`: read from the authoritative row of the node.
  The end of the validity window is `retirement_date` for games, `retired_at` for platform versions, `end_at` for campaigns and experiments and `valid_to` for documents.
  Incidents and app versions have no end, so they are always current (a resolved incident stays a valid record).
  The component is 1.0 when the record has no end date or its end is on or after the reference date, and 0.3 when it ended before.
  The reference date is `GRAPH_REFERENCE_DATE` (an ISO date), defaulting to the end of the dataset window (2026-01-01).
  A node without an authoritative row is treated as current.

## Selection

- Nodes are ranked; the top `max_evidence_nodes` (default 12) non-seed nodes
  are selected.
- Seeds are always selected and recorded separately with `seed: true`; they
  do not consume the cap.
- Every non-selected candidate is kept with its components and a
  `discard_reason` (`below_score_limit`, or the budget reason from context
  selection). Discards are first-class telemetry for the UI.
- Context assembly then applies the shared token budget and dedupe threshold
  (`select_context`), identical to pipeline A.

## Fairness notes

- Identical components and weights are used for B and C; only the traversal
  allow-list differs (`MAPS_TO` removed in B).
- Node evidence is complementary to the chunk context: structured blocks are
  built from `SourceLookup` snippets of selected nodes, while documents come
  from the shared vector channel. The token budget applies to document chunks;
  structured snippets are short, curated fact lines, not free text.
- Do not tune any weight to make a specific scenario pass. Changes to this
  table are experimental-configuration changes and must be re-validated
  against the benchmark (Phase 10) before official runs.
