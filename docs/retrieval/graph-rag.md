# GraphRAG

Status: implemented (HITL-08). Example executions with real telemetry:
`docs/retrieval/example-traces.md`.

## Purpose

Pipelines B and C add a bounded knowledge-graph walk above the same synthetic
data layer that pipeline A (conventional RAG) uses. The graph contributes:

- resolved seed entities and their authoritative source records
- causally connected structured records (platform versions, incidents,
  games, markets, players, payment instruments)
- evidence paths that can be replayed and inspected in the UI
- ontology expansion (pipeline C only): matched BusinessConcepts inject
  their bound entities even when no structural edge reaches them

The graph is an augmentation layer. Documents never travel through it.

## Pipeline stages

```text
question
  -> entity resolution (B: ids and markets; C: plus ontology terms and bound codes)
  -> query expansion (C only: concept labels and synonyms appended)
  -> seed selection (always selected, outside the evidence cap)
  -> bounded traversal over the structured-record subgraph
  -> ontology expansion (C only: most relevant MAPS_TO-bound entities of reached concepts)
  -> candidate scoring (see docs/retrieval/evidence-ranking.md)
  -> evidence selection (max_evidence_nodes, reasons recorded)
  -> authoritative facts attached from the source tables (SourceLookup)
  -> document retrieval: the SAME vector channel as pipeline A
  -> context assembly under the shared token budget
  -> the same generator, same parameters as pipeline A
  -> answer + node evidence + document evidence + telemetry events
```

## Entity resolution and query expansion

Resolution is deterministic and model-free (`app/retrieval/graph/resolution.py`).

- Pipeline B uses `IdEntityResolver`: graph ids found in the question by id pattern and safe prefix (checked against the graph), then market names and codes as whole words (`origin` `id` or `market_alias`).
  It never produces concepts.
- Pipeline C uses `TermEntityResolver`, which runs the same id resolver first and then the ontology term matcher (`app/ontology/terms.py`) over every concept label, synonym and local display name in the four market languages.
  Each matched term yields its concept (`origin="term"`, confidence 0.8).
  A local display name also yields the local code it names; a label or synonym yields the concept's codes in the market the question names, if any (`origin="concept_binding"`, `via_concept` set, confidence 0.7).
  Codes without a graph node are skipped; duplicates are removed in first-seen order.
- Pipeline C then expands the question (`QueryExpansion`): the labels (English first, the canonical name) and synonyms of every resolved concept are appended on a new line, joined by `; `.
  A term is added once, and not at all when the question already contains it as a whole word or it contains an earlier added term.
  The expanded text drives C's document-channel embeddings (dense and sparse), the fallback seed search and the semantic ranking of graph nodes.
  The reranker and the generator always see the raw question, and pipelines A and B use the raw question everywhere.

## Traversal rules

The walk is breadth-first over the **structured-record subgraph**:

- Relationship allow-list (`DEFAULT_RELATIONSHIP_TYPES` in
  `app/config/__init__.py`, 14 types):
  `AFFECTS, AFFECTS_MARKET, AVAILABLE_IN, BELONGS_TO, CONCERNS, FROM_MARKET,
  INSTANCE_OF, MAPS_TO, RELATED_TO, RELATED_TO_VERSION, RUNS_ON, SIMILAR_TO,
  TARGETS, VERSION_OF`.
- Documents and chunks are excluded on purpose. The vector layer owns
  document retrieval for every pipeline (retrieval fairness); document edges
  would spend traversal budget on leaf nodes whose content the shared corpus
  already provides.
- Player-transactional edges (`PLAYS`, `EXPOSED_TO`, `USES`, `AVAILABLE_VIA`,
  `PROMOTES`, `HAS_DRAW`, `DEPLOYED_TO`, `RELATED_TO_APP_VERSION`) are
  excluded: they fan out to thousands of neighbours. Fraud-topology questions
  (SCN-003 profile) add `USES_PAYMENT` and `USES` per run through
  configuration, never through code branching.
- Traversal is undirected: `(a)-[r]-(b)`.
- Caps (all configurable, defaults in `.env.example`):
  - `max_depth=2`
  - `max_nodes_per_hop=100`
  - `max_edges_per_node_type=4` (per frontier node, per relationship type)
  - `max_total_nodes=200`
  - `max_evidence_nodes=12`
- **Cut policy:** when candidate edges exceed a hop budget, they are explored
  in relationship-strength order (the same transparent weight table used by
  ranking, `RELATIONSHIP_WEIGHTS` in `app/retrieval/graph/traversal.py`), ties
  broken by node id. A budget cut is therefore never alphabetical and never
  silently biased against particular id formats. Per-type slices inside the
  Cypher statement are deterministic (`ORDER BY rel_type, to_id`).
- A hard `LIMIT 5000` in `RETRIEVAL_NEIGHBOURS` bounds the row count returned
  by any single neighbour query (safety ceiling, documented in
  `app/graph/statements.py`).
- Every visited node keeps its discovery path (`parents`, `relationships`,
  hop distance, bottleneck path strength) so any evidence item can be replayed
  in the UI.

## Ontology expansion (pipeline C only)

After the structural walk, each reached `BusinessConcept` injects its
`MAPS_TO`-bound entities one hop behind the concept: at most
`max_edges_per_node_type` per concept, ordered by semantic relevance to the
expanded question (same node texts and embedding model as ranking), ties by
id, subject to the total node cap. Injected nodes emit `graph.node.discovered`
with `via_concept`. Pipeline B filters `MAPS_TO` from the allow-list
(`GraphRagSettings.without_ontology()`) and its resolver never produces
concepts, so B and C differ exactly by the ontology layer: same allow-list
otherwise, same limits, same weights.

## Seeds

Seeds are query anchors: always selected and emitted with `seed: true`, and
they do not consume `max_evidence_nodes`. Seed events are separate from
candidate events (docs/07-api-event-spec.md section 8).

## Document channel (fairness)

Document retrieval is identical to pipeline A: same corpus, same embedding
model, same `top_k`, same reranker, same `select_context` budget and dedupe.
The only difference is pipeline C's expanded query text for the dense and
sparse search (see above).
The graph adds structured records and paths, not a second document channel.
`EvidenceChunk.discovered_via` is `"vector"` for every chunk; the field stays
in the schema so later phases can attach further provenance without a
breaking change.

## Authoritative facts

Selected structured nodes get authoritative facts fetched from the parquet
source tables (`SourceLookup`, memoised). Quantitative claims in answers come
from these records, not from document prose. `PaymentMethod` nodes are
link-table derived: facts are the account links from
`player_payment_method.parquet` (`accounts_sharing` plus up to
`MAX_LINK_ROWS=8` rendered links with weight and first-used date).

## Telemetry

Events use the section 8 names from `docs/07-api-event-spec.md`
(`graph.entity.resolved` with `via_concept`, `graph.query.expanded` with
`added_terms` and `expanded_length` (pipeline C only),
`graph.traversal.started`, `graph.node.discovered` (with `via_concept` for
ontology-injected nodes),
`graph.relationship.traversed`, `graph.ontology.expanded`,
`graph.evidence_path.completed`, `graph.candidate.selected|discarded`,
`graph.context.assembled`, `graph.generation.*`).

Known discrepancy: section 9 of the same document describes an
`ontology.concept.*` event family for the Semantic Layer screens. That family
is deferred to the Semantic Layer phase; section 8 governs current pipeline
behaviour. The spec will be reconciled when those screens are built.

## Configuration

All settings live in `GraphRagSettings` (`app/config/__init__.py`) with
`GRAPH_*` environment variables documented in `.env.example`. Standard-RAG
configuration is unaffected: `RetrievalSettings.graph` has a default factory,
and pipeline A never imports graph modules.

## Testing

- `backend/tests/test_resolution.py`: B and C resolvers, local-name and
  market bindings, query expansion, ranked and capped ontology expansion.
- `backend/tests/test_graph_rag.py`: offline fixture graph: caps,
  weight-ordered cuts, replayable paths, ontology expansion, seeds outside
  the cap, transactional edges never traversed, truth-ledger isolation,
  score-component checks against `DEFAULT_RANKING_WEIGHTS`.
- `backend/tests/test_graph_rag_live.py`: `GRAPH_E2E=1` against a real Neo4j
  (tiny world, seed 42): ingestion, A/B/C behaviour, determinism, B/C
  fairness. Wipes and re-ingests the tiny world; run `make ingest-graph`
  afterwards to restore the dev world.

## Failure modes

- Neo4j unreachable: `GraphReader` raises; the API surfaces a typed error.
- Embedding backend unavailable: scoring raises before context assembly;
  no answer is faked.
- Traversal caps hit: cut points are recorded in telemetry; the walk never
  exceeds the documented budgets.
