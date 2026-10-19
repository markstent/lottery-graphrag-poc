# Example Traces: A/B/C Retrieval Comparison

Status: HITL-08 artefact, regenerated for pipelines v2 against the development world.

## What this document is

Verbatim output of the side-by-side trace CLI over the saved demo questions.
Each question runs through three retrieval pipelines:

- **A, conventional RAG**: dense (bge-m3) plus sparse embedding, hybrid search fused by reciprocal rank, cross-encoder reranking, one shared context budget and slot limit, generation.
  The index holds document chunks and structured record blocks, so A can retrieve table rows as well as document text.
- **B, graph relationships**: an id and market resolver seeds a bounded traversal over the structured-record subgraph (when nothing resolves, the graph node of the best-matching record block); the top nodes by graph score join A's document channel as structured candidates, judged on the same record text A indexes; nodes carry authoritative facts from the source tables.
  No ontology: no concept seeds, no `MAPS_TO` expansion, no query expansion.
- **C, graph relationships + enterprise ontology**: B plus the ontology term resolver (concept seeds and concept-bound entities, shown as `via_concept`), query expansion with concept labels and synonyms (`graph.query.expanded`), and ontology expansion during traversal.

Same question, same synthetic world, same embedding model, one reranker that judges every candidate against the raw question, same generator and prompt, one context budget and slot count.
Only the retrieval layers differ.

## How it was produced

```bash
make index-vector   # hybrid dense + sparse index in Qdrant
make ingest-graph   # development world graph in Neo4j
cd backend
uv run python -m app.retrieval.graph.traces --generator fake
```

The answers come from the deterministic fake generator, which returns the structured JSON answer (verdict plus prose with [n] citations) built from the context titles only.
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

## DEMO-01: document_structured_conflict

**Question:** What is the current ticket price for GAME_UK_01, and why does the rules document disagree with the source record?

### Pipeline A: conventional RAG

- selected context (12: 11 record, 1 document):
  - `REC_games_GAME_UK_01` [record games] games: GAME_UK_01 (fused 0.0328, dense rank 1, sparse rank 1, rerank 4.036, rank 1)
  - `REC_campaigns_CMP_002` [record campaigns] campaigns: CMP_002 (fused 0.0161, dense rank None, sparse rank 2, rerank -0.803, rank 2)
  - `REC_games_GAME_UK_03` [record games] games: GAME_UK_03 (fused 0.0288, dense rank 4, sparse rank 16, rerank -1.096, rank 3)
  - `REC_games_GAME_UK_04` [record games] games: GAME_UK_04 (fused 0.0285, dense rank 2, sparse rank 21, rerank -1.569, rank 4)
  - `REC_games_GAME_UK_02` [record games] games: GAME_UK_02 (fused 0.0292, dense rank 3, sparse rank 15, rerank -1.591, rank 5)
  - `REC_games_GAME_UK_06` [record games] games: GAME_UK_06 (fused 0.0278, dense rank 24, sparse rank 3, rerank -1.878, rank 6)
  - `REC_games_GAME_UK_05` [record games] games: GAME_UK_05 (fused 0.0145, dense rank None, sparse rank 9, rerank -2.414, rank 7)
  - `CHNK_0203_00` [chunk] Support Summary: Albion Millions (GAME_UK_01) (fused 0.0156, dense rank None, sparse rank 4, rerank -2.570, rank 8)
  - `REC_games_GAME_GR_01` [record games] games: GAME_GR_01 (fused 0.0125, dense rank None, sparse rank 20, rerank -2.999, rank 9)
  - `REC_games_GAME_AT_01` [record games] games: GAME_AT_01 (fused 0.0130, dense rank None, sparse rank 17, rerank -3.132, rank 10)
  - `REC_games_GAME_CZ_01` [record games] games: GAME_CZ_01 (fused 0.0122, dense rank None, sparse rank 22, rerank -3.566, rank 11)
  - `REC_games_GAME_AT_02` [record games] games: GAME_AT_02 (fused 0.0127, dense rank None, sparse rank 19, rerank -3.846, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 919

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: games: GAME_UK_01, campaigns: CMP_002 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `GAME_UK_01` (Game, id, matched 'GAME_UK_01')
- seeds: `GAME_UK_01`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 60
- selected context (12: 6 node, 5 record, 1 document)
- selected node evidence (6):
  - `GAME_UK_01` (Game, 0 hop(s) via SEED, score 0.879, rerank 4.036, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.653494, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_UK_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `INC_025` (Incident, 1 hop(s) via AFFECTS, score 0.694, rerank -2.683, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.507585, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_025, incident_id=INC_025, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_TERMINAL, started_at=2025-07-16 17:16:32, resolved_at=-
  - `GAME_UK_02` (Game, 2 hop(s) via HAS_MECHANIC, score 0.646, rerank -1.591, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.630354, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_02, game_id=GAME_UK_02, game_name=Kingsport Draw, market_id=MKT_UK, game_family_id=FAM_UK_ANNUITY, ticket_price=3.00, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via HAS_MECHANIC, score 0.642, rerank -1.096, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.619853, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_UK_RAPID_NUMBERS, ticket_price=1.00, currency_code=GBP
  - `GAME_UK_04` (Game, 2 hop(s) via INSTANCE_OF, score 0.627, rerank -1.569, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.648171, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_UK_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `GAME_AT_01` (Game, 2 hop(s) via RUNS_ON, score 0.620, rerank -3.132, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.557961, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_AT_ZAHLENZIEHUNG, ticket_price=2.50, currency_code=EUR
- discarded nodes: 55 (candidate_cap=21, slot_limit=34)
- hybrid channel blocks, shared with A (6):
  - `REC_campaigns_CMP_002` [record campaigns] campaigns: CMP_002 (fused 0.0161, dense rank None, sparse rank 2, rerank -0.803, rank 2)
  - `REC_games_GAME_UK_06` [record games] games: GAME_UK_06 (fused 0.0278, dense rank 24, sparse rank 3, rerank -1.878, rank 6)
  - `REC_games_GAME_UK_05` [record games] games: GAME_UK_05 (fused 0.0145, dense rank None, sparse rank 9, rerank -2.414, rank 7)
  - `CHNK_0203_00` [chunk] Support Summary: Albion Millions (GAME_UK_01) (fused 0.0156, dense rank None, sparse rank 4, rerank -2.570, rank 8)
  - `REC_games_GAME_GR_01` [record games] games: GAME_GR_01 (fused 0.0125, dense rank None, sparse rank 20, rerank -2.999, rank 10)
  - `REC_games_GAME_CZ_01` [record games] games: GAME_CZ_01 (fused 0.0122, dense rank None, sparse rank 22, rerank -3.566, rank 12)
- events: graph.candidate.discarded=89, graph.candidate.reranked=72, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=60, graph.relationship.traversed=60, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 948

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 6 retrieved source(s) and 6 authoritative structured record(s), the strongest evidence for the question is in: campaigns: CMP_002, games: GAME_UK_06 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (1):
  - `GAME_UK_01` (Game, id, matched 'GAME_UK_01')
- graph.query.expanded: 0 term(s) added, search text 113 chars
- seeds: `GAME_UK_01`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 92
- ontology concepts: `CONCEPT_DRAW_GAME`, `CONCEPT_NATIONAL_DRAW`, `CONCEPT_NUMBER_SELECTION`, `CONCEPT_QUICK_PICK`
- discovered via_concept `CONCEPT_DRAW_GAME`: 1 node(s): `CAT_GR_KLIROSEIS`
- discovered via_concept `CONCEPT_NATIONAL_DRAW`: 1 node(s): `FAM_GR_ARITHMOLACHEIO`
- discovered via_concept `CONCEPT_NUMBER_SELECTION`: 1 node(s): `MECH_GR_EPILOGI_ARITHMON`
- discovered via_concept `CONCEPT_QUICK_PICK`: 2 node(s): `MECH_GR_TYCHAIA_EPILOGI`, `MECH_AT_SCHNELLWAHL`
- selected context (12: 8 node, 3 record, 1 document)
- selected node evidence (8):
  - `GAME_UK_01` (Game, 0 hop(s) via SEED, score 0.879, rerank 4.036, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.653494, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_UK_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `INC_025` (Incident, 1 hop(s) via AFFECTS, score 0.694, rerank -2.683, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.507585, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_025, incident_id=INC_025, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_TERMINAL, started_at=2025-07-16 17:16:32, resolved_at=-
  - `GAME_UK_02` (Game, 2 hop(s) via HAS_MECHANIC, score 0.646, rerank -1.591, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.630354, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_02, game_id=GAME_UK_02, game_name=Kingsport Draw, market_id=MKT_UK, game_family_id=FAM_UK_ANNUITY, ticket_price=3.00, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via HAS_MECHANIC, score 0.642, rerank -1.096, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.619853, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_UK_RAPID_NUMBERS, ticket_price=1.00, currency_code=GBP
  - `GAME_UK_04` (Game, 2 hop(s) via INSTANCE_OF, score 0.627, rerank -1.569, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.648171, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_UK_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `GAME_AT_01` (Game, 1 hop(s) via SIMILAR_TO, score 0.612, rerank -3.132, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.557961, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_AT_ZAHLENZIEHUNG, ticket_price=2.50, currency_code=EUR
  - `GAME_CZ_01` (Game, 1 hop(s) via SIMILAR_TO, score 0.609, rerank -3.566, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.54945, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_CZ_01, game_id=GAME_CZ_01, game_name=Vltava Výhra, market_id=MKT_CZ, game_family_id=FAM_CZ_CISELNA_LOTERIE, ticket_price=20.00, currency_code=CZK
  - `GAME_GR_01` (Game, 2 hop(s) via SIMILAR_TO, score 0.573, rerank -2.999, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.566719, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_01, game_id=GAME_GR_01, game_name=Aegean Gold, market_id=MKT_GR, game_family_id=FAM_GR_ARITHMOLACHEIO, ticket_price=2.00, currency_code=EUR
- discarded nodes: 85 (candidate_cap=53, slot_limit=32)
- hybrid channel blocks, shared with A (4):
  - `REC_campaigns_CMP_002` [record campaigns] campaigns: CMP_002 (fused 0.0161, dense rank None, sparse rank 2, rerank -0.803, rank 2)
  - `REC_games_GAME_UK_06` [record games] games: GAME_UK_06 (fused 0.0278, dense rank 24, sparse rank 3, rerank -1.878, rank 6)
  - `REC_games_GAME_UK_05` [record games] games: GAME_UK_05 (fused 0.0145, dense rank None, sparse rank 9, rerank -2.414, rank 7)
  - `CHNK_0203_00` [chunk] Support Summary: Albion Millions (GAME_UK_01) (fused 0.0156, dense rank None, sparse rank 4, rerank -2.570, rank 8)
- events: graph.candidate.discarded=121, graph.candidate.reranked=70, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=92, graph.ontology.expanded=4, graph.query.expanded=1, graph.relationship.traversed=92, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 948

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 4 retrieved source(s) and 8 authoritative structured record(s), the strongest evidence for the question is in: campaigns: CMP_002, games: GAME_UK_06 [1].


## DEMO-02: cross_market_platform_incident

**Question:** Have we seen this digital checkout problem in other markets? Which platform version connects the Greek payment checkout incident on platform version PLV_PAYMENTS_3 to the other markets, and why was the UK unaffected?

### Pipeline A: conventional RAG

- selected context (12: 10 record, 2 document):
  - `REC_incidents_INC_042` [record incidents] incidents: INC_042 (fused 0.0320, dense rank 2, sparse rank 3, rerank 3.106, rank 1)
  - `CHNK_0256_00` [chunk] Release Note: APPV_UK_530 (Deferred Update) (fused 0.0328, dense rank 1, sparse rank 1, rerank 2.729, rank 2)
  - `REC_incidents_INC_002` [record incidents] incidents: INC_002 (fused 0.0306, dense rank 4, sparse rank 7, rerank 2.197, rank 3)
  - `REC_incidents_INC_022` [record incidents] incidents: INC_022 (fused 0.0310, dense rank 3, sparse rank 6, rerank 1.668, rank 4)
  - `REC_incidents_INC_043` [record incidents] incidents: INC_043 (fused 0.0311, dense rank 7, sparse rank 2, rerank 0.374, rank 5)
  - `REC_incidents_INC_017` [record incidents] incidents: INC_017 (fused 0.0301, dense rank 8, sparse rank 5, rerank 0.354, rank 6)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0308, dense rank 6, sparse rank 4, rerank 0.038, rank 7)
  - `REC_incidents_INC_006` [record incidents] incidents: INC_006 (fused 0.0251, dense rank 9, sparse rank 34, rerank -0.199, rank 8)
  - `REC_incidents_INC_018` [record incidents] incidents: INC_018 (fused 0.0297, dense rank 5, sparse rank 10, rerank -0.209, rank 9)
  - `CHNK_0132_00` [chunk] Incident Report: Αποτυχία πληρωμών (INC_022) (fused 0.0123, dense rank 21, sparse rank None, rerank -1.011, rank 10)
  - `REC_incidents_INC_010` [record incidents] incidents: INC_010 (fused 0.0240, dense rank 19, sparse rank 28, rerank -1.055, rank 11)
  - `REC_incidents_INC_026` [record incidents] incidents: INC_026 (fused 0.0141, dense rank 11, sparse rank None, rerank -1.176, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 1373

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: incidents: INC_042, Release Note: APPV_UK_530 (Deferred Update) [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (2):
  - `PLV_PAYMENTS_3` (PlatformVersion, id, matched 'PLV_PAYMENTS_3')
  - `MKT_UK` (Market, market_alias, matched 'uk')
- seeds: `PLV_PAYMENTS_3`, `MKT_UK`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 88
- selected context (12: 5 node, 5 record, 2 document)
- selected node evidence (5):
  - `INC_042` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.795, rerank 3.106, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.724801, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_042, incident_id=INC_042, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_PLIROMES, started_at=2025-05-21 11:00:00, resolved_at=2025-05-23 11:00:00
  - `INC_022` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.777, rerank 1.668, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.672106, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_022, incident_id=INC_022, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-11-29 01:54:04, resolved_at=2025-11-29 14:58:04
  - `INC_002` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.776, rerank 2.197, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.668258, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_002, incident_id=INC_002, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-02-05 08:29:43, resolved_at=2025-02-05 16:24:43
  - `INC_017` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.762, rerank 0.354, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.628734, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_017, incident_id=INC_017, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_PAYMENT_FAILURE, started_at=2025-03-24 20:50:16, resolved_at=2025-03-25 22:05:16
  - `INC_018` (Incident, 2 hop(s) via RELATED_TO, score 0.630, rerank -0.209, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.657356, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_018, incident_id=INC_018, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-08-19 23:46:27, resolved_at=2025-08-20 17:07:27
- discarded nodes: 85 (candidate_cap=50, slot_limit=35)
- hybrid channel blocks, shared with A (7):
  - `CHNK_0256_00` [chunk] Release Note: APPV_UK_530 (Deferred Update) (fused 0.0328, dense rank 1, sparse rank 1, rerank 2.729, rank 2)
  - `REC_incidents_INC_043` [record incidents] incidents: INC_043 (fused 0.0311, dense rank 7, sparse rank 2, rerank 0.374, rank 5)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0308, dense rank 6, sparse rank 4, rerank 0.038, rank 7)
  - `REC_incidents_INC_006` [record incidents] incidents: INC_006 (fused 0.0251, dense rank 9, sparse rank 34, rerank -0.199, rank 8)
  - `CHNK_0132_00` [chunk] Incident Report: Αποτυχία πληρωμών (INC_022) (fused 0.0123, dense rank 21, sparse rank None, rerank -1.011, rank 10)
  - `REC_incidents_INC_010` [record incidents] incidents: INC_010 (fused 0.0240, dense rank 19, sparse rank 28, rerank -1.055, rank 11)
  - `REC_incidents_INC_026` [record incidents] incidents: INC_026 (fused 0.0141, dense rank 11, sparse rank None, rerank -1.176, rank 12)
- events: graph.candidate.discarded=118, graph.candidate.reranked=73, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=88, graph.relationship.traversed=88, graph.seed.selected=2, graph.traversal.started=1
- context tokens: 1373

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 7 retrieved source(s) and 5 authoritative structured record(s), the strongest evidence for the question is in: Release Note: APPV_UK_530 (Deferred Update), incidents: INC_043 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (4):
  - `PLV_PAYMENTS_3` (PlatformVersion, id, matched 'PLV_PAYMENTS_3')
  - `MKT_UK` (Market, market_alias, matched 'uk')
  - `CONCEPT_DIGITAL_CHANNEL` (BusinessConcept, term, matched 'digital')
  - `CONCEPT_INCIDENT` (BusinessConcept, term, matched 'incident')
- graph.query.expanded: 21 term(s) added, search text 480 chars
- seeds: `PLV_PAYMENTS_3`, `MKT_UK`, `CONCEPT_DIGITAL_CHANNEL`, `CONCEPT_INCIDENT`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 112
- ontology concepts: `CONCEPT_APPLICATION_INCIDENT`, `CONCEPT_DIGITAL_CHANNEL`, `CONCEPT_DRAW_INCIDENT`, `CONCEPT_IDENTITY_INCIDENT`, `CONCEPT_INCIDENT`, `CONCEPT_PLATFORM_INCIDENT`, `CONCEPT_RETAIL_CHANNEL`, `CONCEPT_SALES_CHANNEL`
- discovered via_concept `CONCEPT_APPLICATION_INCIDENT`: 4 node(s): `ITYPE_GR_EFARMOGI`, `ITYPE_AT_APP`, `ITYPE_CZ_APLIKACE`, `ITYPE_CORP_APPLICATION`
- discovered via_concept `CONCEPT_DRAW_INCIDENT`: 4 node(s): `ITYPE_GR_KLIROSI`, `ITYPE_CZ_LOSOVANI`, `ITYPE_AT_ZIEHUNG`, `ITYPE_CORP_DRAW`
- discovered via_concept `CONCEPT_IDENTITY_INCIDENT`: 4 node(s): `ITYPE_GR_SYNDESI`, `ITYPE_CZ_PRIHLASENI`, `ITYPE_AT_ANMELDUNG`, `ITYPE_CORP_IDENTITY`
- discovered via_concept `CONCEPT_RETAIL_CHANNEL`: 1 node(s): `RETAIL`
- selected context (12: 6 node, 4 record, 2 document)
- selected node evidence (6):
  - `INC_042` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.765, rerank 3.106, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.638107, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_042, incident_id=INC_042, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_PLIROMES, started_at=2025-05-21 11:00:00, resolved_at=2025-05-23 11:00:00
  - `INC_002` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.751, rerank 2.197, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.597798, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_002, incident_id=INC_002, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-02-05 08:29:43, resolved_at=2025-02-05 16:24:43
  - `INC_022` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.750, rerank 1.668, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.596152, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_022, incident_id=INC_022, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-11-29 01:54:04, resolved_at=2025-11-29 14:58:04
  - `INC_017` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.741, rerank 0.354, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.570416, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_017, incident_id=INC_017, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_PAYMENT_FAILURE, started_at=2025-03-24 20:50:16, resolved_at=2025-03-25 22:05:16
  - `INC_001` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.668, rerank -1.284, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.575464, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-11-10 23:30:31, resolved_at=2025-11-13 19:40:31
  - `INC_018` (Incident, 2 hop(s) via RELATED_TO, score 0.613, rerank -0.209, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.608544, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_018, incident_id=INC_018, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-08-19 23:46:27, resolved_at=2025-08-20 17:07:27
- discarded nodes: 110 (candidate_cap=76, slot_limit=34)
- hybrid channel blocks, shared with A (6):
  - `CHNK_0256_00` [chunk] Release Note: APPV_UK_530 (Deferred Update) (fused 0.0325, dense rank 1, sparse rank 2, rerank 2.729, rank 2)
  - `REC_incidents_INC_043` [record incidents] incidents: INC_043 (fused 0.0312, dense rank 4, sparse rank 4, rerank 0.374, rank 5)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.0303, dense rank 6, sparse rank 6, rerank 0.038, rank 7)
  - `REC_incidents_INC_006` [record incidents] incidents: INC_006 (fused 0.0258, dense rank 5, sparse rank 36, rerank -0.199, rank 8)
  - `CHNK_0132_00` [chunk] Incident Report: Αποτυχία πληρωμών (INC_022) (fused 0.0120, dense rank 23, sparse rank None, rerank -1.011, rank 10)
  - `REC_incidents_INC_026` [record incidents] incidents: INC_026 (fused 0.0245, dense rank 10, sparse rank 38, rerank -1.176, rank 11)
- events: graph.candidate.discarded=144, graph.candidate.reranked=72, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=4, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=112, graph.ontology.expanded=4, graph.query.expanded=1, graph.relationship.traversed=112, graph.seed.selected=4, graph.traversal.started=1
- context tokens: 1383

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 6 retrieved source(s) and 6 authoritative structured record(s), the strongest evidence for the question is in: Release Note: APPV_UK_530 (Deferred Update), incidents: INC_043 [1].


## DEMO-03: shared_payment_cluster

**Question:** Which accounts share payment instruments with PLAYER_GR_001283, and how many accounts are involved?

### Pipeline A: conventional RAG

- selected context (12: 12 record, 0 document):
  - `REC_devices_DEV_GR_001499` [record devices] devices: DEV_GR_001499 (fused 0.0159, dense rank None, sparse rank 3, rerank 3.324, rank 1)
  - `REC_payment_methods_PAY_SHARED_004` [record payment_methods] payment_methods: PAY_SHARED_004 (fused 0.0240, dense rank 24, sparse rank 23, rerank 1.521, rank 2)
  - `REC_payment_methods_PAY_SHARED_033` [record payment_methods] payment_methods: PAY_SHARED_033 (fused 0.0269, dense rank 4, sparse rank 29, rerank 1.475, rank 3)
  - `REC_payment_methods_PAY_SHARED_065` [record payment_methods] payment_methods: PAY_SHARED_065 (fused 0.0218, dense rank 27, sparse rank 37, rerank 1.276, rank 4)
  - `REC_payment_methods_PAY_SHARED_076` [record payment_methods] payment_methods: PAY_SHARED_076 (fused 0.0240, dense rank 25, sparse rank 22, rerank 0.954, rank 5)
  - `REC_payment_methods_PAY_SHARED_018` [record payment_methods] payment_methods: PAY_SHARED_018 (fused 0.0154, dense rank 5, sparse rank None, rerank 0.904, rank 6)
  - `REC_payment_methods_PAY_SHARED_035` [record payment_methods] payment_methods: PAY_SHARED_035 (fused 0.0135, dense rank None, sparse rank 14, rerank 0.788, rank 7)
  - `REC_payment_methods_PAY_SHARED_023` [record payment_methods] payment_methods: PAY_SHARED_023 (fused 0.0243, dense rank 18, sparse rank 27, rerank 0.675, rank 8)
  - `REC_payment_methods_PAY_SHARED_034` [record payment_methods] payment_methods: PAY_SHARED_034 (fused 0.0272, dense rank 2, sparse rank 30, rerank 0.671, rank 9)
  - `REC_payment_methods_PAY_SHARED_075` [record payment_methods] payment_methods: PAY_SHARED_075 (fused 0.0159, dense rank 3, sparse rank None, rerank 0.584, rank 10)
  - `REC_payment_methods_PAY_SHARED_067` [record payment_methods] payment_methods: PAY_SHARED_067 (fused 0.0274, dense rank 7, sparse rank 20, rerank 0.562, rank 11)
  - `REC_payment_methods_PAY_SHARED_036` [record payment_methods] payment_methods: PAY_SHARED_036 (fused 0.0139, dense rank 12, sparse rank None, rerank 0.540, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 791

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: devices: DEV_GR_001499, payment_methods: PAY_SHARED_004 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `PLAYER_GR_001283` (Player, id, matched 'PLAYER_GR_001283')
- seeds: `PLAYER_GR_001283`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 17
- selected context (12: 2 node, 10 record, 0 document)
- selected node evidence (2):
  - `PAY_GR_0004311` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.773, rerank 1.166, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.732578, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_GR_0004311, accounts_sharing=1, links=PLAYER_GR_001283[weight=1.0,from=2025-05-15]
  - `DEV_GR_001499` (Device, 1 hop(s) via USES, score 0.630, rerank 3.324, components {'graph_distance': 0.666667, 'relationship_type': 0.3, 'semantic_relevance': 0.679583, 'temporal_validity': 1.0})
- discarded nodes: 16 (slot_limit=16)
- hybrid channel blocks, shared with A (10):
  - `REC_payment_methods_PAY_SHARED_004` [record payment_methods] payment_methods: PAY_SHARED_004 (fused 0.0240, dense rank 24, sparse rank 23, rerank 1.521, rank 2)
  - `REC_payment_methods_PAY_SHARED_033` [record payment_methods] payment_methods: PAY_SHARED_033 (fused 0.0269, dense rank 4, sparse rank 29, rerank 1.475, rank 3)
  - `REC_payment_methods_PAY_SHARED_065` [record payment_methods] payment_methods: PAY_SHARED_065 (fused 0.0218, dense rank 27, sparse rank 37, rerank 1.276, rank 4)
  - `REC_payment_methods_PAY_SHARED_076` [record payment_methods] payment_methods: PAY_SHARED_076 (fused 0.0240, dense rank 25, sparse rank 22, rerank 0.954, rank 6)
  - `REC_payment_methods_PAY_SHARED_018` [record payment_methods] payment_methods: PAY_SHARED_018 (fused 0.0154, dense rank 5, sparse rank None, rerank 0.904, rank 7)
  - `REC_payment_methods_PAY_SHARED_035` [record payment_methods] payment_methods: PAY_SHARED_035 (fused 0.0135, dense rank None, sparse rank 14, rerank 0.788, rank 8)
  - `REC_payment_methods_PAY_SHARED_023` [record payment_methods] payment_methods: PAY_SHARED_023 (fused 0.0243, dense rank 18, sparse rank 27, rerank 0.675, rank 9)
  - `REC_payment_methods_PAY_SHARED_034` [record payment_methods] payment_methods: PAY_SHARED_034 (fused 0.0272, dense rank 2, sparse rank 30, rerank 0.671, rank 10)
  - `REC_payment_methods_PAY_SHARED_075` [record payment_methods] payment_methods: PAY_SHARED_075 (fused 0.0159, dense rank 3, sparse rank None, rerank 0.584, rank 11)
  - `REC_payment_methods_PAY_SHARED_067` [record payment_methods] payment_methods: PAY_SHARED_067 (fused 0.0274, dense rank 7, sparse rank 20, rerank 0.562, rank 12)
- events: graph.candidate.discarded=46, graph.candidate.reranked=56, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=17, graph.relationship.traversed=17, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 745

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 10 retrieved source(s) and 2 authoritative structured record(s), the strongest evidence for the question is in: payment_methods: PAY_SHARED_004, payment_methods: PAY_SHARED_033 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (1):
  - `PLAYER_GR_001283` (Player, id, matched 'PLAYER_GR_001283')
- graph.query.expanded: 0 term(s) added, search text 99 chars
- seeds: `PLAYER_GR_001283`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 25
- ontology concepts: `CONCEPT_BUDGET_VALUE`, `CONCEPT_CASUAL`
- discovered via_concept `CONCEPT_BUDGET_VALUE`: 3 node(s): `SEG_UK_BUDGET`, `SEG_AT_SPARSAM`, `SEG_CZ_USPORNI`
- discovered via_concept `CONCEPT_CASUAL`: 3 node(s): `SEG_UK_CASUAL`, `SEG_AT_GELEGENTLICH`, `SEG_CZ_OBCASNI`
- selected context (12: 2 node, 10 record, 0 document)
- selected node evidence (2):
  - `PAY_GR_0004311` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.773, rerank 1.166, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.732578, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_GR_0004311, accounts_sharing=1, links=PLAYER_GR_001283[weight=1.0,from=2025-05-15]
  - `DEV_GR_001499` (Device, 1 hop(s) via USES, score 0.630, rerank 3.324, components {'graph_distance': 0.666667, 'relationship_type': 0.3, 'semantic_relevance': 0.679583, 'temporal_validity': 1.0})
- discarded nodes: 24 (slot_limit=24)
- hybrid channel blocks, shared with A (10):
  - `REC_payment_methods_PAY_SHARED_004` [record payment_methods] payment_methods: PAY_SHARED_004 (fused 0.0240, dense rank 24, sparse rank 23, rerank 1.521, rank 2)
  - `REC_payment_methods_PAY_SHARED_033` [record payment_methods] payment_methods: PAY_SHARED_033 (fused 0.0269, dense rank 4, sparse rank 29, rerank 1.475, rank 3)
  - `REC_payment_methods_PAY_SHARED_065` [record payment_methods] payment_methods: PAY_SHARED_065 (fused 0.0218, dense rank 27, sparse rank 37, rerank 1.276, rank 4)
  - `REC_payment_methods_PAY_SHARED_076` [record payment_methods] payment_methods: PAY_SHARED_076 (fused 0.0240, dense rank 25, sparse rank 22, rerank 0.954, rank 6)
  - `REC_payment_methods_PAY_SHARED_018` [record payment_methods] payment_methods: PAY_SHARED_018 (fused 0.0154, dense rank 5, sparse rank None, rerank 0.904, rank 7)
  - `REC_payment_methods_PAY_SHARED_035` [record payment_methods] payment_methods: PAY_SHARED_035 (fused 0.0135, dense rank None, sparse rank 14, rerank 0.788, rank 8)
  - `REC_payment_methods_PAY_SHARED_023` [record payment_methods] payment_methods: PAY_SHARED_023 (fused 0.0243, dense rank 18, sparse rank 27, rerank 0.675, rank 9)
  - `REC_payment_methods_PAY_SHARED_034` [record payment_methods] payment_methods: PAY_SHARED_034 (fused 0.0272, dense rank 2, sparse rank 30, rerank 0.671, rank 10)
  - `REC_payment_methods_PAY_SHARED_075` [record payment_methods] payment_methods: PAY_SHARED_075 (fused 0.0159, dense rank 3, sparse rank None, rerank 0.584, rank 11)
  - `REC_payment_methods_PAY_SHARED_067` [record payment_methods] payment_methods: PAY_SHARED_067 (fused 0.0274, dense rank 7, sparse rank 20, rerank 0.562, rank 12)
- events: graph.candidate.discarded=54, graph.candidate.reranked=64, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=25, graph.ontology.expanded=2, graph.query.expanded=1, graph.relationship.traversed=25, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 745

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 10 retrieved source(s) and 2 authoritative structured record(s), the strongest evidence for the question is in: payment_methods: PAY_SHARED_004, payment_methods: PAY_SHARED_033 [1].


## DEMO-04: shared_identity_cluster

**Question:** Are there player accounts that look like the same person operating multiple identities across devices?

### Pipeline A: conventional RAG

- selected context (12: 12 record, 0 document):
  - `REC_devices_DEV_AT_000710` [record devices] devices: DEV_AT_000710 (fused 0.0145, dense rank 9, sparse rank None, rerank -3.818, rank 1)
  - `REC_devices_DEV_AT_000227` [record devices] devices: DEV_AT_000227 (fused 0.0147, dense rank 8, sparse rank None, rerank -3.822, rank 2)
  - `REC_devices_DEV_AT_000812` [record devices] devices: DEV_AT_000812 (fused 0.0143, dense rank 10, sparse rank None, rerank -3.857, rank 3)
  - `REC_devices_DEV_AT_000998` [record devices] devices: DEV_AT_000998 (fused 0.0125, dense rank 20, sparse rank None, rerank -3.874, rank 4)
  - `REC_devices_DEV_AT_000827` [record devices] devices: DEV_AT_000827 (fused 0.0149, dense rank 7, sparse rank None, rerank -3.881, rank 5)
  - `REC_devices_DEV_AT_001739` [record devices] devices: DEV_AT_001739 (fused 0.0154, dense rank 5, sparse rank None, rerank -3.906, rank 6)
  - `REC_devices_DEV_AT_000968` [record devices] devices: DEV_AT_000968 (fused 0.0135, dense rank 14, sparse rank None, rerank -3.910, rank 7)
  - `REC_devices_DEV_AT_000920` [record devices] devices: DEV_AT_000920 (fused 0.0152, dense rank 6, sparse rank None, rerank -3.916, rank 8)
  - `REC_devices_DEV_AT_000182` [record devices] devices: DEV_AT_000182 (fused 0.0127, dense rank 19, sparse rank None, rerank -3.917, rank 9)
  - `REC_devices_DEV_AT_000713` [record devices] devices: DEV_AT_000713 (fused 0.0156, dense rank 4, sparse rank None, rerank -3.918, rank 10)
  - `REC_devices_DEV_AT_000770` [record devices] devices: DEV_AT_000770 (fused 0.0141, dense rank 11, sparse rank None, rerank -3.926, rank 11)
  - `REC_devices_DEV_AT_000782` [record devices] devices: DEV_AT_000782 (fused 0.0128, dense rank 18, sparse rank None, rerank -3.945, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 609

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: devices: DEV_AT_000710, devices: DEV_AT_000227 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `DEV_AT_002318` (Device, vector_fallback, matched 'Are there player accounts that look like the same person operati')
- seeds: `DEV_AT_002318`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 10
- selected context (12: 0 node, 12 record, 0 document)
- selected node evidence (0):
- discarded nodes: 11 (slot_limit=11)
- hybrid channel blocks, shared with A (12):
  - `REC_devices_DEV_AT_000710` [record devices] devices: DEV_AT_000710 (fused 0.0145, dense rank 9, sparse rank None, rerank -3.818, rank 1)
  - `REC_devices_DEV_AT_000227` [record devices] devices: DEV_AT_000227 (fused 0.0147, dense rank 8, sparse rank None, rerank -3.822, rank 2)
  - `REC_devices_DEV_AT_000812` [record devices] devices: DEV_AT_000812 (fused 0.0143, dense rank 10, sparse rank None, rerank -3.857, rank 3)
  - `REC_devices_DEV_AT_000998` [record devices] devices: DEV_AT_000998 (fused 0.0125, dense rank 20, sparse rank None, rerank -3.874, rank 4)
  - `REC_devices_DEV_AT_000827` [record devices] devices: DEV_AT_000827 (fused 0.0149, dense rank 7, sparse rank None, rerank -3.881, rank 5)
  - `REC_devices_DEV_AT_001739` [record devices] devices: DEV_AT_001739 (fused 0.0154, dense rank 5, sparse rank None, rerank -3.906, rank 6)
  - `REC_devices_DEV_AT_000968` [record devices] devices: DEV_AT_000968 (fused 0.0135, dense rank 14, sparse rank None, rerank -3.910, rank 7)
  - `REC_devices_DEV_AT_000920` [record devices] devices: DEV_AT_000920 (fused 0.0152, dense rank 6, sparse rank None, rerank -3.916, rank 8)
  - `REC_devices_DEV_AT_000182` [record devices] devices: DEV_AT_000182 (fused 0.0127, dense rank 19, sparse rank None, rerank -3.917, rank 9)
  - `REC_devices_DEV_AT_000713` [record devices] devices: DEV_AT_000713 (fused 0.0156, dense rank 4, sparse rank None, rerank -3.918, rank 10)
  - `REC_devices_DEV_AT_000770` [record devices] devices: DEV_AT_000770 (fused 0.0141, dense rank 11, sparse rank None, rerank -3.926, rank 11)
  - `REC_devices_DEV_AT_000782` [record devices] devices: DEV_AT_000782 (fused 0.0128, dense rank 18, sparse rank None, rerank -3.945, rank 12)
- events: graph.candidate.discarded=39, graph.candidate.reranked=50, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=10, graph.relationship.traversed=10, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 609

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: devices: DEV_AT_000710, devices: DEV_AT_000227 [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (1):
  - `DEV_AT_002318` (Device, vector_fallback, matched 'Are there player accounts that look like the same person operati')
- graph.query.expanded: 0 term(s) added, search text 102 chars
- seeds: `DEV_AT_002318`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 10
- selected context (12: 0 node, 12 record, 0 document)
- selected node evidence (0):
- discarded nodes: 11 (slot_limit=11)
- hybrid channel blocks, shared with A (12):
  - `REC_devices_DEV_AT_000710` [record devices] devices: DEV_AT_000710 (fused 0.0145, dense rank 9, sparse rank None, rerank -3.818, rank 1)
  - `REC_devices_DEV_AT_000227` [record devices] devices: DEV_AT_000227 (fused 0.0147, dense rank 8, sparse rank None, rerank -3.822, rank 2)
  - `REC_devices_DEV_AT_000812` [record devices] devices: DEV_AT_000812 (fused 0.0143, dense rank 10, sparse rank None, rerank -3.857, rank 3)
  - `REC_devices_DEV_AT_000998` [record devices] devices: DEV_AT_000998 (fused 0.0125, dense rank 20, sparse rank None, rerank -3.874, rank 4)
  - `REC_devices_DEV_AT_000827` [record devices] devices: DEV_AT_000827 (fused 0.0149, dense rank 7, sparse rank None, rerank -3.881, rank 5)
  - `REC_devices_DEV_AT_001739` [record devices] devices: DEV_AT_001739 (fused 0.0154, dense rank 5, sparse rank None, rerank -3.906, rank 6)
  - `REC_devices_DEV_AT_000968` [record devices] devices: DEV_AT_000968 (fused 0.0135, dense rank 14, sparse rank None, rerank -3.910, rank 7)
  - `REC_devices_DEV_AT_000920` [record devices] devices: DEV_AT_000920 (fused 0.0152, dense rank 6, sparse rank None, rerank -3.916, rank 8)
  - `REC_devices_DEV_AT_000182` [record devices] devices: DEV_AT_000182 (fused 0.0127, dense rank 19, sparse rank None, rerank -3.917, rank 9)
  - `REC_devices_DEV_AT_000713` [record devices] devices: DEV_AT_000713 (fused 0.0156, dense rank 4, sparse rank None, rerank -3.918, rank 10)
  - `REC_devices_DEV_AT_000770` [record devices] devices: DEV_AT_000770 (fused 0.0141, dense rank 11, sparse rank None, rerank -3.926, rank 11)
  - `REC_devices_DEV_AT_000782` [record devices] devices: DEV_AT_000782 (fused 0.0128, dense rank 18, sparse rank None, rerank -3.945, rank 12)
- events: graph.candidate.discarded=39, graph.candidate.reranked=50, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=10, graph.query.expanded=1, graph.relationship.traversed=10, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 609

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: devices: DEV_AT_000710, devices: DEV_AT_000227 [1].


