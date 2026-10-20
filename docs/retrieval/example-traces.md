# Example Traces: A/B/C Retrieval Comparison

Status: HITL-08 artefact, regenerated for pipelines v2 against the development world.

## What this document is

Verbatim output of the side-by-side trace CLI over the demo questions of the frozen bank.
Each question runs through three retrieval pipelines:

- **A, conventional RAG**: dense (bge-m3) plus sparse embedding, hybrid search fused by reciprocal rank, cross-encoder reranking, one shared context budget and slot limit, generation.
  The index holds document chunks and structured record blocks, so A can retrieve table rows as well as document text.
- **B, graph relationships**: an id and market resolver seeds a bounded traversal over the structured-record subgraph (when nothing resolves, the graph node of the best-matching record block); every traversal node joins A's document channel as a structured candidate, judged and shown as the record block A indexes for its row (or only `<Label> <id>` when the row has none); nodes carry authoritative facts from the source tables for citations.
  No ontology: no concept seeds, no `MAPS_TO` expansion, no query expansion.
- **C, graph relationships + enterprise ontology**: B plus the ontology term resolver (concept seeds and concept-bound entities, shown as `via_concept`), query expansion with concept labels and synonyms (`graph.query.expanded`), and ontology expansion during traversal.

Same question, same synthetic world, same embedding model, one reranker that judges every candidate against the raw question, same generator and prompt (the selection in judge order), one context budget and slot count.
Only the retrieval layers differ.

## How it was produced

```bash
make index-vector   # hybrid dense + sparse index in Qdrant
make ingest-graph   # development world graph in Neo4j
cd backend
uv run python -m app.traces --generator fake
```

The answers come from the deterministic fake generator, which returns the structured JSON answer (verdict plus prose with [n] citations) built from the context titles only.
The timings line (run wall clock, and judge time from the rerank events) is measured and varies run to run.
Everything else (resolution, seeds, traversal, scores, discards, budgets) is the real retrieval telemetry and is reproducible run to run.
Run with `--generator litellm` and `GENERATION_MODEL` set to see a real model answer.

The evaluator truth ledger is not consulted anywhere in this pipeline.

## How to read a trace

- *selected context*: how many graph nodes, record blocks and document chunks the one selection placed in context; for A and the shared document channel, each block with its kind (`chunk` for document text, `record` for a table row), fused score, dense and sparse ranks, cross-encoder score and final rank.
- *resolved entities* (B, C): resolver output with its origin; concept-bound entities name the concept they came through (`via_concept`).
- *graph.query.expanded* (C): how many concept terms were added to the search text.
- *discovered via_concept* (C): nodes reached through ontology expansion, grouped by the concept that bound them.
- *selected node evidence*: graph nodes chosen as evidence with hop distance, relationship, graph score components, cross-encoder score and authoritative facts.
- *events*: counts of the structured telemetry stream that drives the UI.
- *Answer*: the parsed verdict, the prose answer and the cited context blocks.

---

## L05: stratum H1

**Question:** Which other markets had incidents on the same platform version as incident INC_037?

### Pipeline A: conventional RAG

- selected context (12: 12 record, 0 document):
  - `REC_incidents_INC_037` [record incidents] incidents: INC_037 (fused 0.0286, dense rank 22, sparse rank 1, rerank 2.829, rank 1)
  - `REC_incidents_INC_017` [record incidents] incidents: INC_017 (fused 0.0159, dense rank 3, sparse rank None, rerank -0.360, rank 2)
  - `REC_incidents_INC_027` [record incidents] incidents: INC_027 (fused 0.0294, dense rank 1, sparse rank 17, rerank -0.601, rank 3)
  - `REC_incidents_INC_030` [record incidents] incidents: INC_030 (fused 0.0284, dense rank 10, sparse rank 11, rerank -0.666, rank 4)
  - `REC_incidents_INC_032` [record incidents] incidents: INC_032 (fused 0.0289, dense rank 6, sparse rank 13, rerank -1.160, rank 5)
  - `REC_incidents_INC_003` [record incidents] incidents: INC_003 (fused 0.0276, dense rank 19, sparse rank 7, rerank -1.232, rank 6)
  - `REC_incidents_INC_038` [record incidents] incidents: INC_038 (fused 0.0243, dense rank 15, sparse rank 31, rerank -1.566, rank 7)
  - `REC_incidents_INC_036` [record incidents] incidents: INC_036 (fused 0.0292, dense rank 7, sparse rank 10, rerank -1.622, rank 8)
  - `REC_incidents_INC_031` [record incidents] incidents: INC_031 (fused 0.0132, dense rank 16, sparse rank None, rerank -1.652, rank 9)
  - `REC_incidents_INC_010` [record incidents] incidents: INC_010 (fused 0.0271, dense rank 21, sparse rank 8, rerank -2.018, rank 10)
  - `REC_incidents_INC_042` [record incidents] incidents: INC_042 (fused 0.0250, dense rank 14, sparse rank 27, rerank -2.020, rank 11)
  - `REC_incidents_INC_040` [record incidents] incidents: INC_040 (fused 0.0243, dense rank 24, sparse rank 21, rerank -2.057, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1444
- timings: run 2651 ms, judge 2572 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: incidents: INC_037, incidents: INC_017 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `INC_037` (Incident, id, matched 'INC_037')
- seeds: `INC_037`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 40
- selected context (12: 4 node, 8 record, 0 document)
- selected node evidence (4):
  - `INC_037` (Incident, 0 hop(s) via SEED, score 0.863, rerank 2.829, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.607925, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_037, incident_id=INC_037, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-02-07 01:59:28, resolved_at=2025-02-07 02:51:28
  - `SUP_00113` (SupportCase, 1 hop(s) via RELATED_TO, score 0.603, rerank 1.038, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.46188, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00113, support_case_id=SUP_00113, market_id=MKT_UK, category_code=SUPC_UK_TECHNICAL, opened_at=2025-03-05 13:59:58, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00121` (SupportCase, 1 hop(s) via RELATED_TO, score 0.602, rerank 1.703, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.458436, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00121, support_case_id=SUP_00121, market_id=MKT_UK, category_code=SUPC_UK_GAME, opened_at=2025-02-20 10:12:09, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00005` (SupportCase, 1 hop(s) via RELATED_TO, score 0.594, rerank 0.907, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.435265, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00005, support_case_id=SUP_00005, market_id=MKT_UK, category_code=SUPC_UK_GAME, opened_at=2025-03-19 00:17:55, summary_text=Synthetic support contact describing a player-reported issue.
- discarded nodes: 37 (slot_limit=37)
- hybrid channel blocks, shared with A (8):
  - `REC_incidents_INC_017` [record incidents] incidents: INC_017 (fused 0.0159, dense rank 3, sparse rank None, rerank -0.360, rank 5)
  - `REC_incidents_INC_027` [record incidents] incidents: INC_027 (fused 0.0294, dense rank 1, sparse rank 17, rerank -0.601, rank 6)
  - `REC_incidents_INC_030` [record incidents] incidents: INC_030 (fused 0.0284, dense rank 10, sparse rank 11, rerank -0.666, rank 7)
  - `REC_incidents_INC_032` [record incidents] incidents: INC_032 (fused 0.0289, dense rank 6, sparse rank 13, rerank -1.160, rank 8)
  - `REC_incidents_INC_003` [record incidents] incidents: INC_003 (fused 0.0276, dense rank 19, sparse rank 7, rerank -1.232, rank 9)
  - `REC_incidents_INC_038` [record incidents] incidents: INC_038 (fused 0.0243, dense rank 15, sparse rank 31, rerank -1.566, rank 10)
  - `REC_incidents_INC_036` [record incidents] incidents: INC_036 (fused 0.0292, dense rank 7, sparse rank 10, rerank -1.622, rank 11)
  - `REC_incidents_INC_031` [record incidents] incidents: INC_031 (fused 0.0132, dense rank 16, sparse rank None, rerank -1.652, rank 12)
- events: graph.candidate.discarded=69, graph.candidate.reranked=75, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=40, graph.relationship.traversed=40, graph.rerank.started=1, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 1357
- timings: run 5781 ms, judge 4690 ms over 75 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: incidents: INC_037, support_cases: SUP_00121 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (2):
  - `INC_037` (Incident, id, matched 'INC_037')
  - `CONCEPT_INCIDENT` (BusinessConcept, term, matched 'incident')
- graph.query.expanded: 9 term(s) added, search text 187 chars
- seeds: `INC_037`, `CONCEPT_INCIDENT`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 59
- ontology concepts: `CONCEPT_APPLICATION_INCIDENT`, `CONCEPT_DRAW_INCIDENT`, `CONCEPT_IDENTITY_INCIDENT`, `CONCEPT_INCIDENT`, `CONCEPT_PLATFORM_INCIDENT`
- discovered via_concept `CONCEPT_APPLICATION_INCIDENT`: 4 node(s): `ITYPE_AT_APP`, `ITYPE_CZ_APLIKACE`, `ITYPE_GR_EFARMOGI`, `ITYPE_UK_APP_STABILITY`
- discovered via_concept `CONCEPT_DRAW_INCIDENT`: 4 node(s): `ITYPE_GR_KLIROSI`, `ITYPE_CZ_LOSOVANI`, `ITYPE_CORP_DRAW`, `ITYPE_UK_DRAW_DELAY`
- discovered via_concept `CONCEPT_IDENTITY_INCIDENT`: 4 node(s): `ITYPE_CZ_PRIHLASENI`, `ITYPE_GR_SYNDESI`, `ITYPE_CORP_IDENTITY`, `ITYPE_AT_ANMELDUNG`
- selected context (12: 4 node, 8 record, 0 document)
- selected node evidence (4):
  - `INC_037` (Incident, 0 hop(s) via SEED, score 0.863, rerank 2.829, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.609215, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_037, incident_id=INC_037, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-02-07 01:59:28, resolved_at=2025-02-07 02:51:28
  - `SUP_00113` (SupportCase, 1 hop(s) via RELATED_TO, score 0.622, rerank 1.038, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.514359, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00113, support_case_id=SUP_00113, market_id=MKT_UK, category_code=SUPC_UK_TECHNICAL, opened_at=2025-03-05 13:59:58, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00121` (SupportCase, 1 hop(s) via RELATED_TO, score 0.616, rerank 1.703, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.497521, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00121, support_case_id=SUP_00121, market_id=MKT_UK, category_code=SUPC_UK_GAME, opened_at=2025-02-20 10:12:09, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00005` (SupportCase, 1 hop(s) via RELATED_TO, score 0.610, rerank 0.907, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.47967, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00005, support_case_id=SUP_00005, market_id=MKT_UK, category_code=SUPC_UK_GAME, opened_at=2025-03-19 00:17:55, summary_text=Synthetic support contact describing a player-reported issue.
- discarded nodes: 57 (slot_limit=57)
- hybrid channel blocks, shared with A (8):
  - `REC_support_cases_SUP_01211` [record support_cases] support_cases: SUP_01211 (fused 0.0130, dense rank None, sparse rank 17, rerank 1.475, rank 3)
  - `REC_incidents_INC_027` [record incidents] incidents: INC_027 (fused 0.0260, dense rank 3, sparse rank 39, rerank -0.601, rank 6)
  - `REC_incidents_INC_032` [record incidents] incidents: INC_032 (fused 0.0264, dense rank 2, sparse rank 37, rerank -1.160, rank 7)
  - `REC_incidents_INC_003` [record incidents] incidents: INC_003 (fused 0.0246, dense rank 13, sparse rank 32, rerank -1.232, rank 8)
  - `REC_incidents_INC_038` [record incidents] incidents: INC_038 (fused 0.0125, dense rank 20, sparse rank None, rerank -1.566, rank 9)
  - `REC_incidents_INC_036` [record incidents] incidents: INC_036 (fused 0.0269, dense rank 1, sparse rank 35, rerank -1.622, rank 10)
  - `REC_incidents_INC_031` [record incidents] incidents: INC_031 (fused 0.0135, dense rank 14, sparse rank None, rerank -1.652, rank 11)
  - `REC_incidents_INC_010` [record incidents] incidents: INC_010 (fused 0.0239, dense rank 16, sparse rank 33, rerank -2.018, rank 12)
- events: graph.candidate.discarded=89, graph.candidate.reranked=90, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=59, graph.ontology.expanded=3, graph.query.expanded=1, graph.relationship.traversed=59, graph.rerank.started=1, graph.seed.selected=2, graph.traversal.started=1
- context tokens: 1321
- timings: run 7338 ms, judge 5484 ms over 90 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: incidents: INC_037, support_cases: SUP_00121 [1].


## L09: stratum H2

**Question:** Which games in other markets belong to the same kind of game family as game GAME_AT_05?

### Pipeline A: conventional RAG

- selected context (12: 2 record, 10 document):
  - `CHNK_0066_00` [chunk] Post Incident Review: Authentication outage (INC_011) (fused 0.0284, dense rank 17, sparse rank 5, rerank 3.123, rank 1)
  - `REC_games_GAME_AT_05` [record games] games: GAME_AT_05 (fused 0.0156, dense rank 4, sparse rank None, rerank 2.181, rank 2)
  - `CHNK_0201_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0274, dense rank 1, sparse rank 31, rerank -0.998, rank 3)
  - `CHNK_0206_00` [chunk] Meeting Note: Lioness Instant (GAME_UK_05) (fused 0.0161, dense rank 2, sparse rank None, rerank -1.202, rank 4)
  - `CHNK_0017_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0255, dense rank 6, sparse rank 37, rerank -2.543, rank 5)
  - `CHNK_0149_00` [chunk] Meeting Note: Lioness Instant (GAME_UK_05) (fused 0.0161, dense rank None, sparse rank 2, rerank -2.813, rank 6)
  - `CHNK_0008_00` [chunk] Product Spec: SwiftSix (GAME_UK_06) (fused 0.0152, dense rank None, sparse rank 6, rerank -2.819, rank 7)
  - `CHNK_0073_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0156, dense rank None, sparse rank 4, rerank -2.862, rank 8)
  - `CHNK_0048_00` [chunk] Monthly Market Review: Alpen Star (GAME_AT_04) (fused 0.0159, dense rank 3, sparse rank None, rerank -2.931, rank 9)
  - `CHNK_0009_00` [chunk] Product Spec: Danube Classic (GAME_AT_01) (fused 0.0122, dense rank None, sparse rank 22, rerank -2.937, rank 10)
  - `REC_incidents_INC_005` [record incidents] incidents: INC_005 (fused 0.0123, dense rank 21, sparse rank None, rerank -2.948, rank 11)
  - `CHNK_0207_00` [chunk] Product Spec: SwiftSix (GAME_UK_06) (fused 0.0164, dense rank None, sparse rank 1, rerank -3.043, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1216
- timings: run 2472 ms, judge 2402 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: Post Incident Review: Authentication outage (INC_011), games: GAME_AT_05 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `GAME_AT_05` (Game, id, matched 'GAME_AT_05')
- seeds: `GAME_AT_05`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 58
- selected context (12: 10 node, 0 record, 2 document)
- selected node evidence (10):
  - `GAME_AT_05` (Game, 0 hop(s) via SEED, score 0.836, rerank 2.181, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.530045, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.686, rerank 0.925, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.483762, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `INC_003` (Incident, 1 hop(s) via AFFECTS, score 0.680, rerank -0.001, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.465429, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_003, incident_id=INC_003, market_id=MKT_AT, severity=HIGH, incident_type=ITYPE_AT_APP, started_at=2025-07-20 17:37:32, resolved_at=2025-07-21 00:39:32
  - `INC_011` (Incident, 1 hop(s) via AFFECTS, score 0.662, rerank 1.179, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.415236, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_011, incident_id=INC_011, market_id=-, severity=HIGH, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-08-27 08:02:54, resolved_at=2025-08-29 07:53:54
  - `INC_019` (Incident, 1 hop(s) via AFFECTS, score 0.660, rerank 1.276, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.409362, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_019, incident_id=INC_019, market_id=-, severity=MEDIUM, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-10-23 03:38:50, resolved_at=2025-10-24 19:01:50
  - `SUP_00047` (SupportCase, 1 hop(s) via CONCERNS, score 0.636, rerank 0.631, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.411274, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00047, support_case_id=SUP_00047, market_id=MKT_AT, category_code=SUPC_AT_ZAHLUNG, opened_at=2025-07-20 19:03:09, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00035` (SupportCase, 1 hop(s) via CONCERNS, score 0.632, rerank 0.908, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.401247, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00035, support_case_id=SUP_00035, market_id=MKT_AT, category_code=SUPC_AT_SPIEL, opened_at=2025-07-20 11:53:00, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00079` (SupportCase, 1 hop(s) via CONCERNS, score 0.631, rerank 0.860, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.399312, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00079, support_case_id=SUP_00079, market_id=MKT_AT, category_code=SUPC_AT_KONTO, opened_at=2025-07-29 12:06:55, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00031` (SupportCase, 1 hop(s) via CONCERNS, score 0.627, rerank 0.430, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.385519, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00031, support_case_id=SUP_00031, market_id=MKT_AT, category_code=SUPC_AT_TECHNIK, opened_at=2025-04-22 03:05:21, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00707` (SupportCase, 2 hop(s) via RELATED_TO, score 0.550, rerank 0.926, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.428022, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00707, support_case_id=SUP_00707, market_id=MKT_AT, category_code=SUPC_AT_TECHNIK, opened_at=2025-12-25 08:20:19, summary_text=Synthetic support contact describing a player-reported issue.
- discarded nodes: 49 (slot_limit=49)
- hybrid channel blocks, shared with A (2):
  - `CHNK_0066_00` [chunk] Post Incident Review: Authentication outage (INC_011) (fused 0.0284, dense rank 17, sparse rank 5, rerank 3.123, rank 1)
  - `CHNK_0201_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0274, dense rank 1, sparse rank 31, rerank -0.998, rank 12)
- events: graph.candidate.discarded=87, graph.candidate.reranked=98, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=58, graph.relationship.traversed=58, graph.rerank.started=1, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 1176
- timings: run 7617 ms, judge 5868 ms over 98 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: Post Incident Review: Authentication outage (INC_011), games: GAME_AT_05 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (1):
  - `GAME_AT_05` (Game, id, matched 'GAME_AT_05')
- graph.query.expanded: 0 term(s) added, search text 87 chars
- seeds: `GAME_AT_05`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 101
- ontology concepts: `CONCEPT_INSTANT_PRODUCT`, `CONCEPT_RETAIL_INSTANT`, `CONCEPT_SYMBOL_REVEAL`
- discovered via_concept `CONCEPT_INSTANT_PRODUCT`: 1 node(s): `CAT_UK_INSTANT`
- discovered via_concept `CONCEPT_RETAIL_INSTANT`: 1 node(s): `FAM_UK_SCRATCHCARD`
- discovered via_concept `CONCEPT_SYMBOL_REVEAL`: 1 node(s): `MECH_UK_SCRATCH`
- selected context (12: 10 node, 0 record, 2 document)
- selected node evidence (10):
  - `GAME_AT_05` (Game, 0 hop(s) via SEED, score 0.836, rerank 2.181, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.530045, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.686, rerank 0.925, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.483762, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `INC_003` (Incident, 1 hop(s) via AFFECTS, score 0.680, rerank -0.001, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.465429, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_003, incident_id=INC_003, market_id=MKT_AT, severity=HIGH, incident_type=ITYPE_AT_APP, started_at=2025-07-20 17:37:32, resolved_at=2025-07-21 00:39:32
  - `INC_011` (Incident, 1 hop(s) via AFFECTS, score 0.662, rerank 1.179, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.415236, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_011, incident_id=INC_011, market_id=-, severity=HIGH, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-08-27 08:02:54, resolved_at=2025-08-29 07:53:54
  - `INC_019` (Incident, 1 hop(s) via AFFECTS, score 0.660, rerank 1.276, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.409362, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_019, incident_id=INC_019, market_id=-, severity=MEDIUM, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-10-23 03:38:50, resolved_at=2025-10-24 19:01:50
  - `SUP_00047` (SupportCase, 1 hop(s) via CONCERNS, score 0.636, rerank 0.631, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.411274, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00047, support_case_id=SUP_00047, market_id=MKT_AT, category_code=SUPC_AT_ZAHLUNG, opened_at=2025-07-20 19:03:09, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00035` (SupportCase, 1 hop(s) via CONCERNS, score 0.632, rerank 0.908, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.401247, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00035, support_case_id=SUP_00035, market_id=MKT_AT, category_code=SUPC_AT_SPIEL, opened_at=2025-07-20 11:53:00, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00079` (SupportCase, 1 hop(s) via CONCERNS, score 0.631, rerank 0.860, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.399312, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00079, support_case_id=SUP_00079, market_id=MKT_AT, category_code=SUPC_AT_KONTO, opened_at=2025-07-29 12:06:55, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00031` (SupportCase, 1 hop(s) via CONCERNS, score 0.627, rerank 0.430, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.385519, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00031, support_case_id=SUP_00031, market_id=MKT_AT, category_code=SUPC_AT_TECHNIK, opened_at=2025-04-22 03:05:21, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00707` (SupportCase, 2 hop(s) via RELATED_TO, score 0.550, rerank 0.926, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.428022, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00707, support_case_id=SUP_00707, market_id=MKT_AT, category_code=SUPC_AT_TECHNIK, opened_at=2025-12-25 08:20:19, summary_text=Synthetic support contact describing a player-reported issue.
- discarded nodes: 92 (slot_limit=92)
- hybrid channel blocks, shared with A (2):
  - `CHNK_0066_00` [chunk] Post Incident Review: Authentication outage (INC_011) (fused 0.0284, dense rank 17, sparse rank 5, rerank 3.123, rank 1)
  - `CHNK_0201_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0274, dense rank 1, sparse rank 31, rerank -0.998, rank 12)
- events: graph.candidate.discarded=130, graph.candidate.reranked=141, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=101, graph.ontology.expanded=3, graph.query.expanded=1, graph.relationship.traversed=101, graph.rerank.started=1, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 1176
- timings: run 11019 ms, judge 8253 ms over 141 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: Post Incident Review: Authentication outage (INC_011), games: GAME_AT_05 [1].


## L01: stratum H3

**Question:** What is the ticket price of game GAME_AT_04?

### Pipeline A: conventional RAG

- selected context (12: 11 record, 1 document):
  - `REC_games_GAME_AT_04` [record games] games: GAME_AT_04 (fused 0.0323, dense rank 3, sparse rank 1, rerank 6.363, rank 1)
  - `REC_games_GAME_GR_04` [record games] games: GAME_GR_04 (fused 0.0301, dense rank 1, sparse rank 13, rerank 1.644, rank 2)
  - `REC_games_GAME_UK_04` [record games] games: GAME_UK_04 (fused 0.0304, dense rank 2, sparse rank 10, rerank 1.454, rank 3)
  - `REC_campaigns_CMP_010` [record campaigns] campaigns: CMP_010 (fused 0.0260, dense rank 13, sparse rank 21, rerank 0.926, rank 4)
  - `REC_games_GAME_AT_03` [record games] games: GAME_AT_03 (fused 0.0303, dense rank 6, sparse rank 6, rerank -0.169, rank 5)
  - `REC_games_GAME_CZ_04` [record games] games: GAME_CZ_04 (fused 0.0295, dense rank 5, sparse rank 11, rerank -0.460, rank 6)
  - `REC_campaigns_CMP_009` [record campaigns] campaigns: CMP_009 (fused 0.0123, dense rank 21, sparse rank None, rerank -0.479, rank 7)
  - `REC_games_GAME_AT_02` [record games] games: GAME_AT_02 (fused 0.0275, dense rank 8, sparse rank 18, rerank -1.207, rank 8)
  - `REC_games_GAME_AT_05` [record games] games: GAME_AT_05 (fused 0.0281, dense rank 16, sparse rank 7, rerank -1.380, rank 9)
  - `REC_games_GAME_AT_01` [record games] games: GAME_AT_01 (fused 0.0288, dense rank 4, sparse rank 16, rerank -1.436, rank 10)
  - `CHNK_0230_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0224, dense rank 37, sparse rank 23, rerank -1.918, rank 11)
  - `REC_campaigns_CMP_002` [record campaigns] campaigns: CMP_002 (fused 0.0114, dense rank 28, sparse rank None, rerank -2.368, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 904
- timings: run 1945 ms, judge 1884 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: games: GAME_AT_04, games: GAME_GR_04 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `GAME_AT_04` (Game, id, matched 'GAME_AT_04')
- seeds: `GAME_AT_04`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 64
- selected context (12: 6 node, 5 record, 1 document)
- selected node evidence (6):
  - `GAME_AT_04` (Game, 0 hop(s) via SEED, score 0.877, rerank 6.363, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.647549, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_04, game_id=GAME_AT_04, game_name=Alpen Star, market_id=MKT_AT, game_family_id=FAM_AT_ZUSATZSPIEL, ticket_price=1.00, currency_code=EUR
  - `GAME_AT_03` (Game, 2 hop(s) via AFFECTS, score 0.685, rerank -0.169, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.599527, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_03, game_id=GAME_AT_03, game_name=Wiener Zahlen, market_id=MKT_AT, game_family_id=FAM_AT_SCHNELLZIEHUNG, ticket_price=1.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.682, rerank -2.005, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.472639, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `GAME_AT_02` (Game, 2 hop(s) via AFFECTS, score 0.680, rerank -1.207, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.585798, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_AT_LAENDER_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_05` (Game, 2 hop(s) via AFFECTS, score 0.671, rerank -1.380, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.55935, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `GAME_AT_01` (Game, 2 hop(s) via RUNS_ON, score 0.636, rerank -1.436, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.603702, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_AT_ZAHLENZIEHUNG, ticket_price=2.50, currency_code=EUR
- discarded nodes: 59 (slot_limit=59)
- hybrid channel blocks, shared with A (6):
  - `REC_games_GAME_GR_04` [record games] games: GAME_GR_04 (fused 0.0301, dense rank 1, sparse rank 13, rerank 1.644, rank 2)
  - `REC_games_GAME_UK_04` [record games] games: GAME_UK_04 (fused 0.0304, dense rank 2, sparse rank 10, rerank 1.454, rank 3)
  - `REC_campaigns_CMP_010` [record campaigns] campaigns: CMP_010 (fused 0.0260, dense rank 13, sparse rank 21, rerank 0.926, rank 4)
  - `REC_games_GAME_CZ_04` [record games] games: GAME_CZ_04 (fused 0.0295, dense rank 5, sparse rank 11, rerank -0.460, rank 6)
  - `REC_campaigns_CMP_009` [record campaigns] campaigns: CMP_009 (fused 0.0123, dense rank 21, sparse rank None, rerank -0.479, rank 7)
  - `CHNK_0230_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0224, dense rank 37, sparse rank 23, rerank -1.918, rank 11)
- events: graph.candidate.discarded=93, graph.candidate.reranked=100, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=64, graph.relationship.traversed=64, graph.rerank.started=1, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 951
- timings: run 7238 ms, judge 5562 ms over 100 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: games: GAME_AT_04, games: GAME_GR_04 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (1):
  - `GAME_AT_04` (Game, id, matched 'GAME_AT_04')
- graph.query.expanded: 0 term(s) added, search text 44 chars
- seeds: `GAME_AT_04`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 75
- ontology concepts: `CONCEPT_ADD_ON_PRODUCT`, `CONCEPT_SECOND_CHANCE`
- selected context (12: 7 node, 4 record, 1 document)
- selected node evidence (7):
  - `GAME_AT_04` (Game, 0 hop(s) via SEED, score 0.877, rerank 6.363, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.647549, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_04, game_id=GAME_AT_04, game_name=Alpen Star, market_id=MKT_AT, game_family_id=FAM_AT_ZUSATZSPIEL, ticket_price=1.00, currency_code=EUR
  - `GAME_AT_03` (Game, 2 hop(s) via AFFECTS, score 0.685, rerank -0.169, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.599527, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_03, game_id=GAME_AT_03, game_name=Wiener Zahlen, market_id=MKT_AT, game_family_id=FAM_AT_SCHNELLZIEHUNG, ticket_price=1.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.682, rerank -2.005, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.472639, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `GAME_AT_02` (Game, 2 hop(s) via AFFECTS, score 0.680, rerank -1.207, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.585798, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_AT_LAENDER_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_05` (Game, 2 hop(s) via AFFECTS, score 0.671, rerank -1.380, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.55935, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `GAME_UK_04` (Game, 1 hop(s) via SIMILAR_TO, score 0.649, rerank 1.454, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.664479, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_UK_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `GAME_AT_01` (Game, 2 hop(s) via RUNS_ON, score 0.636, rerank -1.436, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.603702, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_AT_ZAHLENZIEHUNG, ticket_price=2.50, currency_code=EUR
- discarded nodes: 69 (slot_limit=69)
- hybrid channel blocks, shared with A (5):
  - `REC_games_GAME_GR_04` [record games] games: GAME_GR_04 (fused 0.0301, dense rank 1, sparse rank 13, rerank 1.644, rank 2)
  - `REC_campaigns_CMP_010` [record campaigns] campaigns: CMP_010 (fused 0.0260, dense rank 13, sparse rank 21, rerank 0.926, rank 4)
  - `REC_games_GAME_CZ_04` [record games] games: GAME_CZ_04 (fused 0.0295, dense rank 5, sparse rank 11, rerank -0.460, rank 6)
  - `REC_campaigns_CMP_009` [record campaigns] campaigns: CMP_009 (fused 0.0123, dense rank 21, sparse rank None, rerank -0.479, rank 7)
  - `CHNK_0230_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0224, dense rank 37, sparse rank 23, rerank -1.918, rank 11)
- events: graph.candidate.discarded=104, graph.candidate.reranked=110, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=75, graph.query.expanded=1, graph.relationship.traversed=75, graph.rerank.started=1, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 951
- timings: run 8247 ms, judge 6454 ms over 110 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: games: GAME_AT_04, games: GAME_GR_04 [1].


## L15: stratum H5

**Question:** What caused incident INC_041?

### Pipeline A: conventional RAG

- selected context (12: 11 record, 1 document):
  - `CHNK_0252_00` [chunk] Incident Report: Αστάθεια εφαρμογής (INC_041) (fused 0.0244, dense rank 15, sparse rank 30, rerank 3.130, rank 1)
  - `REC_incidents_INC_041` [record incidents] incidents: INC_041 (fused 0.0318, dense rank 5, sparse rank 1, rerank 2.380, rank 2)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0264, dense rank 11, sparse rank 21, rerank 0.621, rank 3)
  - `REC_support_cases_SUP_02001` [record support_cases] support_cases: SUP_02001 (fused 0.0156, dense rank None, sparse rank 4, rerank 0.561, rank 4)
  - `REC_support_cases_SUP_02004` [record support_cases] support_cases: SUP_02004 (fused 0.0152, dense rank None, sparse rank 6, rerank 0.417, rank 5)
  - `REC_support_cases_SUP_02002` [record support_cases] support_cases: SUP_02002 (fused 0.0154, dense rank None, sparse rank 5, rerank 0.414, rank 6)
  - `REC_support_cases_SUP_02005` [record support_cases] support_cases: SUP_02005 (fused 0.0149, dense rank None, sparse rank 7, rerank 0.367, rank 7)
  - `REC_incidents_INC_004` [record incidents] incidents: INC_004 (fused 0.0269, dense rank 17, sparse rank 12, rerank -0.449, rank 8)
  - `REC_incidents_INC_021` [record incidents] incidents: INC_021 (fused 0.0271, dense rank 3, sparse rank 29, rerank -1.088, rank 9)
  - `REC_incidents_INC_042` [record incidents] incidents: INC_042 (fused 0.0258, dense rank 19, sparse rank 16, rerank -1.101, rank 10)
  - `REC_incidents_INC_031` [record incidents] incidents: INC_031 (fused 0.0269, dense rank 6, sparse rank 25, rerank -1.426, rank 11)
  - `REC_incidents_INC_009` [record incidents] incidents: INC_009 (fused 0.0320, dense rank 2, sparse rank 3, rerank -1.477, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1280
- timings: run 2445 ms, judge 2328 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: Incident Report: Αστάθεια εφαρμογής (INC_041), incidents: INC_041 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `INC_041` (Incident, id, matched 'INC_041')
- seeds: `INC_041`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 51
- selected context (12: 5 node, 6 record, 1 document)
- selected node evidence (5):
  - `INC_041` (Incident, 0 hop(s) via SEED, score 0.859, rerank 2.380, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.598071, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_041, incident_id=INC_041, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_EFARMOGI, started_at=2025-06-25 09:00:00, resolved_at=2025-07-01 00:00:00
  - `INC_021` (Incident, 2 hop(s) via RELATED_TO, score 0.613, rerank -1.088, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.609115, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_021, incident_id=INC_021, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-08-15 16:19:48, resolved_at=2025-08-17 16:10:48
  - `SUP_02001` (SupportCase, 1 hop(s) via RELATED_TO, score 0.584, rerank 0.561, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.405436, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_02001, support_case_id=SUP_02001, market_id=MKT_GR, category_code=SUPC_GR_TECHNIKO, opened_at=2025-06-26 19:30:50, summary_text=Η εφαρμογή κολλάει στο ταμείο από την ενημέρωση στην έκδοση 5.3.1.
  - `SUP_02004` (SupportCase, 1 hop(s) via RELATED_TO, score 0.580, rerank 0.417, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.394279, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_02004, support_case_id=SUP_02004, market_id=MKT_GR, category_code=SUPC_GR_TECHNIKO, opened_at=2025-06-25 14:34:35, summary_text=Η εφαρμογή κολλάει στο ταμείο από την ενημέρωση στην έκδοση 5.3.1.
  - `SUP_02002` (SupportCase, 1 hop(s) via RELATED_TO, score 0.574, rerank 0.414, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.377543, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_02002, support_case_id=SUP_02002, market_id=MKT_GR, category_code=SUPC_GR_TECHNIKO, opened_at=2025-06-26 01:47:37, summary_text=Η εφαρμογή κολλάει στο ταμείο από την ενημέρωση στην έκδοση 5.3.1.
- discarded nodes: 47 (slot_limit=47)
- hybrid channel blocks, shared with A (7):
  - `CHNK_0252_00` [chunk] Incident Report: Αστάθεια εφαρμογής (INC_041) (fused 0.0244, dense rank 15, sparse rank 30, rerank 3.130, rank 1)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0264, dense rank 11, sparse rank 21, rerank 0.621, rank 3)
  - `REC_support_cases_SUP_02005` [record support_cases] support_cases: SUP_02005 (fused 0.0149, dense rank None, sparse rank 7, rerank 0.367, rank 7)
  - `REC_incidents_INC_004` [record incidents] incidents: INC_004 (fused 0.0269, dense rank 17, sparse rank 12, rerank -0.449, rank 8)
  - `REC_incidents_INC_042` [record incidents] incidents: INC_042 (fused 0.0258, dense rank 19, sparse rank 16, rerank -1.101, rank 10)
  - `REC_incidents_INC_031` [record incidents] incidents: INC_031 (fused 0.0269, dense rank 6, sparse rank 25, rerank -1.426, rank 11)
  - `REC_incidents_INC_009` [record incidents] incidents: INC_009 (fused 0.0320, dense rank 2, sparse rank 3, rerank -1.477, rank 12)
- events: graph.candidate.discarded=80, graph.candidate.reranked=78, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=51, graph.relationship.traversed=51, graph.rerank.started=1, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 1280
- timings: run 6006 ms, judge 4603 ms over 78 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: Incident Report: Αστάθεια εφαρμογής (INC_041), incidents: INC_041 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (2):
  - `INC_041` (Incident, id, matched 'INC_041')
  - `CONCEPT_INCIDENT` (BusinessConcept, term, matched 'incident')
- graph.query.expanded: 9 term(s) added, search text 133 chars
- seeds: `INC_041`, `CONCEPT_INCIDENT`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 71
- ontology concepts: `CONCEPT_APPLICATION_INCIDENT`, `CONCEPT_DRAW_INCIDENT`, `CONCEPT_IDENTITY_INCIDENT`, `CONCEPT_INCIDENT`, `CONCEPT_PLATFORM_INCIDENT`
- discovered via_concept `CONCEPT_APPLICATION_INCIDENT`: 4 node(s): `ITYPE_CZ_APLIKACE`, `ITYPE_CORP_APPLICATION`, `ITYPE_UK_APP_STABILITY`, `ITYPE_AT_APP`
- discovered via_concept `CONCEPT_DRAW_INCIDENT`: 4 node(s): `ITYPE_CORP_DRAW`, `ITYPE_GR_KLIROSI`, `ITYPE_CZ_LOSOVANI`, `ITYPE_UK_DRAW_DELAY`
- discovered via_concept `CONCEPT_IDENTITY_INCIDENT`: 4 node(s): `ITYPE_CORP_IDENTITY`, `ITYPE_UK_SIGN_IN`, `ITYPE_CZ_PRIHLASENI`, `ITYPE_GR_SYNDESI`
- selected context (12: 5 node, 6 record, 1 document)
- selected node evidence (5):
  - `INC_041` (Incident, 0 hop(s) via SEED, score 0.847, rerank 2.380, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.564147, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_041, incident_id=INC_041, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_EFARMOGI, started_at=2025-06-25 09:00:00, resolved_at=2025-07-01 00:00:00
  - `INC_021` (Incident, 2 hop(s) via RELATED_TO, score 0.600, rerank -1.088, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.572802, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_021, incident_id=INC_021, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-08-15 16:19:48, resolved_at=2025-08-17 16:10:48
  - `SUP_02001` (SupportCase, 1 hop(s) via RELATED_TO, score 0.595, rerank 0.561, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.439163, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_02001, support_case_id=SUP_02001, market_id=MKT_GR, category_code=SUPC_GR_TECHNIKO, opened_at=2025-06-26 19:30:50, summary_text=Η εφαρμογή κολλάει στο ταμείο από την ενημέρωση στην έκδοση 5.3.1.
  - `SUP_02004` (SupportCase, 1 hop(s) via RELATED_TO, score 0.590, rerank 0.417, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.423919, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_02004, support_case_id=SUP_02004, market_id=MKT_GR, category_code=SUPC_GR_TECHNIKO, opened_at=2025-06-25 14:34:35, summary_text=Η εφαρμογή κολλάει στο ταμείο από την ενημέρωση στην έκδοση 5.3.1.
  - `SUP_02002` (SupportCase, 1 hop(s) via RELATED_TO, score 0.587, rerank 0.414, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.414396, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_02002, support_case_id=SUP_02002, market_id=MKT_GR, category_code=SUPC_GR_TECHNIKO, opened_at=2025-06-26 01:47:37, summary_text=Η εφαρμογή κολλάει στο ταμείο από την ενημέρωση στην έκδοση 5.3.1.
- discarded nodes: 68 (slot_limit=68)
- hybrid channel blocks, shared with A (7):
  - `CHNK_0252_00` [chunk] Incident Report: Αστάθεια εφαρμογής (INC_041) (fused 0.0257, dense rank 25, sparse rank 12, rerank 3.130, rank 1)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0116, dense rank 26, sparse rank None, rerank 0.621, rank 3)
  - `REC_incidents_INC_009` [record incidents] incidents: INC_009 (fused 0.0296, dense rank 13, sparse rank 3, rerank -1.477, rank 8)
  - `REC_incidents_INC_011` [record incidents] incidents: INC_011 (fused 0.0288, dense rank 9, sparse rank 10, rerank -1.919, rank 9)
  - `REC_incidents_INC_024` [record incidents] incidents: INC_024 (fused 0.0311, dense rank 8, sparse rank 1, rerank -2.095, rank 10)
  - `REC_incidents_INC_037` [record incidents] incidents: INC_037 (fused 0.0275, dense rank 28, sparse rank 2, rerank -2.189, rank 11)
  - `REC_incidents_INC_029` [record incidents] incidents: INC_029 (fused 0.0286, dense rank 17, sparse rank 4, rerank -2.233, rank 12)
- events: graph.candidate.discarded=101, graph.candidate.reranked=101, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=71, graph.ontology.expanded=3, graph.query.expanded=1, graph.relationship.traversed=71, graph.rerank.started=1, graph.seed.selected=2, graph.traversal.started=1
- context tokens: 1300
- timings: run 7990 ms, judge 5757 ms over 101 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: Incident Report: Αστάθεια εφαρμογής (INC_041), incidents: INC_041 [1].


