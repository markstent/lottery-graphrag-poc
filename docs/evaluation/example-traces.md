# Example Traces: A/B/C Retrieval Comparison

Status: HITL-08 artefact, regenerated for method v0.3 against the development world.

## What this document is

Verbatim output of the side-by-side trace CLI over the demo questions of the frozen bank.
Each question runs through three retrieval pipelines:

- **A, conventional RAG**: dense (bge-m3) plus sparse embedding, hybrid search fused by reciprocal rank, cross-encoder reranking, one shared context budget with no item limit, generation.
  The index holds document chunks and structured record blocks, so A can retrieve table rows as well as document text.
- **B, graph relationships**: an id and market resolver seeds a bounded traversal over the structured-record subgraph (when nothing resolves, the graph node of the best-matching record block); every traversal node joins the graph list, ordered by graph relevance (seeds, then nodes holding what the question asks for, then the rest), and is shown as the record block A indexes for its row (or only `<Label> <id>` when the row has none); the document and graph lists take turns filling the budget, documents first; nodes carry authoritative facts from the source tables for citations.
  No ontology: no concept seeds, no `MAPS_TO` expansion, no query expansion.
- **C, graph relationships + enterprise ontology**: B plus the ontology term resolver (concept seeds and concept-bound entities, shown as `via_concept`), query expansion with concept labels and synonyms (`graph.query.expanded`), and ontology expansion during traversal.

Same question, same synthetic world, same embedding model, one re-ranker that orders the document candidates against the raw question, same generator and prompt, and one token budget with no item limit (the selection in prompt order).
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

- selected context (16: 15 record, 1 document):
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
  - `REC_incidents_INC_005` [record incidents] incidents: INC_005 (fused 0.0266, dense rank 5, sparse rank 29, rerank -2.170, rank 13)
  - `REC_incidents_INC_008` [record incidents] incidents: INC_008 (fused 0.0202, dense rank 39, sparse rank 39, rerank -2.185, rank 14)
  - `REC_incidents_INC_006` [record incidents] incidents: INC_006 (fused 0.0273, dense rank 9, sparse rank 18, rerank -2.192, rank 15)
  - `CHNK_0256_00` [chunk] Release Note: APPV_UK_530 (Deferred Update) (fused 0.0154, dense rank None, sparse rank 5, rerank -5.173, rank 39)
- discarded: 24 (context_budget)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=24, rag.evidence.selected=16, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1995
- timings: run 2746 ms, judge 2670 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 16 shown

[fake-model] Based on 16 retrieved source(s), the strongest evidence for the question is in: incidents: INC_037, incidents: INC_017 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `INC_037` (Incident, id, matched 'INC_037')
- seeds: `INC_037`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 40
- selected context (15: 7 node, 8 record, 0 document)
- selected node evidence (7):
  - `INC_029` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.703, tier target, graph rank 2, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.580131, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_029, incident_id=INC_029, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-05-05 15:40:53, resolved_at=2025-05-06 06:08:53
  - `INC_024` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.698, tier target, graph rank 3, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.566379, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_024, incident_id=INC_024, market_id=MKT_CZ, severity=MEDIUM, incident_type=ITYPE_CZ_PRIHLASENI, started_at=2025-08-19 05:13:42, resolved_at=2025-08-20 06:04:42
  - `INC_001` (Incident, 2 hop(s) via AFFECTS, score 0.695, tier target, graph rank 4, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.627533, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-11-10 23:30:31, resolved_at=2025-11-13 19:40:31
  - `INC_005` (Incident, 2 hop(s) via AFFECTS, score 0.694, tier target, graph rank 5, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.625008, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_005, incident_id=INC_005, market_id=MKT_UK, severity=HIGH, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-03-24 07:00:33, resolved_at=2025-03-25 14:25:33
  - `PLV_IDENTITY_2` (PlatformVersion, 1 hop(s) via RELATED_TO_VERSION, score 0.681, tier target, graph rank 6, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.398474, 'temporal_validity': 1.0}); source_table=platform_versions, source_record_id=PLV_IDENTITY_2, platform_version_id=PLV_IDENTITY_2, platform_id=PLT_IDENTITY, version_label=2024.2.0, released_at=2024-07-01 00:00:00, retired_at=-
  - `INC_013` (Incident, 2 hop(s) via AFFECTS, score 0.680, tier target, graph rank 7, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.585675, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_013, incident_id=INC_013, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_DRAW_DELAY, started_at=2025-11-10 19:38:24, resolved_at=2025-11-12 03:17:24
  - `INC_033` (Incident, 2 hop(s) via OF_TYPE, score 0.665, tier target, graph rank 8, components {'graph_distance': 0.5, 'relationship_type': 0.7, 'semantic_relevance': 0.61551, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_033, incident_id=INC_033, market_id=MKT_UK, severity=HIGH, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-09-12 21:16:47, resolved_at=2025-09-15 09:07:47
- discarded nodes: 34 (context_budget=33, same_record=1)
- hybrid channel blocks, shared with A (8):
  - `REC_incidents_INC_037` [record incidents] incidents: INC_037 (fused 0.0286, dense rank 22, sparse rank 1, rerank 2.829, rank 1)
  - `REC_incidents_INC_017` [record incidents] incidents: INC_017 (fused 0.0159, dense rank 3, sparse rank None, rerank -0.360, rank 2)
  - `REC_incidents_INC_027` [record incidents] incidents: INC_027 (fused 0.0294, dense rank 1, sparse rank 17, rerank -0.601, rank 3)
  - `REC_incidents_INC_030` [record incidents] incidents: INC_030 (fused 0.0284, dense rank 10, sparse rank 11, rerank -0.666, rank 4)
  - `REC_incidents_INC_032` [record incidents] incidents: INC_032 (fused 0.0289, dense rank 6, sparse rank 13, rerank -1.160, rank 5)
  - `REC_incidents_INC_003` [record incidents] incidents: INC_003 (fused 0.0276, dense rank 19, sparse rank 7, rerank -1.232, rank 6)
  - `REC_incidents_INC_038` [record incidents] incidents: INC_038 (fused 0.0243, dense rank 15, sparse rank 31, rerank -1.566, rank 7)
  - `REC_incidents_INC_036` [record incidents] incidents: INC_036 (fused 0.0292, dense rank 7, sparse rank 10, rerank -1.622, rank 8)
- events: graph.candidate.discarded=66, graph.candidate.reranked=40, graph.candidate.selected=15, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=40, graph.relationship.traversed=40, graph.rerank.started=1, graph.seed.selected=1, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1998
- timings: run 4266 ms, judge 2789 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 15 shown

[fake-model] Based on 15 retrieved source(s), the strongest evidence for the question is in: incidents: INC_037, incidents: INC_029 [1].

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
- selected context (17: 8 node, 9 record, 0 document)
- selected node evidence (8):
  - `CONCEPT_INCIDENT` (BusinessConcept, 0 hop(s) via SEED, score 0.902, tier seed, graph rank 1, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.719328, 'temporal_validity': 1.0})
  - `INC_024` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.720, tier target, graph rank 3, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.627151, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_024, incident_id=INC_024, market_id=MKT_CZ, severity=MEDIUM, incident_type=ITYPE_CZ_PRIHLASENI, started_at=2025-08-19 05:13:42, resolved_at=2025-08-20 06:04:42
  - `INC_029` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.708, tier target, graph rank 4, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.592997, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_029, incident_id=INC_029, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-05-05 15:40:53, resolved_at=2025-05-06 06:08:53
  - `ITYPE_UK_SIGN_IN` (IncidentType, 1 hop(s) via OF_TYPE, score 0.696, tier target, graph rank 5, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.584714, 'temporal_validity': 1.0}); source_table=incident_types, source_record_id=ITYPE_UK_SIGN_IN, incident_type_id=ITYPE_UK_SIGN_IN, market_id=MKT_UK, name=Sign-in outage, language_code=en
  - `INC_005` (Incident, 2 hop(s) via AFFECTS, score 0.690, tier target, graph rank 6, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.615139, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_005, incident_id=INC_005, market_id=MKT_UK, severity=HIGH, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-03-24 07:00:33, resolved_at=2025-03-25 14:25:33
  - `PLV_IDENTITY_2` (PlatformVersion, 1 hop(s) via RELATED_TO_VERSION, score 0.690, tier target, graph rank 7, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.423271, 'temporal_validity': 1.0}); source_table=platform_versions, source_record_id=PLV_IDENTITY_2, platform_version_id=PLV_IDENTITY_2, platform_id=PLT_IDENTITY, version_label=2024.2.0, released_at=2024-07-01 00:00:00, retired_at=-
  - `INC_001` (Incident, 2 hop(s) via AFFECTS, score 0.689, tier target, graph rank 8, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.611641, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-11-10 23:30:31, resolved_at=2025-11-13 19:40:31
  - `INC_013` (Incident, 2 hop(s) via AFFECTS, score 0.671, tier target, graph rank 9, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.5586, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_013, incident_id=INC_013, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_DRAW_DELAY, started_at=2025-11-10 19:38:24, resolved_at=2025-11-12 03:17:24
- discarded nodes: 53 (context_budget=52, same_record=1)
- hybrid channel blocks, shared with A (9):
  - `REC_incidents_INC_037` [record incidents] incidents: INC_037 (fused 0.0283, dense rank 24, sparse rank 1, rerank 2.829, rank 1)
  - `REC_support_cases_SUP_01211` [record support_cases] support_cases: SUP_01211 (fused 0.0130, dense rank None, sparse rank 17, rerank 1.475, rank 2)
  - `REC_incidents_INC_027` [record incidents] incidents: INC_027 (fused 0.0260, dense rank 3, sparse rank 39, rerank -0.601, rank 3)
  - `REC_incidents_INC_032` [record incidents] incidents: INC_032 (fused 0.0264, dense rank 2, sparse rank 37, rerank -1.160, rank 4)
  - `REC_incidents_INC_003` [record incidents] incidents: INC_003 (fused 0.0246, dense rank 13, sparse rank 32, rerank -1.232, rank 5)
  - `REC_incidents_INC_038` [record incidents] incidents: INC_038 (fused 0.0125, dense rank 20, sparse rank None, rerank -1.566, rank 6)
  - `REC_incidents_INC_036` [record incidents] incidents: INC_036 (fused 0.0269, dense rank 1, sparse rank 35, rerank -1.622, rank 7)
  - `REC_incidents_INC_031` [record incidents] incidents: INC_031 (fused 0.0135, dense rank 14, sparse rank None, rerank -1.652, rank 8)
  - `REC_incident_types_ITYPE_CZ_TERMINAL` [record incident_types] incident_types: ITYPE_CZ_TERMINAL (fused 0.0270, dense rank 5, sparse rank 26, rerank -9.652, rank 38)
- events: graph.candidate.discarded=84, graph.candidate.reranked=40, graph.candidate.selected=17, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=59, graph.ontology.expanded=3, graph.query.expanded=1, graph.relationship.traversed=59, graph.rerank.started=1, graph.seed.selected=2, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1998
- timings: run 4883 ms, judge 2499 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 17 shown

[fake-model] Based on 17 retrieved source(s), the strongest evidence for the question is in: incidents: INC_037, BusinessConcept: CONCEPT_INCIDENT [1].


## L09: stratum H2

**Question:** Which games in other markets belong to the same kind of game family as game GAME_AT_05?

### Pipeline A: conventional RAG

- selected context (18: 3 record, 15 document):
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
  - `CHNK_0230_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0279, dense rank 7, sparse rank 17, rerank -3.091, rank 13)
  - `CHNK_0147_00` [chunk] Game Rules: Danube Classic (GAME_AT_01) (fused 0.0260, dense rank 9, sparse rank 27, rerank -3.161, rank 14)
  - `CHNK_0222_00` [chunk] Game Rules: Peloponnesus Pull (GAME_GR_05) (fused 0.0246, dense rank 18, sparse rank 25, rerank -3.301, rank 15)
  - `CHNK_0240_00` [chunk] Support Summary: Peloponnesus Pull (GAME_GR_05) (fused 0.0132, dense rank 16, sparse rank None, rerank -3.397, rank 16)
  - `CHNK_0203_00` [chunk] Support Summary: Albion Millions (GAME_UK_01) (fused 0.0143, dense rank None, sparse rank 10, rerank -3.399, rank 17)
  - `REC_games_GAME_UK_05` [record games] games: GAME_UK_05 (fused 0.0154, dense rank 5, sparse rank None, rerank -3.569, rank 18)
- discarded: 22 (context_budget)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=22, rag.evidence.selected=18, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1993
- timings: run 2545 ms, judge 2478 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 18 shown

[fake-model] Based on 18 retrieved source(s), the strongest evidence for the question is in: Post Incident Review: Authentication outage (INC_011), games: GAME_AT_05 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `GAME_AT_05` (Game, id, matched 'GAME_AT_05')
- seeds: `GAME_AT_05`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 58
- selected context (17: 8 node, 0 record, 9 document)
- selected node evidence (8):
  - `GAME_AT_05` (Game, 0 hop(s) via SEED, score 0.836, tier seed, graph rank 1, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.530045, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.686, tier target, graph rank 2, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.483762, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `INC_003` (Incident, 1 hop(s) via AFFECTS, score 0.680, tier target, graph rank 3, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.465429, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_003, incident_id=INC_003, market_id=MKT_AT, severity=HIGH, incident_type=ITYPE_AT_APP, started_at=2025-07-20 17:37:32, resolved_at=2025-07-21 00:39:32
  - `INC_011` (Incident, 1 hop(s) via AFFECTS, score 0.662, tier target, graph rank 4, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.415236, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_011, incident_id=INC_011, market_id=-, severity=HIGH, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-08-27 08:02:54, resolved_at=2025-08-29 07:53:54
  - `INC_019` (Incident, 1 hop(s) via AFFECTS, score 0.660, tier target, graph rank 5, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.409362, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_019, incident_id=INC_019, market_id=-, severity=MEDIUM, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-10-23 03:38:50, resolved_at=2025-10-24 19:01:50
  - `GAME_AT_02` (Game, 2 hop(s) via AFFECTS, score 0.650, tier target, graph rank 6, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.500201, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_AT_LAENDER_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_01` (Game, 2 hop(s) via AFFECTS, score 0.647, tier target, graph rank 7, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.491106, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_AT_ZAHLENZIEHUNG, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_04` (Game, 2 hop(s) via AFFECTS, score 0.643, tier target, graph rank 8, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.479256, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_04, game_id=GAME_AT_04, game_name=Alpen Star, market_id=MKT_AT, game_family_id=FAM_AT_ZUSATZSPIEL, ticket_price=1.00, currency_code=EUR
- discarded nodes: 51 (context_budget=51)
- hybrid channel blocks, shared with A (9):
  - `CHNK_0066_00` [chunk] Post Incident Review: Authentication outage (INC_011) (fused 0.0284, dense rank 17, sparse rank 5, rerank 3.123, rank 1)
  - `CHNK_0201_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0274, dense rank 1, sparse rank 31, rerank -0.998, rank 3)
  - `CHNK_0206_00` [chunk] Meeting Note: Lioness Instant (GAME_UK_05) (fused 0.0161, dense rank 2, sparse rank None, rerank -1.202, rank 4)
  - `CHNK_0017_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0255, dense rank 6, sparse rank 37, rerank -2.543, rank 5)
  - `CHNK_0149_00` [chunk] Meeting Note: Lioness Instant (GAME_UK_05) (fused 0.0161, dense rank None, sparse rank 2, rerank -2.813, rank 6)
  - `CHNK_0008_00` [chunk] Product Spec: SwiftSix (GAME_UK_06) (fused 0.0152, dense rank None, sparse rank 6, rerank -2.819, rank 7)
  - `CHNK_0073_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0156, dense rank None, sparse rank 4, rerank -2.862, rank 8)
  - `CHNK_0048_00` [chunk] Monthly Market Review: Alpen Star (GAME_AT_04) (fused 0.0159, dense rank 3, sparse rank None, rerank -2.931, rank 9)
  - `CHNK_0009_00` [chunk] Product Spec: Danube Classic (GAME_AT_01) (fused 0.0122, dense rank None, sparse rank 22, rerank -2.937, rank 10)
- events: graph.candidate.discarded=82, graph.candidate.reranked=40, graph.candidate.selected=17, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=58, graph.relationship.traversed=58, graph.rerank.started=1, graph.seed.selected=1, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1985
- timings: run 4491 ms, judge 2492 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 17 shown

[fake-model] Based on 17 retrieved source(s), the strongest evidence for the question is in: Post Incident Review: Authentication outage (INC_011), games: GAME_AT_05 [1].

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
- selected context (17: 8 node, 0 record, 9 document)
- selected node evidence (8):
  - `GAME_AT_05` (Game, 0 hop(s) via SEED, score 0.836, tier seed, graph rank 1, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.530045, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.686, tier target, graph rank 2, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.483762, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `INC_003` (Incident, 1 hop(s) via AFFECTS, score 0.680, tier target, graph rank 3, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.465429, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_003, incident_id=INC_003, market_id=MKT_AT, severity=HIGH, incident_type=ITYPE_AT_APP, started_at=2025-07-20 17:37:32, resolved_at=2025-07-21 00:39:32
  - `INC_011` (Incident, 1 hop(s) via AFFECTS, score 0.662, tier target, graph rank 4, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.415236, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_011, incident_id=INC_011, market_id=-, severity=HIGH, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-08-27 08:02:54, resolved_at=2025-08-29 07:53:54
  - `INC_019` (Incident, 1 hop(s) via AFFECTS, score 0.660, tier target, graph rank 5, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.409362, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_019, incident_id=INC_019, market_id=-, severity=MEDIUM, incident_type=ITYPE_CORP_IDENTITY, started_at=2025-10-23 03:38:50, resolved_at=2025-10-24 19:01:50
  - `GAME_AT_02` (Game, 2 hop(s) via AFFECTS, score 0.650, tier target, graph rank 6, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.500201, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_AT_LAENDER_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_01` (Game, 2 hop(s) via AFFECTS, score 0.647, tier target, graph rank 7, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.491106, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_AT_ZAHLENZIEHUNG, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_04` (Game, 2 hop(s) via AFFECTS, score 0.643, tier target, graph rank 8, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.479256, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_04, game_id=GAME_AT_04, game_name=Alpen Star, market_id=MKT_AT, game_family_id=FAM_AT_ZUSATZSPIEL, ticket_price=1.00, currency_code=EUR
- discarded nodes: 94 (context_budget=94)
- hybrid channel blocks, shared with A (9):
  - `CHNK_0066_00` [chunk] Post Incident Review: Authentication outage (INC_011) (fused 0.0284, dense rank 17, sparse rank 5, rerank 3.123, rank 1)
  - `CHNK_0201_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0274, dense rank 1, sparse rank 31, rerank -0.998, rank 3)
  - `CHNK_0206_00` [chunk] Meeting Note: Lioness Instant (GAME_UK_05) (fused 0.0161, dense rank 2, sparse rank None, rerank -1.202, rank 4)
  - `CHNK_0017_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0255, dense rank 6, sparse rank 37, rerank -2.543, rank 5)
  - `CHNK_0149_00` [chunk] Meeting Note: Lioness Instant (GAME_UK_05) (fused 0.0161, dense rank None, sparse rank 2, rerank -2.813, rank 6)
  - `CHNK_0008_00` [chunk] Product Spec: SwiftSix (GAME_UK_06) (fused 0.0152, dense rank None, sparse rank 6, rerank -2.819, rank 7)
  - `CHNK_0073_00` [chunk] Game Rules: Lioness Instant (GAME_UK_05) (fused 0.0156, dense rank None, sparse rank 4, rerank -2.862, rank 8)
  - `CHNK_0048_00` [chunk] Monthly Market Review: Alpen Star (GAME_AT_04) (fused 0.0159, dense rank 3, sparse rank None, rerank -2.931, rank 9)
  - `CHNK_0009_00` [chunk] Product Spec: Danube Classic (GAME_AT_01) (fused 0.0122, dense rank None, sparse rank 22, rerank -2.937, rank 10)
- events: graph.candidate.discarded=125, graph.candidate.reranked=40, graph.candidate.selected=17, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=101, graph.ontology.expanded=3, graph.query.expanded=1, graph.relationship.traversed=101, graph.rerank.started=1, graph.seed.selected=1, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1985
- timings: run 5821 ms, judge 2500 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 17 shown

[fake-model] Based on 17 retrieved source(s), the strongest evidence for the question is in: Post Incident Review: Authentication outage (INC_011), games: GAME_AT_05 [1].


## L01: stratum H3

**Question:** What is the ticket price of game GAME_AT_04?

### Pipeline A: conventional RAG

- selected context (22: 18 record, 4 document):
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
  - `CHNK_0152_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0223, dense rank 39, sparse rank 22, rerank -2.587, rank 13)
  - `CHNK_0048_00` [chunk] Monthly Market Review: Alpen Star (GAME_AT_04) (fused 0.0214, dense rank 36, sparse rank 31, rerank -2.694, rank 14)
  - `REC_games_GAME_UK_03` [record games] games: GAME_UK_03 (fused 0.0295, dense rank 11, sparse rank 5, rerank -2.734, rank 15)
  - `REC_games_GAME_GR_01` [record games] games: GAME_GR_01 (fused 0.0265, dense rank 12, sparse rank 19, rerank -2.881, rank 16)
  - `REC_games_GAME_GR_03` [record games] games: GAME_GR_03 (fused 0.0296, dense rank 7, sparse rank 8, rerank -2.974, rank 17)
  - `CHNK_0017_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0205, dense rank 35, sparse rank 40, rerank -2.984, rank 18)
  - `REC_games_GAME_UK_01` [record games] games: GAME_UK_01 (fused 0.0278, dense rank 9, sparse rank 15, rerank -3.014, rank 19)
  - `REC_games_GAME_UK_06` [record games] games: GAME_UK_06 (fused 0.0288, dense rank 19, sparse rank 2, rerank -3.160, rank 20)
  - `REC_games_GAME_UK_05` [record games] games: GAME_UK_05 (fused 0.0289, dense rank 17, sparse rank 3, rerank -3.419, rank 21)
  - `REC_games_GAME_GR_02` [record games] games: GAME_GR_02 (fused 0.0274, dense rank 14, sparse rank 12, rerank -3.482, rank 22)
- discarded: 18 (context_budget)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=18, rag.evidence.selected=22, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1970
- timings: run 2003 ms, judge 1935 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 22 shown

[fake-model] Based on 22 retrieved source(s), the strongest evidence for the question is in: games: GAME_AT_04, games: GAME_GR_04 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `GAME_AT_04` (Game, id, matched 'GAME_AT_04')
- seeds: `GAME_AT_04`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 64
- selected context (21: 11 node, 8 record, 2 document)
- selected node evidence (11):
  - `GAME_AT_03` (Game, 2 hop(s) via AFFECTS, score 0.685, tier target, graph rank 2, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.599527, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_03, game_id=GAME_AT_03, game_name=Wiener Zahlen, market_id=MKT_AT, game_family_id=FAM_AT_SCHNELLZIEHUNG, ticket_price=1.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.682, tier target, graph rank 3, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.472639, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `GAME_AT_02` (Game, 2 hop(s) via AFFECTS, score 0.680, tier target, graph rank 4, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.585798, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_AT_LAENDER_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `INC_003` (Incident, 1 hop(s) via AFFECTS, score 0.674, tier target, graph rank 5, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.45041, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_003, incident_id=INC_003, market_id=MKT_AT, severity=HIGH, incident_type=ITYPE_AT_APP, started_at=2025-07-20 17:37:32, resolved_at=2025-07-21 00:39:32
  - `GAME_AT_05` (Game, 2 hop(s) via AFFECTS, score 0.671, tier target, graph rank 6, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.55935, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `SUP_00207` (SupportCase, 1 hop(s) via CONCERNS, score 0.662, tier target, graph rank 7, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.488014, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00207, support_case_id=SUP_00207, market_id=MKT_AT, category_code=SUPC_AT_ZAHLUNG, opened_at=2025-09-22 13:04:24, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00087` (SupportCase, 1 hop(s) via CONCERNS, score 0.649, tier target, graph rank 8, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.450894, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00087, support_case_id=SUP_00087, market_id=MKT_AT, category_code=SUPC_AT_TECHNIK, opened_at=2025-01-11 18:51:59, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00187` (SupportCase, 1 hop(s) via CONCERNS, score 0.649, tier target, graph rank 9, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.448531, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00187, support_case_id=SUP_00187, market_id=MKT_AT, category_code=SUPC_AT_KONTO, opened_at=2025-03-07 06:09:14, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00011` (SupportCase, 1 hop(s) via CONCERNS, score 0.645, tier target, graph rank 10, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.4374, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00011, support_case_id=SUP_00011, market_id=MKT_AT, category_code=SUPC_AT_SPIEL, opened_at=2025-12-01 07:00:21, summary_text=Synthetic support contact describing a player-reported issue.
  - `CAT_AT_ZUSATZ` (GameCategory, 1 hop(s) via INSTANCE_OF, score 0.610, tier other, graph rank 19, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.479855, 'temporal_validity': 1.0})
  - `MKT_AT` (Market, 1 hop(s) via AVAILABLE_IN, score 0.564, tier other, graph rank 24, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.419886, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_AT, market_id=MKT_AT, market_name=Austria, currency_code=EUR
- discarded nodes: 54 (context_budget=52, same_record=2)
- hybrid channel blocks, shared with A (10):
  - `REC_games_GAME_AT_04` [record games] games: GAME_AT_04 (fused 0.0323, dense rank 3, sparse rank 1, rerank 6.363, rank 1)
  - `REC_games_GAME_GR_04` [record games] games: GAME_GR_04 (fused 0.0301, dense rank 1, sparse rank 13, rerank 1.644, rank 2)
  - `REC_games_GAME_UK_04` [record games] games: GAME_UK_04 (fused 0.0304, dense rank 2, sparse rank 10, rerank 1.454, rank 3)
  - `REC_campaigns_CMP_010` [record campaigns] campaigns: CMP_010 (fused 0.0260, dense rank 13, sparse rank 21, rerank 0.926, rank 4)
  - `REC_games_GAME_CZ_04` [record games] games: GAME_CZ_04 (fused 0.0295, dense rank 5, sparse rank 11, rerank -0.460, rank 6)
  - `REC_campaigns_CMP_009` [record campaigns] campaigns: CMP_009 (fused 0.0123, dense rank 21, sparse rank None, rerank -0.479, rank 7)
  - `REC_games_GAME_AT_01` [record games] games: GAME_AT_01 (fused 0.0288, dense rank 4, sparse rank 16, rerank -1.436, rank 10)
  - `CHNK_0230_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0224, dense rank 37, sparse rank 23, rerank -1.918, rank 11)
  - `REC_campaigns_CMP_002` [record campaigns] campaigns: CMP_002 (fused 0.0114, dense rank 28, sparse rank None, rerank -2.368, rank 12)
  - `CHNK_0152_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0223, dense rank 39, sparse rank 22, rerank -2.587, rank 13)
- events: graph.candidate.discarded=84, graph.candidate.reranked=40, graph.candidate.selected=21, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=64, graph.relationship.traversed=64, graph.rerank.started=1, graph.seed.selected=1, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1986
- timings: run 4057 ms, judge 1901 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 21 shown

[fake-model] Based on 21 retrieved source(s), the strongest evidence for the question is in: games: GAME_AT_04, games: GAME_AT_03 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (1):
  - `GAME_AT_04` (Game, id, matched 'GAME_AT_04')
- graph.query.expanded: 0 term(s) added, search text 44 chars
- seeds: `GAME_AT_04`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 75
- ontology concepts: `CONCEPT_ADD_ON_PRODUCT`, `CONCEPT_SECOND_CHANCE`
- selected context (21: 11 node, 8 record, 2 document)
- selected node evidence (11):
  - `GAME_AT_03` (Game, 2 hop(s) via AFFECTS, score 0.685, tier target, graph rank 2, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.599527, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_03, game_id=GAME_AT_03, game_name=Wiener Zahlen, market_id=MKT_AT, game_family_id=FAM_AT_SCHNELLZIEHUNG, ticket_price=1.00, currency_code=EUR
  - `INC_031` (Incident, 1 hop(s) via AFFECTS, score 0.682, tier target, graph rank 3, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.472639, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_031, incident_id=INC_031, market_id=MKT_AT, severity=LOW, incident_type=ITYPE_AT_TERMINAL, started_at=2025-01-27 12:51:22, resolved_at=2025-01-30 03:51:22
  - `GAME_AT_02` (Game, 2 hop(s) via AFFECTS, score 0.680, tier target, graph rank 4, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.585798, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_AT_LAENDER_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `INC_003` (Incident, 1 hop(s) via AFFECTS, score 0.674, tier target, graph rank 5, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.45041, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_003, incident_id=INC_003, market_id=MKT_AT, severity=HIGH, incident_type=ITYPE_AT_APP, started_at=2025-07-20 17:37:32, resolved_at=2025-07-21 00:39:32
  - `GAME_AT_05` (Game, 2 hop(s) via AFFECTS, score 0.671, tier target, graph rank 6, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.55935, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_05, game_id=GAME_AT_05, game_name=Edelweiss Instant, market_id=MKT_AT, game_family_id=FAM_AT_RUBBELLOS, ticket_price=2.00, currency_code=EUR
  - `SUP_00207` (SupportCase, 1 hop(s) via CONCERNS, score 0.662, tier target, graph rank 7, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.488014, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00207, support_case_id=SUP_00207, market_id=MKT_AT, category_code=SUPC_AT_ZAHLUNG, opened_at=2025-09-22 13:04:24, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00087` (SupportCase, 1 hop(s) via CONCERNS, score 0.649, tier target, graph rank 8, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.450894, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00087, support_case_id=SUP_00087, market_id=MKT_AT, category_code=SUPC_AT_TECHNIK, opened_at=2025-01-11 18:51:59, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00187` (SupportCase, 1 hop(s) via CONCERNS, score 0.649, tier target, graph rank 10, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.448531, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00187, support_case_id=SUP_00187, market_id=MKT_AT, category_code=SUPC_AT_KONTO, opened_at=2025-03-07 06:09:14, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00011` (SupportCase, 1 hop(s) via CONCERNS, score 0.645, tier target, graph rank 11, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.4374, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00011, support_case_id=SUP_00011, market_id=MKT_AT, category_code=SUPC_AT_SPIEL, opened_at=2025-12-01 07:00:21, summary_text=Synthetic support contact describing a player-reported issue.
  - `CAT_AT_ZUSATZ` (GameCategory, 1 hop(s) via INSTANCE_OF, score 0.610, tier other, graph rank 29, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.479855, 'temporal_validity': 1.0})
  - `MKT_AT` (Market, 1 hop(s) via AVAILABLE_IN, score 0.564, tier other, graph rank 34, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.419886, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_AT, market_id=MKT_AT, market_name=Austria, currency_code=EUR
- discarded nodes: 65 (context_budget=62, same_record=3)
- hybrid channel blocks, shared with A (10):
  - `REC_games_GAME_AT_04` [record games] games: GAME_AT_04 (fused 0.0323, dense rank 3, sparse rank 1, rerank 6.363, rank 1)
  - `REC_games_GAME_GR_04` [record games] games: GAME_GR_04 (fused 0.0301, dense rank 1, sparse rank 13, rerank 1.644, rank 2)
  - `REC_games_GAME_UK_04` [record games] games: GAME_UK_04 (fused 0.0304, dense rank 2, sparse rank 10, rerank 1.454, rank 3)
  - `REC_campaigns_CMP_010` [record campaigns] campaigns: CMP_010 (fused 0.0260, dense rank 13, sparse rank 21, rerank 0.926, rank 4)
  - `REC_games_GAME_CZ_04` [record games] games: GAME_CZ_04 (fused 0.0295, dense rank 5, sparse rank 11, rerank -0.460, rank 6)
  - `REC_campaigns_CMP_009` [record campaigns] campaigns: CMP_009 (fused 0.0123, dense rank 21, sparse rank None, rerank -0.479, rank 7)
  - `REC_games_GAME_AT_01` [record games] games: GAME_AT_01 (fused 0.0288, dense rank 4, sparse rank 16, rerank -1.436, rank 10)
  - `CHNK_0230_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0224, dense rank 37, sparse rank 23, rerank -1.918, rank 11)
  - `REC_campaigns_CMP_002` [record campaigns] campaigns: CMP_002 (fused 0.0114, dense rank 28, sparse rank None, rerank -2.368, rank 12)
  - `CHNK_0152_00` [chunk] Support Summary: Alpen Star (GAME_AT_04) (fused 0.0223, dense rank 39, sparse rank 22, rerank -2.587, rank 13)
- events: graph.candidate.discarded=95, graph.candidate.reranked=40, graph.candidate.selected=21, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=75, graph.query.expanded=1, graph.relationship.traversed=75, graph.rerank.started=1, graph.seed.selected=1, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1986
- timings: run 4264 ms, judge 1888 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 21 shown

[fake-model] Based on 21 retrieved source(s), the strongest evidence for the question is in: games: GAME_AT_04, games: GAME_AT_03 [1].


## L15: stratum H5

**Question:** What caused incident INC_041?

### Pipeline A: conventional RAG

- selected context (17: 16 record, 1 document):
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
  - `REC_incidents_INC_043` [record incidents] incidents: INC_043 (fused 0.0260, dense rank 24, sparse rank 11, rerank -1.715, rank 13)
  - `REC_incidents_INC_011` [record incidents] incidents: INC_011 (fused 0.0294, dense rank 1, sparse rank 17, rerank -1.919, rank 14)
  - `REC_incidents_INC_024` [record incidents] incidents: INC_024 (fused 0.0264, dense rank 13, sparse rank 19, rerank -2.095, rank 15)
  - `REC_incidents_INC_037` [record incidents] incidents: INC_037 (fused 0.0304, dense rank 10, sparse rank 2, rerank -2.189, rank 16)
  - `REC_incidents_INC_014` [record incidents] incidents: INC_014 (fused 0.0251, dense rank 7, sparse rank 38, rerank -2.582, rank 20)
- discarded: 23 (context_budget)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=23, rag.evidence.selected=17, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1997
- timings: run 2448 ms, judge 2387 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 17 shown

[fake-model] Based on 17 retrieved source(s), the strongest evidence for the question is in: Incident Report: Αστάθεια εφαρμογής (INC_041), incidents: INC_041 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `INC_041` (Incident, id, matched 'INC_041')
- seeds: `INC_041`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 51
- selected context (17: 9 node, 7 record, 1 document)
- selected node evidence (9):
  - `INC_041` (Incident, 0 hop(s) via SEED, score 0.859, tier seed, graph rank 1, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.598071, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_041, incident_id=INC_041, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_EFARMOGI, started_at=2025-06-25 09:00:00, resolved_at=2025-07-01 00:00:00
  - `INC_014` (Incident, 2 hop(s) via AFFECTS, score 0.682, tier target, graph rank 2, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.591904, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_014, incident_id=INC_014, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_SYNDESI, started_at=2025-11-24 20:51:37, resolved_at=2025-11-25 21:50:37
  - `INC_026` (Incident, 2 hop(s) via AFFECTS, score 0.675, tier target, graph rank 3, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.570504, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_026, incident_id=INC_026, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_TERMATIKA, started_at=2025-10-13 22:15:37, resolved_at=2025-10-13 23:36:37
  - `INC_022` (Incident, 2 hop(s) via AFFECTS, score 0.672, tier target, graph rank 4, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.562701, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_022, incident_id=INC_022, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-11-29 01:54:04, resolved_at=2025-11-29 14:58:04
  - `INC_010` (Incident, 2 hop(s) via AFFECTS, score 0.672, tier target, graph rank 5, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.561463, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_010, incident_id=INC_010, market_id=MKT_GR, severity=CRITICAL, incident_type=ITYPE_GR_EFARMOGI, started_at=2025-10-31 03:35:53, resolved_at=2025-10-31 16:24:53
  - `INC_002` (Incident, 2 hop(s) via AFFECTS, score 0.669, tier target, graph rank 6, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.553285, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_002, incident_id=INC_002, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-02-05 08:29:43, resolved_at=2025-02-05 16:24:43
  - `INC_034` (Incident, 2 hop(s) via OF_TYPE, score 0.655, tier target, graph rank 7, components {'graph_distance': 0.5, 'relationship_type': 0.7, 'semantic_relevance': 0.58694, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_034, incident_id=INC_034, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_EFARMOGI, started_at=2025-06-27 16:24:49, resolved_at=2025-06-29 00:06:49
  - `GAME_GR_04` (Game, 1 hop(s) via AFFECTS, score 0.628, tier other, graph rank 17, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.317301, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_04, game_id=GAME_GR_04, game_name=Athena Express, market_id=MKT_GR, game_family_id=FAM_GR_PSIFIAKO_STIGMIAIO, ticket_price=1.00, currency_code=EUR
  - `CAT_GR_STIGMIAIA` (GameCategory, 2 hop(s) via INSTANCE_OF, score 0.514, tier other, graph rank 35, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.326882, 'temporal_validity': 1.0})
- discarded nodes: 43 (context_budget=39, same_record=4)
- hybrid channel blocks, shared with A (8):
  - `CHNK_0252_00` [chunk] Incident Report: Αστάθεια εφαρμογής (INC_041) (fused 0.0244, dense rank 15, sparse rank 30, rerank 3.130, rank 1)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0264, dense rank 11, sparse rank 21, rerank 0.621, rank 3)
  - `REC_support_cases_SUP_02001` [record support_cases] support_cases: SUP_02001 (fused 0.0156, dense rank None, sparse rank 4, rerank 0.561, rank 4)
  - `REC_support_cases_SUP_02004` [record support_cases] support_cases: SUP_02004 (fused 0.0152, dense rank None, sparse rank 6, rerank 0.417, rank 5)
  - `REC_support_cases_SUP_02002` [record support_cases] support_cases: SUP_02002 (fused 0.0154, dense rank None, sparse rank 5, rerank 0.414, rank 6)
  - `REC_support_cases_SUP_02005` [record support_cases] support_cases: SUP_02005 (fused 0.0149, dense rank None, sparse rank 7, rerank 0.367, rank 7)
  - `REC_incidents_INC_004` [record incidents] incidents: INC_004 (fused 0.0269, dense rank 17, sparse rank 12, rerank -0.449, rank 8)
  - `REC_incidents_INC_021` [record incidents] incidents: INC_021 (fused 0.0271, dense rank 3, sparse rank 29, rerank -1.088, rank 9)
- events: graph.candidate.discarded=75, graph.candidate.reranked=40, graph.candidate.selected=17, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=51, graph.relationship.traversed=51, graph.rerank.started=1, graph.seed.selected=1, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1991
- timings: run 4179 ms, judge 2385 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 17 shown

[fake-model] Based on 17 retrieved source(s), the strongest evidence for the question is in: Incident Report: Αστάθεια εφαρμογής (INC_041), incidents: INC_041 [1].

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
- selected context (16: 8 node, 7 record, 1 document)
- selected node evidence (8):
  - `CONCEPT_INCIDENT` (BusinessConcept, 0 hop(s) via SEED, score 0.920, tier seed, graph rank 1, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.772459, 'temporal_validity': 1.0})
  - `ITYPE_GR_EFARMOGI` (IncidentType, 1 hop(s) via OF_TYPE, score 0.691, tier target, graph rank 3, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.569276, 'temporal_validity': 1.0}); source_table=incident_types, source_record_id=ITYPE_GR_EFARMOGI, incident_type_id=ITYPE_GR_EFARMOGI, market_id=MKT_GR, name=Αστάθεια εφαρμογής, language_code=el
  - `INC_014` (Incident, 2 hop(s) via AFFECTS, score 0.668, tier target, graph rank 4, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.551599, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_014, incident_id=INC_014, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_SYNDESI, started_at=2025-11-24 20:51:37, resolved_at=2025-11-25 21:50:37
  - `INC_010` (Incident, 2 hop(s) via AFFECTS, score 0.667, tier target, graph rank 5, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.547256, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_010, incident_id=INC_010, market_id=MKT_GR, severity=CRITICAL, incident_type=ITYPE_GR_EFARMOGI, started_at=2025-10-31 03:35:53, resolved_at=2025-10-31 16:24:53
  - `INC_022` (Incident, 2 hop(s) via AFFECTS, score 0.666, tier target, graph rank 6, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.545614, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_022, incident_id=INC_022, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-11-29 01:54:04, resolved_at=2025-11-29 14:58:04
  - `INC_026` (Incident, 2 hop(s) via AFFECTS, score 0.663, tier target, graph rank 7, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.53661, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_026, incident_id=INC_026, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_TERMATIKA, started_at=2025-10-13 22:15:37, resolved_at=2025-10-13 23:36:37
  - `INC_002` (Incident, 2 hop(s) via AFFECTS, score 0.659, tier target, graph rank 8, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.525192, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_002, incident_id=INC_002, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-02-05 08:29:43, resolved_at=2025-02-05 16:24:43
  - `INC_034` (Incident, 2 hop(s) via OF_TYPE, score 0.651, tier target, graph rank 9, components {'graph_distance': 0.5, 'relationship_type': 0.7, 'semantic_relevance': 0.574379, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_034, incident_id=INC_034, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_EFARMOGI, started_at=2025-06-27 16:24:49, resolved_at=2025-06-29 00:06:49
- discarded nodes: 65 (context_budget=63, same_record=2)
- hybrid channel blocks, shared with A (8):
  - `CHNK_0252_00` [chunk] Incident Report: Αστάθεια εφαρμογής (INC_041) (fused 0.0257, dense rank 25, sparse rank 12, rerank 3.130, rank 1)
  - `REC_incidents_INC_041` [record incidents] incidents: INC_041 (fused 0.0255, dense rank 39, sparse rank 5, rerank 2.380, rank 2)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0116, dense rank 26, sparse rank None, rerank 0.621, rank 3)
  - `REC_incidents_INC_021` [record incidents] incidents: INC_021 (fused 0.0115, dense rank 27, sparse rank None, rerank -1.088, rank 4)
  - `REC_incidents_INC_009` [record incidents] incidents: INC_009 (fused 0.0296, dense rank 13, sparse rank 3, rerank -1.477, rank 5)
  - `REC_incidents_INC_011` [record incidents] incidents: INC_011 (fused 0.0288, dense rank 9, sparse rank 10, rerank -1.919, rank 6)
  - `REC_incidents_INC_024` [record incidents] incidents: INC_024 (fused 0.0311, dense rank 8, sparse rank 1, rerank -2.095, rank 7)
  - `REC_incidents_INC_037` [record incidents] incidents: INC_037 (fused 0.0275, dense rank 28, sparse rank 2, rerank -2.189, rank 8)
- events: graph.candidate.discarded=97, graph.candidate.reranked=40, graph.candidate.selected=16, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=71, graph.ontology.expanded=3, graph.query.expanded=1, graph.relationship.traversed=71, graph.rerank.started=1, graph.seed.selected=2, graph.target_types.resolved=1, graph.traversal.started=1
- context tokens: 1981
- timings: run 5024 ms, judge 2389 ms over 40 candidates

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 16 shown

[fake-model] Based on 16 retrieved source(s), the strongest evidence for the question is in: Incident Report: Αστάθεια εφαρμογής (INC_041), BusinessConcept: CONCEPT_INCIDENT [1].


