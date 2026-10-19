# GraphRAG

Code: `backend/app/retrieval/graph/`.
Example executions with real telemetry: `docs/retrieval/example-traces.md`.

## What changed in v2

In v1 the graph pipelines seeded from a semantic and id-pattern resolver, chose their nodes by graph score under their own cap and showed them as separate fact snippets on top of the document budget.
In v2 pipeline B resolves only ids and market names, and pipeline C adds the ontology term table, local-code bindings, query expansion and ranked concept expansion.
Every traversal node goes to the one shared judge together with A's document channel, and a node with a record block is judged and shown on exactly A's text for that row (D-025).
Document nodes are never traversal targets or candidates (D-026), and the fallback seed is the graph node of the top record hit (D-027).

## Purpose

Pipelines B and C add a bounded knowledge-graph walk above the same synthetic data layer that pipeline A uses.
The graph contributes:

- resolved seed entities and their authoritative source records
- causally connected structured records (platform versions, incidents, games, markets, players, payment instruments)
- evidence paths that can be replayed and inspected in the UI
- ontology expansion (pipeline C only): matched BusinessConcepts bring in their bound entities even when no structural edge reaches them

The graph is an augmentation layer, and documents never travel through it.

## Pipeline stages

```text
question
  -> entity resolution (B: ids and markets; C: plus ontology terms and bound codes)
  -> query expansion (C only: concept labels and synonyms appended)
  -> seed selection (resolved entities; else the graph node of the best record block)
  -> bounded traversal over the structured-record subgraph (Document targets excluded)
  -> ontology expansion (C only: most relevant MAPS_TO-bound entities of reached concepts)
  -> candidate scoring (docs/retrieval/evidence-ranking.md)
  -> structured channel: every traversal node in score order (excluded labels discarded)
  -> authoritative facts attached from the source tables (SourceLookup)
  -> document channel: the same hybrid search as pipeline A
  -> record blocks of structured candidates superseded
  -> one judge: the shared reranker scores both channels on the raw question
  -> one selection under the shared token budget and slot count
  -> the same generator and parameters as pipeline A
  -> answer + node evidence + document evidence + telemetry events
```

## Entity resolution and query expansion

Resolution is deterministic and model-free (`app/retrieval/graph/resolution.py`).

- Pipeline B uses `IdEntityResolver`: graph ids found in the question by id pattern and safe prefix (checked against the graph), then market names and codes as whole words (`origin` `id` or `market_alias`).
  It matches no ontology terms.
- Pipeline C uses `TermEntityResolver`, which runs the same id resolver first and then the ontology term matcher (`app/ontology/terms.py`) over every concept label, synonym and local display name in the four market languages.
  Each matched term yields its concept (`origin="term"`, confidence 0.8).
  When the matched text is the local display name of some of the concept's codes (whatever the term's source: "Zahlenziehung" is both a German label and an Austrian family name), it also yields those codes; otherwise it yields the concept's codes in the first market the id resolver found, if any (`origin="concept_binding"`, `via_concept` set, confidence 0.7).
  Codes without a graph node are skipped, and duplicates are removed in first-seen order.
- Pipeline C then expands the question (`QueryExpansion`): the labels (English first) and synonyms of every resolved concept are appended on a new line, joined by `; `.
  Each distinct term is added once, and not at all when the question already contains it as a whole word.
  The expanded text drives C's document-channel search (dense and sparse), the fallback seed search and the semantic ranking of graph nodes.
  The reranker and the generator always see the raw question, and pipelines A and B use the raw question everywhere.

## Traversal rules

The walk is breadth-first and undirected (`(a)-[r]-(b)`) over the structured-record subgraph.

- Relationship allow-list (`DEFAULT_RELATIONSHIP_TYPES` in `app/config/__init__.py`), 22 types for C and 19 for B, which drops the ontology types `MAPS_TO`, `SIMILAR_TO` and `IS_A`:
  `AFFECTS, AFFECTS_MARKET, AVAILABLE_IN, BELONGS_TO, CATEGORISED_AS, CONCERNS, FROM_MARKET, HAS_MECHANIC, INSTANCE_OF, IS_A, MAPS_TO, OF_TYPE, PROVIDED_BY, RELATED_TO, RELATED_TO_APP_VERSION, RELATED_TO_VERSION, RUNS_ON, SIMILAR_TO, TARGETS, USES, USES_PAYMENT, VERSION_OF`.
- Document nodes are not traversal targets: `GraphRagSettings.excluded_labels` defaults to `("Document",)` and is carried into B by `without_ontology()`.
  The neighbour statement drops excluded targets before the per-type cap, so a document never takes a permitted neighbour's place.
  `HAS_CHUNK` and `REFERENCES` are not in the allow-list either.
- Player-transactional edges (`PLAYS`, `EXPOSED_TO`, `AVAILABLE_VIA`, `PROMOTES`, `HAS_DRAW`, `DEPLOYED_TO`) are excluded because they fan out to thousands of neighbours.
  `USES` and `USES_PAYMENT` are included for every question and bounded by the caps.
- Caps (all configurable through `GRAPH_*` in `.env.example`): `max_depth=2`, `max_nodes_per_hop=100`, `max_edges_per_node_type=4` (per frontier node and relationship type) and `max_total_nodes=200`.
- Cut policy: when candidate edges exceed a hop budget, they are explored in relationship-strength order (`RELATIONSHIP_WEIGHTS`, the table ranking uses), ties broken by node id, so a cut is never alphabetical.
  Per-type slices inside the Cypher statement are ordered by relationship type and node id.
- A hard `LIMIT 5000` in `RETRIEVAL_NEIGHBOURS` (`app/graph/statements.py`) bounds the rows any single neighbour query returns.
- Every visited node keeps its discovery path (parent, relationship, hop distance, bottleneck path strength), so any evidence item can be replayed in the UI.

## Ontology expansion (pipeline C only)

After the structural walk, each reached `BusinessConcept` brings in its `MAPS_TO`-bound entities one hop behind the concept.
At most `max_edges_per_node_type` are taken per concept, ordered by semantic relevance to the expanded question (same node texts and dense model as ranking), ties by id, within the total node cap.
Entities already reached and entities with an excluded label are not candidates.
Injected nodes emit `graph.node.discovered` with `via_concept`.
Pipeline B has no ontology relationship types, no concept expansion and no term resolver, so B and C differ exactly by the ontology layer.

## Seeds

Seeds are the resolved entities, emitted as `graph.seed.selected`.
They anchor the traversal and are judged like every other node: a seed has no reserved slot, and its candidate events carry `seed: true`.
A directly resolved Document id may seed traversal, but it is discarded with `excluded_label`, and its chunks reach the model through the document channel.

When no entity resolves, the fallback searches the shared vector layer with A's models for the best record block (`kinds=["record"]`, `limit=1`; C uses its expanded text).
The seed is that record's graph node: the node id is the record id and the label comes from the record table (`source_lookup.label_for_table`), with `origin="vector_fallback"`.
No record hit means no seed: B and C then run on the document channel alone, and `graph.seed.selected` is absent.

## Document channel

Document retrieval is identical to pipeline A: same corpus, same dense and sparse models, same hybrid search and `top_k`, same market scope.
The only difference is C's expanded query text.
`EvidenceChunk.discovered_via` is `"vector"` for every chunk; the field stays in the schema so later phases can attach further provenance without a breaking change.

## Node text and authoritative facts

Each node has one text, used for semantic ranking, by the judge and in the prompt (`SourceLookup.node_text`):

- A node whose row has a record block in A's corpus gets that block's text, byte for byte (`record_texts_of` over the indexed corpus, keyed by record table and id).
- A node with authoritative columns but no record block (markets, platforms, channels, experiments, support cases) gets one humanised sentence: `<Label> <id>: <column name> <value>, ...`, missing values omitted.
- A BusinessConcept node in pipeline C gets its ontology text (`resolution.concept_text`): `Concept <canonical name>: <definition> Labels: ...; Synonyms: ...`.
- Anything else reads `<Label> <id>`.

In the prompt a selected node is formatted exactly like a document block (`docs/retrieval/context-budgeting.md`).
Structured candidates also get authoritative facts from the parquet source tables (`SourceLookup`, memoised), kept on `GraphEvidence.authoritative` and in the citations of selected nodes.
Quantitative claims in answers come from these records, not from document prose.
`PaymentMethod` facts are link-table derived: `accounts_sharing` plus up to `MAX_LINK_ROWS=8` account links from `player_payment_method.parquet`, with weight and first-used date.

## Telemetry

Events use the section 8 names and payloads in `docs/07-api-event-spec.md`.
Section 9 of that document describes an `ontology.concept.*` event family for the Semantic Layer screens; it is deferred to that phase, and section 8 governs current pipeline behaviour.

## Configuration

All settings live in `GraphRagSettings` (`app/config/__init__.py`), with `GRAPH_*` environment variables in `.env.example`.
Pipeline A never imports graph modules.

## Testing

- `backend/tests/test_resolution.py`: B and C resolvers, local-name and market bindings, query expansion, ranked and capped ontology expansion.
- `backend/tests/test_graph_rag.py`: offline fixture graph: caps, weight-ordered cuts, replayable paths, ontology expansion, transactional edges never traversed, excluded labels, score components, the one-judge call and its events, the record-anchored fallback seed, node texts and titles.
- `backend/tests/test_context_budget_v2.py`: mixed selection across kinds, supersession before judging, dedupe of chunks only, the shared budget.
- `backend/tests/test_graph_rag_live.py`: `GRAPH_E2E=1` against a real Neo4j (tiny world, seed 42): ingestion, A/B/C behaviour, determinism, B/C fairness.
  It wipes and re-ingests the tiny world; run `make ingest-graph` afterwards to restore the dev world.

## Failure modes

- Neo4j unreachable: `GraphReader` raises, and the API surfaces a typed error.
- Embedding backend unavailable: scoring raises before context assembly, and no answer is faked.
- Traversal caps reached: the caps are recorded on `graph.traversal.started` and the walk never exceeds them; edges beyond a cap are not followed or recorded.
