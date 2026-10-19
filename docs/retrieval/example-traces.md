# Example Traces: A/B/C Retrieval Comparison

Status: HITL-08 artefact, regenerated for pipelines v2 against the development world.

## What this document is

Verbatim output of the side-by-side trace CLI over the saved demo questions.
Each question runs through three retrieval pipelines:

- **A, conventional RAG**: dense (bge-m3) plus sparse embedding, hybrid search fused by reciprocal rank, cross-encoder reranking, one shared context budget and slot limit, generation.
  The index holds document chunks and structured record blocks, so A can retrieve table rows as well as document text.
- **B, graph relationships**: an id and market resolver seeds a bounded traversal over the structured-record subgraph; selected nodes carry authoritative facts from the source tables; documents come from the same hybrid channel as A.
  No ontology: no concept seeds, no `MAPS_TO` expansion, no query expansion.
- **C, graph relationships + enterprise ontology**: B plus the ontology term resolver (concept seeds and concept-bound entities, shown as `via_concept`), query expansion with concept labels and synonyms (`graph.query.expanded`), and ontology expansion during traversal.

Same question, same synthetic world, same embedding model, same reranker, same generator and prompt, one context budget.
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

- *selected context* (A): each selected block with its kind (`chunk` for document text, `record` for a table row), fused score, cross-encoder score and final rank (per-channel dense and sparse ranks only when the store reports them).
- *resolved entities* (B, C): resolver output with its origin; concept-bound entities name the concept they came through (`via_concept`).
- *graph.query.expanded* (C): how many concept terms were added to the search text.
- *discovered via_concept* (C): nodes reached through ontology expansion, grouped by the concept that bound them.
- *selected node evidence*: graph nodes chosen as evidence with hop distance, relationship, score components and authoritative facts.
- *events*: counts of the structured telemetry stream that drives the UI.
- *Answer*: the parsed verdict, the prose answer and the cited context blocks.

---

## DEMO-01: document_structured_conflict

**Question:** What is the current ticket price for GAME_UK_01, and why does the rules document disagree with the source record?

### Pipeline A: conventional RAG

- selected context (12: 11 record, 1 document):
  - `REC_games_GAME_UK_01` [record games] games: GAME_UK_01 (fused 1.0000, rerank 4.036, rank 1)
  - `REC_campaigns_CMP_002` [record campaigns] campaigns: CMP_002 (fused 0.3333, rerank -0.803, rank 2)
  - `REC_games_GAME_UK_03` [record games] games: GAME_UK_03 (fused 0.2625, rerank -1.096, rank 3)
  - `REC_games_GAME_UK_04` [record games] games: GAME_UK_04 (fused 0.3788, rerank -1.569, rank 4)
  - `REC_games_GAME_UK_02` [record games] games: GAME_UK_02 (fused 0.3167, rerank -1.591, rank 5)
  - `REC_games_GAME_UK_06` [record games] games: GAME_UK_06 (fused 0.2900, rerank -1.878, rank 6)
  - `REC_games_GAME_UK_05` [record games] games: GAME_UK_05 (fused 0.1111, rerank -2.414, rank 7)
  - `CHNK_0203_00` [chunk] Support Summary: Albion Millions (GAME_UK_01) (fused 0.2000, rerank -2.570, rank 8)
  - `REC_games_GAME_GR_01` [record games] games: GAME_GR_01 (fused 0.0476, rerank -2.999, rank 9)
  - `REC_games_GAME_AT_01` [record games] games: GAME_AT_01 (fused 0.0556, rerank -3.132, rank 10)
  - `REC_games_GAME_CZ_01` [record games] games: GAME_CZ_01 (fused 0.0435, rerank -3.566, rank 11)
  - `REC_games_GAME_AT_02` [record games] games: GAME_AT_02 (fused 0.0500, rerank -3.846, rank 12)
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
- selected node evidence (12):
  - `GAME_UK_01` (Game, 0 hop(s) via SEED, score 0.883, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.665908, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_UK_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `INC_025` (Incident, 1 hop(s) via AFFECTS, score 0.673, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.446981, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_025, incident_id=INC_025, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_TERMINAL, started_at=2025-07-16 17:16:32, resolved_at=-
  - `SUP_00121` (SupportCase, 1 hop(s) via CONCERNS, score 0.652, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.458439, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00121, support_case_id=SUP_00121, market_id=MKT_UK, category_code=SUPC_UK_GAME, opened_at=2025-02-20 10:12:09, summary_text=Synthetic support contact describing a player-reported issue.
  - `MECH_UK_NUMBER_MATCH` (GameMechanic, 1 hop(s) via HAS_MECHANIC, score 0.650, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.523541, 'temporal_validity': 1.0})
  - `SUP_00125` (SupportCase, 1 hop(s) via CONCERNS, score 0.647, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.443704, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00125, support_case_id=SUP_00125, market_id=MKT_UK, category_code=SUPC_UK_ACCOUNT, opened_at=2025-03-21 05:14:42, summary_text=Synthetic support contact describing a player-reported issue.
  - `GAME_UK_02` (Game, 2 hop(s) via HAS_MECHANIC, score 0.645, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.629095, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_02, game_id=GAME_UK_02, game_name=Kingsport Draw, market_id=MKT_UK, game_family_id=FAM_UK_ANNUITY, ticket_price=3.00, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via HAS_MECHANIC, score 0.645, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.628989, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_UK_RAPID_NUMBERS, ticket_price=1.00, currency_code=GBP
  - `SUP_00161` (SupportCase, 1 hop(s) via CONCERNS, score 0.643, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.431421, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00161, support_case_id=SUP_00161, market_id=MKT_UK, category_code=SUPC_UK_TECHNICAL, opened_at=2025-08-11 12:06:48, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00049` (SupportCase, 1 hop(s) via CONCERNS, score 0.639, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.422067, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00049, support_case_id=SUP_00049, market_id=MKT_UK, category_code=SUPC_UK_TECHNICAL, opened_at=2025-11-07 06:57:30, summary_text=Synthetic support contact describing a player-reported issue.
  - `GAME_UK_04` (Game, 2 hop(s) via INSTANCE_OF, score 0.626, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.645521, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_UK_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `GAME_AT_01` (Game, 2 hop(s) via RUNS_ON, score 0.625, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.570431, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_AT_ZAHLENZIEHUNG, ticket_price=2.50, currency_code=EUR
  - `MECH_UK_QUICK_PICK` (GameMechanic, 1 hop(s) via HAS_MECHANIC, score 0.618, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.432607, 'temporal_validity': 1.0})
- discarded nodes: 49
- events: graph.candidate.discarded=89, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=60, graph.relationship.traversed=60, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 797

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].

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
- selected node evidence (12):
  - `GAME_UK_01` (Game, 0 hop(s) via SEED, score 0.883, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.665908, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_UK_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `INC_025` (Incident, 1 hop(s) via AFFECTS, score 0.673, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.446981, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_025, incident_id=INC_025, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_TERMINAL, started_at=2025-07-16 17:16:32, resolved_at=-
  - `SUP_00121` (SupportCase, 1 hop(s) via CONCERNS, score 0.652, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.458439, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00121, support_case_id=SUP_00121, market_id=MKT_UK, category_code=SUPC_UK_GAME, opened_at=2025-02-20 10:12:09, summary_text=Synthetic support contact describing a player-reported issue.
  - `MECH_UK_NUMBER_MATCH` (GameMechanic, 1 hop(s) via HAS_MECHANIC, score 0.650, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.523541, 'temporal_validity': 1.0})
  - `SUP_00125` (SupportCase, 1 hop(s) via CONCERNS, score 0.647, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.443704, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00125, support_case_id=SUP_00125, market_id=MKT_UK, category_code=SUPC_UK_ACCOUNT, opened_at=2025-03-21 05:14:42, summary_text=Synthetic support contact describing a player-reported issue.
  - `GAME_UK_02` (Game, 2 hop(s) via HAS_MECHANIC, score 0.645, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.629095, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_02, game_id=GAME_UK_02, game_name=Kingsport Draw, market_id=MKT_UK, game_family_id=FAM_UK_ANNUITY, ticket_price=3.00, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via HAS_MECHANIC, score 0.645, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.628989, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_UK_RAPID_NUMBERS, ticket_price=1.00, currency_code=GBP
  - `SUP_00161` (SupportCase, 1 hop(s) via CONCERNS, score 0.643, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.431421, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00161, support_case_id=SUP_00161, market_id=MKT_UK, category_code=SUPC_UK_TECHNICAL, opened_at=2025-08-11 12:06:48, summary_text=Synthetic support contact describing a player-reported issue.
  - `SUP_00049` (SupportCase, 1 hop(s) via CONCERNS, score 0.639, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.422067, 'temporal_validity': 1.0}); source_table=support_cases, source_record_id=SUP_00049, support_case_id=SUP_00049, market_id=MKT_UK, category_code=SUPC_UK_TECHNICAL, opened_at=2025-11-07 06:57:30, summary_text=Synthetic support contact describing a player-reported issue.
  - `GAME_UK_04` (Game, 2 hop(s) via INSTANCE_OF, score 0.626, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.645521, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_UK_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `MECH_UK_QUICK_PICK` (GameMechanic, 1 hop(s) via HAS_MECHANIC, score 0.618, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.432607, 'temporal_validity': 1.0})
  - `PLV_RETAIL_1` (PlatformVersion, 2 hop(s) via RELATED_TO_VERSION, score 0.617, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.406587, 'temporal_validity': 1.0}); source_table=platform_versions, source_record_id=PLV_RETAIL_1, platform_version_id=PLV_RETAIL_1, platform_id=PLT_RETAIL, version_label=2024.1.0, released_at=2024-06-01 00:00:00, retired_at=-
- discarded nodes: 81
- events: graph.candidate.discarded=121, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=92, graph.ontology.expanded=4, graph.query.expanded=1, graph.relationship.traversed=92, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 799

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].


## DEMO-02: cross_market_platform_incident

**Question:** Have we seen this digital checkout problem in other markets? Which platform version connects the Greek payment checkout incident on platform version PLV_PAYMENTS_3 to the other markets, and why was the UK unaffected?

### Pipeline A: conventional RAG

- selected context (12: 10 record, 2 document):
  - `REC_incidents_INC_042` [record incidents] incidents: INC_042 (fused 0.5833, rerank 3.106, rank 1)
  - `CHNK_0256_00` [chunk] Release Note: APPV_UK_530 (Deferred Update) (fused 1.0000, rerank 2.729, rank 2)
  - `REC_incidents_INC_002` [record incidents] incidents: INC_002 (fused 0.3250, rerank 2.197, rank 3)
  - `REC_incidents_INC_022` [record incidents] incidents: INC_022 (fused 0.3929, rerank 1.668, rank 4)
  - `REC_incidents_INC_043` [record incidents] incidents: INC_043 (fused 0.4583, rerank 0.374, rank 5)
  - `REC_incidents_INC_017` [record incidents] incidents: INC_017 (fused 0.2778, rerank 0.354, rank 6)
  - `REC_incidents_INC_044` [record incidents] incidents: INC_044 (fused 0.3429, rerank 0.038, rank 7)
  - `REC_incidents_INC_006` [record incidents] incidents: INC_006 (fused 0.1270, rerank -0.199, rank 8)
  - `REC_incidents_INC_018` [record incidents] incidents: INC_018 (fused 0.2576, rerank -0.209, rank 9)
  - `CHNK_0132_00` [chunk] Incident Report: Αποτυχία πληρωμών (INC_022) (fused 0.0455, rerank -1.011, rank 10)
  - `REC_incidents_INC_010` [record incidents] incidents: INC_010 (fused 0.0857, rerank -1.055, rank 11)
  - `REC_incidents_INC_026` [record incidents] incidents: INC_026 (fused 0.0833, rerank -1.176, rank 12)
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
- selected node evidence (12):
  - `PLV_PAYMENTS_3` (PlatformVersion, 0 hop(s) via SEED, score 0.854, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.581531, 'temporal_validity': 1.0}); source_table=platform_versions, source_record_id=PLV_PAYMENTS_3, platform_version_id=PLV_PAYMENTS_3, platform_id=PLT_PAYMENTS, version_label=2024.3.0, released_at=2024-08-01 00:00:00, retired_at=-
  - `MKT_UK` (Market, 0 hop(s) via SEED, score 0.811, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.459269, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_UK, market_id=MKT_UK, market_name=United Kingdom, currency_code=GBP
  - `INC_042` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.768, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.645597, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_042, incident_id=INC_042, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_PLIROMES, started_at=2025-05-21 11:00:00, resolved_at=2025-05-23 11:00:00
  - `INC_017` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.743, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.576432, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_017, incident_id=INC_017, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_PAYMENT_FAILURE, started_at=2025-03-24 20:50:16, resolved_at=2025-03-25 22:05:16
  - `INC_002` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.733, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.545471, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_002, incident_id=INC_002, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-02-05 08:29:43, resolved_at=2025-02-05 16:24:43
  - `INC_022` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.730, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.538933, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_022, incident_id=INC_022, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-11-29 01:54:04, resolved_at=2025-11-29 14:58:04
  - `INC_001` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.669, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.579176, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-11-10 23:30:31, resolved_at=2025-11-13 19:40:31
  - `INC_009` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.644, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.506085, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_009, incident_id=INC_009, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-04-16 22:41:29, resolved_at=2025-04-17 07:40:29
  - `INC_005` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.643, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.504321, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_005, incident_id=INC_005, market_id=MKT_UK, severity=HIGH, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-03-24 07:00:33, resolved_at=2025-03-25 14:25:33
  - `PLT_PAYMENTS` (Platform, 1 hop(s) via VERSION_OF, score 0.640, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.494932, 'temporal_validity': 1.0}); source_table=platforms, source_record_id=PLT_PAYMENTS, platform_id=PLT_PAYMENTS, platform_name=Payments Gateway, platform_type=PAYMENTS, supplier_id=SUP_BLUEHARBOR
  - `INC_013` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.639, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.492833, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_013, incident_id=INC_013, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_DRAW_DELAY, started_at=2025-11-10 19:38:24, resolved_at=2025-11-12 03:17:24
  - `ITYPE_UK_PAYMENT_FAILURE` (IncidentType, 2 hop(s) via OF_TYPE, score 0.634, components {'graph_distance': 0.5, 'relationship_type': 0.7, 'semantic_relevance': 0.525126, 'temporal_validity': 1.0}); source_table=incident_types, source_record_id=ITYPE_UK_PAYMENT_FAILURE, incident_type_id=ITYPE_UK_PAYMENT_FAILURE, market_id=MKT_UK, name=Payment failure, language_code=en
- discarded nodes: 78
- events: graph.candidate.discarded=118, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=88, graph.relationship.traversed=88, graph.seed.selected=2, graph.traversal.started=1
- context tokens: 1065

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].

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
- discovered via_concept `CONCEPT_APPLICATION_INCIDENT`: 4 node(s): `ITYPE_AT_APP`, `ITYPE_CZ_APLIKACE`, `ITYPE_GR_EFARMOGI`, `ITYPE_CORP_APPLICATION`
- discovered via_concept `CONCEPT_DRAW_INCIDENT`: 4 node(s): `ITYPE_AT_ZIEHUNG`, `ITYPE_GR_KLIROSI`, `ITYPE_CZ_LOSOVANI`, `ITYPE_CORP_DRAW`
- discovered via_concept `CONCEPT_IDENTITY_INCIDENT`: 4 node(s): `ITYPE_GR_SYNDESI`, `ITYPE_CORP_IDENTITY`, `ITYPE_AT_ANMELDUNG`, `ITYPE_CZ_PRIHLASENI`
- discovered via_concept `CONCEPT_RETAIL_CHANNEL`: 1 node(s): `RETAIL`
- selected node evidence (12):
  - `CONCEPT_DIGITAL_CHANNEL` (BusinessConcept, 0 hop(s) via SEED, score 0.836, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.530305, 'temporal_validity': 1.0})
  - `PLV_PAYMENTS_3` (PlatformVersion, 0 hop(s) via SEED, score 0.832, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.5193, 'temporal_validity': 1.0}); source_table=platform_versions, source_record_id=PLV_PAYMENTS_3, platform_version_id=PLV_PAYMENTS_3, platform_id=PLT_PAYMENTS, version_label=2024.3.0, released_at=2024-08-01 00:00:00, retired_at=-
  - `MKT_UK` (Market, 0 hop(s) via SEED, score 0.806, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.445697, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_UK, market_id=MKT_UK, market_name=United Kingdom, currency_code=GBP
  - `CONCEPT_INCIDENT` (BusinessConcept, 0 hop(s) via SEED, score 0.799, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.424548, 'temporal_validity': 1.0})
  - `INC_042` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.757, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.616633, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_042, incident_id=INC_042, market_id=MKT_GR, severity=HIGH, incident_type=ITYPE_GR_PLIROMES, started_at=2025-05-21 11:00:00, resolved_at=2025-05-23 11:00:00
  - `INC_017` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.738, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.561103, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_017, incident_id=INC_017, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_PAYMENT_FAILURE, started_at=2025-03-24 20:50:16, resolved_at=2025-03-25 22:05:16
  - `INC_002` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.727, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.528239, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_002, incident_id=INC_002, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-02-05 08:29:43, resolved_at=2025-02-05 16:24:43
  - `INC_022` (Incident, 1 hop(s) via RELATED_TO_VERSION, score 0.725, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.523092, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_022, incident_id=INC_022, market_id=MKT_GR, severity=LOW, incident_type=ITYPE_GR_PLIROMES, started_at=2025-11-29 01:54:04, resolved_at=2025-11-29 14:58:04
  - `INC_001` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.670, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.58157, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-11-10 23:30:31, resolved_at=2025-11-13 19:40:31
  - `PLT_PAYMENTS` (Platform, 1 hop(s) via VERSION_OF, score 0.650, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.524568, 'temporal_validity': 1.0}); source_table=platforms, source_record_id=PLT_PAYMENTS, platform_id=PLT_PAYMENTS, platform_name=Payments Gateway, platform_type=PAYMENTS, supplier_id=SUP_BLUEHARBOR
  - `INC_005` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.650, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.523447, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_005, incident_id=INC_005, market_id=MKT_UK, severity=HIGH, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-03-24 07:00:33, resolved_at=2025-03-25 14:25:33
  - `ITYPE_UK_PAYMENT_FAILURE` (IncidentType, 2 hop(s) via OF_TYPE, score 0.648, components {'graph_distance': 0.5, 'relationship_type': 0.7, 'semantic_relevance': 0.564344, 'temporal_validity': 1.0}); source_table=incident_types, source_record_id=ITYPE_UK_PAYMENT_FAILURE, incident_type_id=ITYPE_UK_PAYMENT_FAILURE, market_id=MKT_UK, name=Payment failure, language_code=en
- discarded nodes: 104
- events: graph.candidate.discarded=144, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=4, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=112, graph.ontology.expanded=4, graph.query.expanded=1, graph.relationship.traversed=112, graph.seed.selected=4, graph.traversal.started=1
- context tokens: 897

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].


## DEMO-03: shared_payment_cluster

**Question:** Which accounts share payment instruments with PLAYER_GR_001283, and how many accounts are involved?

### Pipeline A: conventional RAG

- selected context (12: 12 record, 0 document):
  - `REC_devices_DEV_GR_001499` [record devices] devices: DEV_GR_001499 (fused 0.2500, rerank 3.324, rank 1)
  - `REC_payment_methods_PAY_SHARED_004` [record payment_methods] payment_methods: PAY_SHARED_004 (fused 0.0723, rerank 1.521, rank 2)
  - `REC_payment_methods_PAY_SHARED_033` [record payment_methods] payment_methods: PAY_SHARED_033 (fused 0.2278, rerank 1.475, rank 3)
  - `REC_payment_methods_PAY_SHARED_065` [record payment_methods] payment_methods: PAY_SHARED_065 (fused 0.0620, rerank 1.276, rank 4)
  - `REC_payment_methods_PAY_SHARED_076` [record payment_methods] payment_methods: PAY_SHARED_076 (fused 0.0973, rerank 0.954, rank 5)
  - `REC_payment_methods_PAY_SHARED_018` [record payment_methods] payment_methods: PAY_SHARED_018 (fused 0.1667, rerank 0.904, rank 6)
  - `REC_payment_methods_PAY_SHARED_035` [record payment_methods] payment_methods: PAY_SHARED_035 (fused 0.1000, rerank 0.788, rank 7)
  - `REC_payment_methods_PAY_SHARED_023` [record payment_methods] payment_methods: PAY_SHARED_023 (fused 0.0926, rerank 0.675, rank 8)
  - `REC_payment_methods_PAY_SHARED_034` [record payment_methods] payment_methods: PAY_SHARED_034 (fused 0.3704, rerank 0.671, rank 9)
  - `REC_payment_methods_PAY_SHARED_075` [record payment_methods] payment_methods: PAY_SHARED_075 (fused 0.2500, rerank 0.584, rank 10)
  - `REC_payment_methods_PAY_SHARED_067` [record payment_methods] payment_methods: PAY_SHARED_067 (fused 0.1776, rerank 0.562, rank 11)
  - `REC_payment_methods_PAY_SHARED_036` [record payment_methods] payment_methods: PAY_SHARED_036 (fused 0.0769, rerank 0.540, rank 12)
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
- selected node evidence (12):
  - `PLAYER_GR_001283` (Player, 0 hop(s) via SEED, score 0.880, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.656607, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001283, player_id=PLAYER_GR_001283, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PAY_GR_0004311` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.762, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.701567, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_GR_0004311, accounts_sharing=1, links=PLAYER_GR_001283[weight=1.0,from=2025-05-15]
  - `PP_CONTINENTAL` (PaymentProvider, 2 hop(s) via PROVIDED_BY, score 0.649, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.496729, 'temporal_validity': 1.0}); source_table=payment_providers, source_record_id=PP_CONTINENTAL, provider_id=PP_CONTINENTAL, name=Continental Pay, home_market_id=-, platform_id=PLT_PAYMENTS
  - `PLAYER_GR_000003` (Player, 2 hop(s) via BELONGS_TO, score 0.599, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.639791, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000003, player_id=PLAYER_GR_000003, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PLAYER_GR_000011` (Player, 2 hop(s) via BELONGS_TO, score 0.593, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.622617, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000011, player_id=PLAYER_GR_000011, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PLAYER_GR_000001` (Player, 2 hop(s) via BELONGS_TO, score 0.593, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.622528, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000001, player_id=PLAYER_GR_000001, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PLAYER_GR_000005` (Player, 2 hop(s) via BELONGS_TO, score 0.592, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.620639, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000005, player_id=PLAYER_GR_000005, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `DEV_GR_001499` (Device, 1 hop(s) via USES, score 0.590, components {'graph_distance': 0.666667, 'relationship_type': 0.3, 'semantic_relevance': 0.567801, 'temporal_validity': 1.0})
  - `SEG_GR_OIKONOMIKOI` (PlayerSegment, 1 hop(s) via BELONGS_TO, score 0.587, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.48707, 'temporal_validity': 1.0}); source_table=player_segments, source_record_id=SEG_GR_OIKONOMIKOI, segment_id=SEG_GR_OIKONOMIKOI, market_id=MKT_GR, segment_kind=VALUE, name=Οικονομικοί, language_code=el
  - `PLAYER_GR_000007` (Player, 2 hop(s) via BELONGS_TO, score 0.583, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.595086, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000007, player_id=PLAYER_GR_000007, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_TAKTIKOI
  - `SEG_GR_PERISTASIAKOI` (PlayerSegment, 1 hop(s) via BELONGS_TO, score 0.582, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.47108, 'temporal_validity': 1.0}); source_table=player_segments, source_record_id=SEG_GR_PERISTASIAKOI, segment_id=SEG_GR_PERISTASIAKOI, market_id=MKT_GR, segment_kind=ENGAGEMENT, name=Περιστασιακοί, language_code=el
  - `PLAYER_GR_000002` (Player, 2 hop(s) via BELONGS_TO, score 0.581, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.589743, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000002, player_id=PLAYER_GR_000002, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_TAKTIKOI
- discarded nodes: 6
- events: graph.candidate.discarded=46, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=17, graph.relationship.traversed=17, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 691

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].

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
- selected node evidence (12):
  - `PLAYER_GR_001283` (Player, 0 hop(s) via SEED, score 0.880, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.656607, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001283, player_id=PLAYER_GR_001283, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PAY_GR_0004311` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.762, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.701567, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_GR_0004311, accounts_sharing=1, links=PLAYER_GR_001283[weight=1.0,from=2025-05-15]
  - `PP_CONTINENTAL` (PaymentProvider, 2 hop(s) via PROVIDED_BY, score 0.649, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.496729, 'temporal_validity': 1.0}); source_table=payment_providers, source_record_id=PP_CONTINENTAL, provider_id=PP_CONTINENTAL, name=Continental Pay, home_market_id=-, platform_id=PLT_PAYMENTS
  - `PLAYER_GR_000003` (Player, 2 hop(s) via BELONGS_TO, score 0.599, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.639791, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000003, player_id=PLAYER_GR_000003, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PLAYER_GR_000011` (Player, 2 hop(s) via BELONGS_TO, score 0.593, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.622617, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000011, player_id=PLAYER_GR_000011, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PLAYER_GR_000001` (Player, 2 hop(s) via BELONGS_TO, score 0.593, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.622528, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000001, player_id=PLAYER_GR_000001, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `PLAYER_GR_000005` (Player, 2 hop(s) via BELONGS_TO, score 0.592, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.620639, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000005, player_id=PLAYER_GR_000005, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_OIKONOMIKOI
  - `DEV_GR_001499` (Device, 1 hop(s) via USES, score 0.590, components {'graph_distance': 0.666667, 'relationship_type': 0.3, 'semantic_relevance': 0.567801, 'temporal_validity': 1.0})
  - `SEG_GR_OIKONOMIKOI` (PlayerSegment, 1 hop(s) via BELONGS_TO, score 0.587, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.48707, 'temporal_validity': 1.0}); source_table=player_segments, source_record_id=SEG_GR_OIKONOMIKOI, segment_id=SEG_GR_OIKONOMIKOI, market_id=MKT_GR, segment_kind=VALUE, name=Οικονομικοί, language_code=el
  - `PLAYER_GR_000007` (Player, 2 hop(s) via BELONGS_TO, score 0.583, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.595086, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000007, player_id=PLAYER_GR_000007, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_TAKTIKOI
  - `SEG_GR_PERISTASIAKOI` (PlayerSegment, 1 hop(s) via BELONGS_TO, score 0.582, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.47108, 'temporal_validity': 1.0}); source_table=player_segments, source_record_id=SEG_GR_PERISTASIAKOI, segment_id=SEG_GR_PERISTASIAKOI, market_id=MKT_GR, segment_kind=ENGAGEMENT, name=Περιστασιακοί, language_code=el
  - `PLAYER_GR_000002` (Player, 2 hop(s) via BELONGS_TO, score 0.581, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.589743, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_000002, player_id=PLAYER_GR_000002, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_GR_TAKTIKOI
- discarded nodes: 14
- events: graph.candidate.discarded=54, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=25, graph.ontology.expanded=2, graph.query.expanded=1, graph.relationship.traversed=25, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 691

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].


## DEMO-04: shared_identity_cluster

**Question:** Are there player accounts that look like the same person operating multiple identities across devices?

### Pipeline A: conventional RAG

- selected context (12: 12 record, 0 document):
  - `REC_devices_DEV_AT_000710` [record devices] devices: DEV_AT_000710 (fused 0.1000, rerank -3.818, rank 1)
  - `REC_devices_DEV_AT_000227` [record devices] devices: DEV_AT_000227 (fused 0.1111, rerank -3.822, rank 2)
  - `REC_devices_DEV_AT_000812` [record devices] devices: DEV_AT_000812 (fused 0.0909, rerank -3.857, rank 3)
  - `REC_devices_DEV_AT_000998` [record devices] devices: DEV_AT_000998 (fused 0.0476, rerank -3.874, rank 4)
  - `REC_devices_DEV_AT_000827` [record devices] devices: DEV_AT_000827 (fused 0.1250, rerank -3.881, rank 5)
  - `REC_devices_DEV_AT_001739` [record devices] devices: DEV_AT_001739 (fused 0.1667, rerank -3.906, rank 6)
  - `REC_devices_DEV_AT_000968` [record devices] devices: DEV_AT_000968 (fused 0.0667, rerank -3.910, rank 7)
  - `REC_devices_DEV_AT_000920` [record devices] devices: DEV_AT_000920 (fused 0.1429, rerank -3.916, rank 8)
  - `REC_devices_DEV_AT_000182` [record devices] devices: DEV_AT_000182 (fused 0.0500, rerank -3.917, rank 9)
  - `REC_devices_DEV_AT_000713` [record devices] devices: DEV_AT_000713 (fused 0.2000, rerank -3.918, rank 10)
  - `REC_devices_DEV_AT_000770` [record devices] devices: DEV_AT_000770 (fused 0.0833, rerank -3.926, rank 11)
  - `REC_devices_DEV_AT_000782` [record devices] devices: DEV_AT_000782 (fused 0.0526, rerank -3.945, rank 12)
- discarded: 28 (slot_limit)
- events: rag.candidate.reranked=40, rag.candidate.retrieved=40, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=28, rag.evidence.selected=12, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 609

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 12 retrieved source(s), the strongest evidence for the question is in: devices: DEV_AT_000710, devices: DEV_AT_000227 [1].

### Pipeline B: graph relationships (no ontology)

- resolved entities (1):
  - `DOC_0216` (Document, vector_fallback, matched 'Are there player accounts that look like the same person operati')
- seeds: `DOC_0216`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=19, ontology expansion=False
- edges traversed: 13
- selected node evidence (12):
  - `DOC_0216` (, 0 hop(s) via SEED, score 0.650, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.0, 'temporal_validity': 1.0})
  - `MKT_UK` (Market, 1 hop(s) via FROM_MARKET, score 0.568, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.360218, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_UK, market_id=MKT_UK, market_name=United Kingdom, currency_code=GBP
  - `INC_009` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.563, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.465636, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_009, incident_id=INC_009, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-04-16 22:41:29, resolved_at=2025-04-17 07:40:29
  - `INC_001` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.551, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.430272, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-11-10 23:30:31, resolved_at=2025-11-13 19:40:31
  - `INC_005` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.546, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.417436, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_005, incident_id=INC_005, market_id=MKT_UK, severity=HIGH, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-03-24 07:00:33, resolved_at=2025-03-25 14:25:33
  - `INC_013` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.532, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.375871, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_013, incident_id=INC_013, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_DRAW_DELAY, started_at=2025-11-10 19:38:24, resolved_at=2025-11-12 03:17:24
  - `GAME_UK_01` (Game, 2 hop(s) via AVAILABLE_IN, score 0.528, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.437771, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_UK_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via AVAILABLE_IN, score 0.523, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.422929, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_UK_RAPID_NUMBERS, ticket_price=1.00, currency_code=GBP
  - `GAME_UK_02` (Game, 2 hop(s) via AVAILABLE_IN, score 0.519, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.410497, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_02, game_id=GAME_UK_02, game_name=Kingsport Draw, market_id=MKT_UK, game_family_id=FAM_UK_ANNUITY, ticket_price=3.00, currency_code=GBP
  - `GAME_UK_04` (Game, 2 hop(s) via AVAILABLE_IN, score 0.516, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.401946, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_UK_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `DOC_0002` (Document, 2 hop(s) via FROM_MARKET, score 0.510, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.315014, 'temporal_validity': 1.0})
  - `DOC_0004` (Document, 2 hop(s) via FROM_MARKET, score 0.509, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.311895, 'temporal_validity': 1.0})
- discarded nodes: 2
- events: graph.candidate.discarded=42, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=13, graph.relationship.traversed=13, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 771

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].

### Pipeline C: graph relationships + enterprise ontology

- resolved entities (1):
  - `DOC_0216` (Document, vector_fallback, matched 'Are there player accounts that look like the same person operati')
- graph.query.expanded: 0 term(s) added, search text 102 chars
- seeds: `DOC_0216`
- limits: depth<=2, nodes/hop<=100, edges/node type<=4, total<=200, rel types=22, ontology expansion=True
- edges traversed: 13
- selected node evidence (12):
  - `DOC_0216` (, 0 hop(s) via SEED, score 0.650, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.0, 'temporal_validity': 1.0})
  - `MKT_UK` (Market, 1 hop(s) via FROM_MARKET, score 0.568, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.360218, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_UK, market_id=MKT_UK, market_name=United Kingdom, currency_code=GBP
  - `INC_009` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.563, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.465636, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_009, incident_id=INC_009, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_SIGN_IN, started_at=2025-04-16 22:41:29, resolved_at=2025-04-17 07:40:29
  - `INC_001` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.551, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.430272, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-11-10 23:30:31, resolved_at=2025-11-13 19:40:31
  - `INC_005` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.546, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.417436, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_005, incident_id=INC_005, market_id=MKT_UK, severity=HIGH, incident_type=ITYPE_UK_APP_STABILITY, started_at=2025-03-24 07:00:33, resolved_at=2025-03-25 14:25:33
  - `INC_013` (Incident, 2 hop(s) via AFFECTS_MARKET, score 0.532, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.375871, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_013, incident_id=INC_013, market_id=MKT_UK, severity=MEDIUM, incident_type=ITYPE_UK_DRAW_DELAY, started_at=2025-11-10 19:38:24, resolved_at=2025-11-12 03:17:24
  - `GAME_UK_01` (Game, 2 hop(s) via AVAILABLE_IN, score 0.528, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.437771, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_UK_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via AVAILABLE_IN, score 0.523, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.422929, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_UK_RAPID_NUMBERS, ticket_price=1.00, currency_code=GBP
  - `GAME_UK_02` (Game, 2 hop(s) via AVAILABLE_IN, score 0.519, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.410497, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_02, game_id=GAME_UK_02, game_name=Kingsport Draw, market_id=MKT_UK, game_family_id=FAM_UK_ANNUITY, ticket_price=3.00, currency_code=GBP
  - `GAME_UK_04` (Game, 2 hop(s) via AVAILABLE_IN, score 0.516, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.401946, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_UK_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `DOC_0002` (Document, 2 hop(s) via FROM_MARKET, score 0.510, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.315014, 'temporal_validity': 1.0})
  - `DOC_0004` (Document, 2 hop(s) via FROM_MARKET, score 0.509, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.311895, 'temporal_validity': 1.0})
- discarded nodes: 2
- events: graph.candidate.discarded=42, graph.candidate.selected=12, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=13, graph.query.expanded=1, graph.relationship.traversed=13, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 771

**Answer** (fake-answer-v1, 0 ms):

- verdict: [fake-model] answered from the retrieved sources
- cited blocks: [1] of 12 shown

[fake-model] Based on 0 retrieved source(s) and 12 authoritative structured record(s), the strongest evidence for the question is in: structured records [1].


