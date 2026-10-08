# Example Traces: A/B/C Retrieval Comparison

Status: HITL-08 artefact. Captured 2026-10-08 against the development world.

## What this document is

Verbatim output of the side-by-side trace CLI over three planted scenarios
from the scenario library (HITL-05). Each scenario runs the same question
through three retrieval pipelines:

- **A, conventional RAG**: embedding + vector search + lexical rerank +
  budgeted context + generation.
- **B, graph relationships**: A's document channel plus bounded traversal
  over the structured-record subgraph; no ontology.
- **C, graph relationships + enterprise ontology**: B plus
  `BusinessConcept` seeds and `MAPS_TO` ontology expansion.

Same question, same synthetic world, same embedding model, same generator and
parameters, shared context budget. Only the retrieval layers differ.

## How it was produced

```bash
cd backend
make ingest-graph   # development world (deterministic generator)
GENERATION_MODEL="ollama/qwen3.5:35b-a3b-q4_K_M" \
GENERATION_API_BASE="http://localhost:11434" \
uv run python -m app.retrieval.graph.traces --generator litellm
```

Embeddings: bge-m3 (1024 dimensions) for every pipeline. Generation:
qwen3.5 35B (q4_K_M) at temperature 0 through the LiteLLM gateway (ADR-003).
Retrieval telemetry (seeds, traversal, scores, discards, budgets) is
deterministic and reproducible; the generated answer prose is a local-model
artefact and may vary between runs.

The evaluator truth ledger is not consulted anywhere in this pipeline; the
questions are the scenario library's public benchmark questions phrased with
record ids an analyst would have open.

## How to read a trace

Each scenario prints one section per pipeline:

- *resolved seeds and traversal*: entity resolution output, traversal limits,
  edges traversed, and (C only) the ontology concepts involved.
- *selected node evidence*: graph nodes chosen as evidence, each with hop
  distance, discovered relationship, the transparent score components, and
  authoritative facts from the source tables.
- *discarded nodes*: candidates reached but not selected; they stay
  inspectable in the UI.
- *document chunks, shared vector channel*: the document context, retrieved
  identically to pipeline A.
- *events*: the structured telemetry stream (docs/07 section 8 names) that
  drives the GraphRAG screens.
- *context tokens / Answer / Citations*: what entered generation and what the
  model answered.

## What to look for

- **SCN-007 (cross-market incident)**: A retrieves isolated document chunks.
  B and C resolve the incident and market, walk the version edges to the
  Austrian and Czech siblings, and surface the UK incidents needed for the
  "why was the UK unaffected" contrast, each with authoritative incident
  records. C also seeds `CONCEPT_PLATFORM_INCIDENT` and expands its bound
  set.
- **SCN-015 (document vs record conflict)**: every pipeline retrieves the
  legacy pricing document; B and C additionally attach the authoritative
  games row (`ticket_price=2.50, currency_code=GBP`) so the answer can state
  which side is current.
- **SCN-003 (shared payment instruments)**: the default allow-list excludes
  player-instrument edges; the fraud profile adds `USES_PAYMENT` per run
  through configuration, not code branching. B and C cluster the shared
  instruments with per-account links; A has no path to this structure.

---

## SCN-007 — cross-market platform incident

**Question:** Have we seen this digital checkout problem in other markets? Which platform version connects incident INC_S007_GR to the other markets, and why was the UK unaffected?

### Pipeline A — conventional RAG

- selected context (5):
  - `CHNK_S007_GR_00` Incident Report: INC_S007_GR (similarity 0.676, rank 1)
  - `CHNK_S007_UK_01` Release Note: APPV_UK_530 (Deferred Update) (similarity 0.626, rank 4)
  - `CHNK_S007_GR_01` Incident Report: INC_S007_GR (similarity 0.624, rank 5)
  - `CHNK_0079_00` Post Incident Review: INC_007 (similarity 0.593, rank 6)
  - `CHNK_S007_AT_01` Incident Report: INC_S007_AT (similarity 0.594, rank 7)
- discarded: 3 (duplicate)
- events: rag.candidate.reranked=8, rag.candidate.retrieved=8, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=3, rag.evidence.selected=5, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 114

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 42636 ms):

Yes, similar symptoms are expected in other markets, specifically incidents INC_S007_AT and INC_S007_CZ [3], where affected cohorts could not complete digital purchases [5]. The platform version connecting incident INC_S007_GR to the checkout component change is PLV_PAYMENTS_3 [1]. The UK was unaffected due to a deferred update status noted in the release note [2].

**Citations:** 5

### Pipeline B — graph relationships (no ontology)

- resolved seeds and traversal:
  - seeds: `INC_S007_GR`, `MKT_UK`
  - limits: depth<=2, nodes/hop<=100, total<=200, rel types=13
  - edges traversed: 101
- selected node evidence (14):
  - `INC_S007_GR` (Incident, 0 hop(s) via SEED, score 0.896, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.702316, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_S007_GR, incident_id=INC_S007_GR, market_id=MKT_GR, severity=HIGH, incident_type=INC_PAYMENTS, started_at=2025-05-21 09:00:00, resolved_at=2025-05-23 09:00:00
  - `MKT_UK` (Market, 0 hop(s) via SEED, score 0.815, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.470462, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_UK, market_id=MKT_UK, market_name=United Kingdom, currency_code=GBP
  - `INC_S007_AT` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.736, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.674715, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_S007_AT, incident_id=INC_S007_AT, market_id=MKT_AT, severity=MEDIUM, incident_type=INC_PAYMENTS, started_at=2025-05-22 09:00:00, resolved_at=2025-05-23 09:00:00
  - `INC_S007_CZ` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.731, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.659838, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_S007_CZ, incident_id=INC_S007_CZ, market_id=MKT_CZ, severity=LOW, incident_type=INC_PAYMENTS, started_at=2025-05-23 12:00:00, resolved_at=2025-05-24 00:00:00
  - `INC_006` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.696, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.56098, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_006, incident_id=INC_006, market_id=MKT_GR, severity=MEDIUM, incident_type=INC_PAYMENTS, started_at=2025-03-17 15:02:55, resolved_at=2025-03-20 03:40:55
  - `INC_010` (Incident, 2 hop(s) via AFFECTS, score 0.690, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.615005, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_010, incident_id=INC_010, market_id=MKT_GR, severity=MEDIUM, incident_type=INC_APP_STABILITY, started_at=2025-08-04 18:56:46, resolved_at=-
  - `INC_014` (Incident, 2 hop(s) via AFFECTS, score 0.688, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.607989, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_014, incident_id=INC_014, market_id=MKT_GR, severity=LOW, incident_type=INC_APP_STABILITY, started_at=2025-07-29 08:59:40, resolved_at=2025-07-31 09:03:40
  - `INC_009` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.686, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.62653, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_009, incident_id=INC_009, market_id=MKT_UK, severity=MEDIUM, incident_type=INC_APP_STABILITY, started_at=2025-02-19 06:43:16, resolved_at=2025-02-19 17:55:16
  - `PLV_PAYMENTS_3` (PlatformVersion, 1 hop(s) via RELATED_TO_VERSION, score 0.675, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.379707, 'temporal_validity': 1.0}); source_table=platform_versions, source_record_id=PLV_PAYMENTS_3, platform_version_id=PLV_PAYMENTS_3, platform_id=PLT_PAYMENTS, version_label=2024.3.0, released_at=2024-08-01 00:00:00
  - `INC_013` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.673, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.590381, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_013, incident_id=INC_013, market_id=MKT_UK, severity=LOW, incident_type=INC_RETAIL_TERMINAL, started_at=2025-08-20 20:16:54, resolved_at=-
  - `INC_002` (Incident, 2 hop(s) via AFFECTS, score 0.659, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.526702, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_002, incident_id=INC_002, market_id=MKT_GR, severity=HIGH, incident_type=INC_DRAW_DELAY, started_at=2025-03-22 00:41:40, resolved_at=2025-03-23 11:55:40
  - `GAME_GR_01` (Game, 1 hop(s) via AFFECTS, score 0.658, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.403476, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_01, game_id=GAME_GR_01, game_name=Aegean Gold, market_id=MKT_GR, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.00, currency_code=EUR
  - `INC_001` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.657, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.544262, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=INC_APP_STABILITY, started_at=2025-01-17 21:24:09, resolved_at=-
  - `GAME_GR_02` (Game, 1 hop(s) via AFFECTS, score 0.654, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.391771, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_02, game_id=GAME_GR_02, game_name=Ellas Jackpot, market_id=MKT_GR, game_family_id=FAM_MULTINATIONAL_JACKPOT, ticket_price=2.50, currency_code=EUR
- discarded nodes: 89
- document chunks, shared vector channel (5):
  - `CHNK_S007_GR_00` Incident Report: INC_S007_GR (similarity 0.676)
  - `CHNK_S007_UK_01` Release Note: APPV_UK_530 (Deferred Update) (similarity 0.626)
  - `CHNK_S007_GR_01` Incident Report: INC_S007_GR (similarity 0.624)
  - `CHNK_0079_00` Post Incident Review: INC_007 (similarity 0.593)
  - `CHNK_S007_AT_01` Incident Report: INC_S007_AT (similarity 0.594)
- events: graph.candidate.discarded=92, graph.candidate.selected=19, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=101, graph.relationship.traversed=101, graph.seed.selected=2, graph.traversal.started=1
- context tokens: 1211

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 34151 ms):

Yes, similar symptoms have been observed in other markets. Incident reports indicate that similar symptoms are expected in INC_S007_AT and INC_S007_CZ [3]. Affected cohorts in these markets could not complete digital purchases [5], [9].

The platform version connecting incident INC_S007_GR to the other markets is PLV_PAYMENTS_3. This release changed the checkout component for INC_S007_GR [1] and is cited in the summaries for incidents INC_S007_AT and INC_S007_CZ as affecting digital checkout [6], [8], [9].

The UK was unaffected because a release note specifically states that "UK checkout is unaffected" [2].

**Citations:** 19

### Pipeline C — graph relationships + enterprise ontology

- resolved seeds and traversal:
  - seeds: `INC_S007_GR`, `MKT_UK`, `CONCEPT_PLATFORM_INCIDENT`
  - limits: depth<=2, nodes/hop<=100, total<=200, rel types=14
  - edges traversed: 126
  - ontology concepts: `CONCEPT_HIGH_FREQUENCY_GAME`, `CONCEPT_MULTINATIONAL_JACKPOT`, `CONCEPT_NATIONAL_DRAW`, `CONCEPT_PLATFORM_INCIDENT`
- selected node evidence (15):
  - `INC_S007_GR` (Incident, 0 hop(s) via SEED, score 0.896, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.702316, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_S007_GR, incident_id=INC_S007_GR, market_id=MKT_GR, severity=HIGH, incident_type=INC_PAYMENTS, started_at=2025-05-21 09:00:00, resolved_at=2025-05-23 09:00:00
  - `CONCEPT_PLATFORM_INCIDENT` (BusinessConcept, 0 hop(s) via SEED, score 0.820, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.484959, 'temporal_validity': 1.0})
  - `MKT_UK` (Market, 0 hop(s) via SEED, score 0.815, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.470462, 'temporal_validity': 1.0}); source_table=markets, source_record_id=MKT_UK, market_id=MKT_UK, market_name=United Kingdom, currency_code=GBP
  - `INC_S007_AT` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.736, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.674715, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_S007_AT, incident_id=INC_S007_AT, market_id=MKT_AT, severity=MEDIUM, incident_type=INC_PAYMENTS, started_at=2025-05-22 09:00:00, resolved_at=2025-05-23 09:00:00
  - `INC_S007_CZ` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.731, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.659838, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_S007_CZ, incident_id=INC_S007_CZ, market_id=MKT_CZ, severity=LOW, incident_type=INC_PAYMENTS, started_at=2025-05-23 12:00:00, resolved_at=2025-05-24 00:00:00
  - `INC_006` (Incident, 2 hop(s) via RELATED_TO_VERSION, score 0.696, components {'graph_distance': 0.5, 'relationship_type': 0.9, 'semantic_relevance': 0.56098, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_006, incident_id=INC_006, market_id=MKT_GR, severity=MEDIUM, incident_type=INC_PAYMENTS, started_at=2025-03-17 15:02:55, resolved_at=2025-03-20 03:40:55
  - `INC_010` (Incident, 2 hop(s) via AFFECTS, score 0.690, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.615005, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_010, incident_id=INC_010, market_id=MKT_GR, severity=MEDIUM, incident_type=INC_APP_STABILITY, started_at=2025-08-04 18:56:46, resolved_at=-
  - `INC_014` (Incident, 2 hop(s) via AFFECTS, score 0.688, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.607989, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_014, incident_id=INC_014, market_id=MKT_GR, severity=LOW, incident_type=INC_APP_STABILITY, started_at=2025-07-29 08:59:40, resolved_at=2025-07-31 09:03:40
  - `INC_009` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.686, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.62653, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_009, incident_id=INC_009, market_id=MKT_UK, severity=MEDIUM, incident_type=INC_APP_STABILITY, started_at=2025-02-19 06:43:16, resolved_at=2025-02-19 17:55:16
  - `PLV_PAYMENTS_3` (PlatformVersion, 1 hop(s) via RELATED_TO_VERSION, score 0.675, components {'graph_distance': 0.666667, 'relationship_type': 0.9, 'semantic_relevance': 0.379707, 'temporal_validity': 1.0}); source_table=platform_versions, source_record_id=PLV_PAYMENTS_3, platform_version_id=PLV_PAYMENTS_3, platform_id=PLT_PAYMENTS, version_label=2024.3.0, released_at=2024-08-01 00:00:00
  - `INC_013` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.673, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.590381, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_013, incident_id=INC_013, market_id=MKT_UK, severity=LOW, incident_type=INC_RETAIL_TERMINAL, started_at=2025-08-20 20:16:54, resolved_at=-
  - `GAME_GR_01` (Game, 1 hop(s) via AFFECTS, score 0.658, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.403476, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_01, game_id=GAME_GR_01, game_name=Aegean Gold, market_id=MKT_GR, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.00, currency_code=EUR
  - `INC_001` (Incident, 1 hop(s) via AFFECTS_MARKET, score 0.657, components {'graph_distance': 0.666667, 'relationship_type': 0.6, 'semantic_relevance': 0.544262, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_001, incident_id=INC_001, market_id=MKT_UK, severity=LOW, incident_type=INC_APP_STABILITY, started_at=2025-01-17 21:24:09, resolved_at=-
  - `INC_022` (Incident, 1 hop(s) via MAPS_TO, score 0.654, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.606066, 'temporal_validity': 1.0}); source_table=incidents, source_record_id=INC_022, incident_id=INC_022, market_id=MKT_GR, severity=MEDIUM, incident_type=INC_APP_STABILITY, started_at=2025-04-22 04:22:40, resolved_at=2025-04-23 19:43:40
  - `GAME_GR_02` (Game, 1 hop(s) via AFFECTS, score 0.654, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.391771, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_02, game_id=GAME_GR_02, game_name=Ellas Jackpot, market_id=MKT_GR, game_family_id=FAM_MULTINATIONAL_JACKPOT, ticket_price=2.50, currency_code=EUR
- discarded nodes: 114
- document chunks, shared vector channel (5):
  - `CHNK_S007_GR_00` Incident Report: INC_S007_GR (similarity 0.676)
  - `CHNK_S007_UK_01` Release Note: APPV_UK_530 (Deferred Update) (similarity 0.626)
  - `CHNK_S007_GR_01` Incident Report: INC_S007_GR (similarity 0.624)
  - `CHNK_0079_00` Post Incident Review: INC_007 (similarity 0.593)
  - `CHNK_S007_AT_01` Incident Report: INC_S007_AT (similarity 0.594)
- events: graph.candidate.discarded=117, graph.candidate.selected=20, graph.context.assembled=1, graph.entity.resolved=3, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=126, graph.ontology.expanded=1, graph.relationship.traversed=126, graph.seed.selected=3, graph.traversal.started=1
- context tokens: 1234

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 35196 ms):

Yes, similar symptoms were observed in other markets. Incident reports indicate that affected cohorts could not complete digital purchases in Austria (INC_S007_AT) and Czech Republic (INC_S007_CZ), with similar symptoms expected in these locations [3], [5]. The platform version connecting incident INC_S007_GR to the other markets is PLV_PAYMENTS_3, which changed the checkout component and is cited in the summaries for all three incidents [1], [6], [9], [10]. Regarding the UK market, a release note states that "UK checkout is unaffected" [2].

**Citations:** 20


## SCN-015 — document vs structured record conflict

**Question:** What is the current ticket price for GAME_UK_01, and why does the rules document disagree with the source record?

### Pipeline A — conventional RAG

- selected context (4):
  - `CHNK_S015_UK_00` Game Rules: GAME_UK_01 (Legacy Pricing) (similarity 0.739, rank 1)
  - `CHNK_0159_01` Experiment Report: EXP_006 (similarity 0.694, rank 2)
  - `CHNK_0171_01` Platform Documentation: Reporting Period (similarity 0.640, rank 5)
  - `CHNK_0006_01` Release Note: APPV_UK_530 (similarity 0.657, rank 8)
- discarded: 4 (duplicate)
- events: rag.candidate.reranked=8, rag.candidate.retrieved=8, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=4, rag.evidence.selected=4, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 126

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 35810 ms):

Based on Source [1], each ticket for GAME_UK_01 costs GBP 1. However, the provided context does not contain a source record that disagrees with this price, nor does it explain why such a disagreement would occur. While Source [1] is titled "(Legacy Pricing)", Sources [2], [3], and [4] do not mention ticket prices or conflicting records.

**Citations:** 4

### Pipeline B — graph relationships (no ontology)

- resolved seeds and traversal:
  - seeds: `GAME_UK_01`
  - limits: depth<=2, nodes/hop<=100, total<=200, rel types=13
  - edges traversed: 66
- selected node evidence (13):
  - `GAME_UK_01` (Game, 0 hop(s) via SEED, score 0.884, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.667162, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `SUP_00001` (SupportCase, 1 hop(s) via CONCERNS, score 0.639, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.420649, 'temporal_validity': 1.0})
  - `SUP_00017` (SupportCase, 1 hop(s) via CONCERNS, score 0.632, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.399737, 'temporal_validity': 1.0})
  - `SUP_00221` (SupportCase, 1 hop(s) via CONCERNS, score 0.628, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.388683, 'temporal_validity': 1.0})
  - `SUP_00369` (SupportCase, 1 hop(s) via CONCERNS, score 0.627, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.386739, 'temporal_validity': 1.0})
  - `GAME_AT_04` (Game, 2 hop(s) via RUNS_ON, score 0.624, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.569102, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_04, game_id=GAME_AT_04, game_name=Alpen Star, market_id=MKT_AT, game_family_id=FAM_ADD_ON, ticket_price=1.00, currency_code=EUR
  - `GAME_AT_03` (Game, 2 hop(s) via RUNS_ON, score 0.621, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.558859, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_03, game_id=GAME_AT_03, game_name=Wiener Zahlen, market_id=MKT_AT, game_family_id=FAM_HIGH_FREQUENCY, ticket_price=1.00, currency_code=EUR
  - `GAME_CZ_01` (Game, 1 hop(s) via SIMILAR_TO, score 0.620, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.57964, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_CZ_01, game_id=GAME_CZ_01, game_name=Praha Fortuna, market_id=MKT_CZ, game_family_id=FAM_NATIONAL_DRAW, ticket_price=20.00, currency_code=CZK
  - `GAME_AT_01` (Game, 1 hop(s) via SIMILAR_TO, score 0.618, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.575774, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_02` (Game, 2 hop(s) via RUNS_ON, score 0.613, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.537437, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_MULTINATIONAL_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `GAME_GR_01` (Game, 2 hop(s) via INSTANCE_OF, score 0.608, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.594527, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_01, game_id=GAME_GR_01, game_name=Aegean Gold, market_id=MKT_GR, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.00, currency_code=EUR
  - `GAME_UK_04` (Game, 2 hop(s) via AVAILABLE_IN, score 0.604, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.655159, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via AVAILABLE_IN, score 0.600, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.641866, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_HIGH_FREQUENCY, ticket_price=1.00, currency_code=GBP
- discarded nodes: 54
- document chunks, shared vector channel (4):
  - `CHNK_S015_UK_00` Game Rules: GAME_UK_01 (Legacy Pricing) (similarity 0.739)
  - `CHNK_0159_01` Experiment Report: EXP_006 (similarity 0.694)
  - `CHNK_0171_01` Platform Documentation: Reporting Period (similarity 0.640)
  - `CHNK_0006_01` Release Note: APPV_UK_530 (similarity 0.657)
- events: graph.candidate.discarded=58, graph.candidate.selected=17, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=66, graph.relationship.traversed=66, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 760

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 21303 ms):

The current ticket price for GAME_UK_01 is 2.50 GBP according to the authoritative source record [5]. The rules document states that each ticket costs GBP 1 [1]. The rules document disagrees with the source record because it is labeled as "Legacy Pricing" [1], whereas the source record is identified as the "authoritative record" [5].

**Citations:** 17

### Pipeline C — graph relationships + enterprise ontology

- resolved seeds and traversal:
  - seeds: `GAME_UK_01`
  - limits: depth<=2, nodes/hop<=100, total<=200, rel types=14
  - edges traversed: 66
  - ontology concepts: `CONCEPT_NATIONAL_DRAW`
- selected node evidence (13):
  - `GAME_UK_01` (Game, 0 hop(s) via SEED, score 0.884, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.667162, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_01, game_id=GAME_UK_01, game_name=Albion Millions, market_id=MKT_UK, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.50, currency_code=GBP
  - `SUP_00001` (SupportCase, 1 hop(s) via CONCERNS, score 0.639, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.420649, 'temporal_validity': 1.0})
  - `SUP_00017` (SupportCase, 1 hop(s) via CONCERNS, score 0.632, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.399737, 'temporal_validity': 1.0})
  - `SUP_00221` (SupportCase, 1 hop(s) via CONCERNS, score 0.628, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.388683, 'temporal_validity': 1.0})
  - `SUP_00369` (SupportCase, 1 hop(s) via CONCERNS, score 0.627, components {'graph_distance': 0.666667, 'relationship_type': 0.7, 'semantic_relevance': 0.386739, 'temporal_validity': 1.0})
  - `GAME_AT_04` (Game, 2 hop(s) via RUNS_ON, score 0.624, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.569102, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_04, game_id=GAME_AT_04, game_name=Alpen Star, market_id=MKT_AT, game_family_id=FAM_ADD_ON, ticket_price=1.00, currency_code=EUR
  - `GAME_AT_03` (Game, 2 hop(s) via RUNS_ON, score 0.621, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.558859, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_03, game_id=GAME_AT_03, game_name=Wiener Zahlen, market_id=MKT_AT, game_family_id=FAM_HIGH_FREQUENCY, ticket_price=1.00, currency_code=EUR
  - `GAME_CZ_01` (Game, 1 hop(s) via SIMILAR_TO, score 0.620, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.57964, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_CZ_01, game_id=GAME_CZ_01, game_name=Praha Fortuna, market_id=MKT_CZ, game_family_id=FAM_NATIONAL_DRAW, ticket_price=20.00, currency_code=CZK
  - `GAME_AT_01` (Game, 1 hop(s) via SIMILAR_TO, score 0.618, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.575774, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_01, game_id=GAME_AT_01, game_name=Danube Classic, market_id=MKT_AT, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.50, currency_code=EUR
  - `GAME_AT_02` (Game, 2 hop(s) via RUNS_ON, score 0.613, components {'graph_distance': 0.5, 'relationship_type': 0.6, 'semantic_relevance': 0.537437, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_AT_02, game_id=GAME_AT_02, game_name=Alpen Jackpot, market_id=MKT_AT, game_family_id=FAM_MULTINATIONAL_JACKPOT, ticket_price=2.50, currency_code=EUR
  - `GAME_GR_01` (Game, 2 hop(s) via INSTANCE_OF, score 0.608, components {'graph_distance': 0.5, 'relationship_type': 0.5, 'semantic_relevance': 0.594527, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_GR_01, game_id=GAME_GR_01, game_name=Aegean Gold, market_id=MKT_GR, game_family_id=FAM_NATIONAL_DRAW, ticket_price=2.00, currency_code=EUR
  - `GAME_UK_04` (Game, 2 hop(s) via AVAILABLE_IN, score 0.604, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.655159, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_04, game_id=GAME_UK_04, game_name=Union Raffle, market_id=MKT_UK, game_family_id=FAM_FIXED_PRIZE, ticket_price=1.50, currency_code=GBP
  - `GAME_UK_03` (Game, 2 hop(s) via AVAILABLE_IN, score 0.600, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.641866, 'temporal_validity': 1.0}); source_table=games, source_record_id=GAME_UK_03, game_id=GAME_UK_03, game_name=Thames Cash, market_id=MKT_UK, game_family_id=FAM_HIGH_FREQUENCY, ticket_price=1.00, currency_code=GBP
- discarded nodes: 54
- document chunks, shared vector channel (4):
  - `CHNK_S015_UK_00` Game Rules: GAME_UK_01 (Legacy Pricing) (similarity 0.739)
  - `CHNK_0159_01` Experiment Report: EXP_006 (similarity 0.694)
  - `CHNK_0171_01` Platform Documentation: Reporting Period (similarity 0.640)
  - `CHNK_0006_01` Release Note: APPV_UK_530 (similarity 0.657)
- events: graph.candidate.discarded=58, graph.candidate.selected=17, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=66, graph.relationship.traversed=66, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 760

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 20644 ms):

The current ticket price for GAME_UK_01 is 2.50 GBP according to the authoritative source record [5]. The rules document states that each ticket costs GBP 1 [1]. The rules document disagrees with the source record because it is labeled as "Legacy Pricing" [1], whereas the source record is identified as the "authoritative record" [5].

**Citations:** 17


## SCN-003 — shared payment instrument cluster

**Question:** Which accounts share payment instruments with PLAYER_GR_001283, and how many accounts are involved?

### Pipeline A — conventional RAG

- selected context (5):
  - `CHNK_0009_02` Campaign Evaluation: CMP_007 (similarity 0.563, rank 1)
  - `CHNK_0075_02` Product Spec: GAME_AT_01 (similarity 0.549, rank 4)
  - `CHNK_0073_00` Release Note: APPV_AT_520 (similarity 0.545, rank 5)
  - `CHNK_0052_00` Product Spec: GAME_GR_01 (similarity 0.544, rank 6)
  - `CHNK_0241_00` Product Spec: GAME_GR_05 (similarity 0.543, rank 7)
- discarded: 3 (duplicate)
- events: rag.candidate.reranked=8, rag.candidate.retrieved=8, rag.context.assembled=1, rag.embedding.completed=1, rag.embedding.started=1, rag.evidence.discarded=3, rag.evidence.selected=5, rag.generation.completed=1, rag.generation.started=1, rag.query.received=1, rag.rerank.started=1, rag.vector_search.started=1
- context tokens: 161

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 14247 ms):

The provided context sources do not contain information regarding which accounts share payment instruments with PLAYER_GR_001283 or how many accounts are involved.

**Citations:** 5

### Pipeline B — graph relationships (no ontology)

- resolved seeds and traversal:
  - seeds: `PLAYER_GR_001283`
  - limits: depth<=2, nodes/hop<=100, total<=200, rel types=15
  - edges traversed: 22
- selected node evidence (13):
  - `PLAYER_GR_001283` (Player, 0 hop(s) via SEED, score 0.879, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.654093, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001283, player_id=PLAYER_GR_001283, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_VALUE_MAINSTREAM
  - `PAY_SHARED_058` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.767, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.715234, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_SHARED_058, accounts_sharing=7, links=PLAYER_AT_000847[weight=1.0,from=2025-01-21]; PLAYER_GR_002168[weight=0.15,from=2025-07-25]; PLAYER_GR_001283[weight=0.15,from=2025-07-25]; PLAYER_GR_001794[weight=0.15,from=2025-07-20]; PLAYER_GR_001760[weight=0.15,from=2025-07-24]; PLAYER_GR_001947[weight=0.15,from=2025-07-25]; PLAYER_GR_001708[weight=0.15,from=2025-07-20]
  - `PAY_SHARED_074` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.765, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.710306, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_SHARED_074, accounts_sharing=7, links=PLAYER_AT_000274[weight=1.0,from=2025-07-12]; PLAYER_GR_002168[weight=0.15,from=2025-07-25]; PLAYER_GR_001283[weight=0.15,from=2025-07-25]; PLAYER_GR_001794[weight=0.15,from=2025-07-20]; PLAYER_GR_001760[weight=0.15,from=2025-07-24]; PLAYER_GR_001947[weight=0.15,from=2025-07-25]; PLAYER_GR_001708[weight=0.15,from=2025-07-20]
  - `PAY_GR_0004300` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.763, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.70342, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_GR_0004300, accounts_sharing=1, links=PLAYER_GR_001283[weight=1.0,from=2025-04-04]
  - `PLAYER_GR_001708` (Player, 2 hop(s) via USES_PAYMENT, score 0.697, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.632988, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001708, player_id=PLAYER_GR_001708, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_VALUE_MAINSTREAM
  - `PLAYER_GR_001760` (Player, 2 hop(s) via USES_PAYMENT, score 0.690, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.614902, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001760, player_id=PLAYER_GR_001760, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_VALUE_MAINSTREAM
  - `PLAYER_AT_000274` (Player, 2 hop(s) via USES_PAYMENT, score 0.681, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.588153, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_AT_000274, player_id=PLAYER_AT_000274, market_id=MKT_AT, account_status=ACTIVE, value_segment=SEG_VALUE_BUDGET
  - `PLAYER_AT_000847` (Player, 2 hop(s) via USES_PAYMENT, score 0.680, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.585426, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_AT_000847, player_id=PLAYER_AT_000847, market_id=MKT_AT, account_status=ACTIVE, value_segment=SEG_VALUE_BUDGET
  - `SEG_VALUE_MAINSTREAM` (PlayerSegment, 1 hop(s) via BELONGS_TO, score 0.600, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.523721, 'temporal_validity': 1.0})
  - `SEG_ENG_CASUAL` (PlayerSegment, 1 hop(s) via BELONGS_TO, score 0.596, components {'graph_distance': 0.666667, 'relationship_type': 0.4, 'semantic_relevance': 0.511811, 'temporal_validity': 1.0})
  - `DEV_GR_000302` (Device, 1 hop(s) via USES, score 0.582, components {'graph_distance': 0.666667, 'relationship_type': 0.3, 'semantic_relevance': 0.544592, 'temporal_validity': 1.0})
  - `PLAYER_AT_000006` (Player, 2 hop(s) via BELONGS_TO, score 0.576, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.575009, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_AT_000006, player_id=PLAYER_AT_000006, market_id=MKT_AT, account_status=ACTIVE, value_segment=SEG_VALUE_BUDGET
  - `PLAYER_AT_000004` (Player, 2 hop(s) via BELONGS_TO, score 0.576, components {'graph_distance': 0.5, 'relationship_type': 0.4, 'semantic_relevance': 0.573346, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_AT_000004, player_id=PLAYER_AT_000004, market_id=MKT_AT, account_status=ACTIVE, value_segment=SEG_VALUE_BUDGET
- discarded nodes: 10
- document chunks, shared vector channel (5):
  - `CHNK_0009_02` Campaign Evaluation: CMP_007 (similarity 0.563)
  - `CHNK_0075_02` Product Spec: GAME_AT_01 (similarity 0.549)
  - `CHNK_0073_00` Release Note: APPV_AT_520 (similarity 0.545)
  - `CHNK_0052_00` Product Spec: GAME_GR_01 (similarity 0.544)
  - `CHNK_0241_00` Product Spec: GAME_GR_05 (similarity 0.543)
- events: graph.candidate.discarded=13, graph.candidate.selected=18, graph.context.assembled=1, graph.entity.resolved=1, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=22, graph.relationship.traversed=22, graph.seed.selected=1, graph.traversal.started=1
- context tokens: 948

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 56980 ms):

Based on the provided records, **7 accounts** are involved in sharing each of the shared payment instruments associated with PLAYER_GR_001283 [7][8]. The specific accounts linked to these instruments alongside PLAYER_GR_001283 include:

*   **PLAYER_AT_000847** (linked via PAY_SHARED_058) [7]
*   **PLAYER_AT_000274** (linked via PAY_SHARED_074) [8]
*   **PLAYER_GR_002168**, **PLAYER_GR_001794**, **PLAYER_GR_001760**, **PLAYER_GR_001947**, and **PLAYER_GR_001708** (linked via both PAY_SHARED_058 and PAY_SHARED_074) [7][8]

The payment method records explicitly state `accounts_sharing=7` for both PAY_SHARED_058 and PAY_SHARED_074 [7][8].

**Citations:** 18

### Pipeline C — graph relationships + enterprise ontology

- resolved seeds and traversal:
  - seeds: `PLAYER_GR_001283`, `CONCEPT_PLAYER_SEGMENT`
  - limits: depth<=2, nodes/hop<=100, total<=200, rel types=16
  - edges traversed: 40
  - ontology concepts: `CONCEPT_PLAYER_SEGMENT`
- selected node evidence (14):
  - `PLAYER_GR_001283` (Player, 0 hop(s) via SEED, score 0.879, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.654093, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001283, player_id=PLAYER_GR_001283, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_VALUE_MAINSTREAM
  - `CONCEPT_PLAYER_SEGMENT` (BusinessConcept, 0 hop(s) via SEED, score 0.835, components {'graph_distance': 1.0, 'relationship_type': 1.0, 'semantic_relevance': 0.529036, 'temporal_validity': 1.0})
  - `PAY_SHARED_058` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.767, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.715234, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_SHARED_058, accounts_sharing=7, links=PLAYER_AT_000847[weight=1.0,from=2025-01-21]; PLAYER_GR_002168[weight=0.15,from=2025-07-25]; PLAYER_GR_001283[weight=0.15,from=2025-07-25]; PLAYER_GR_001794[weight=0.15,from=2025-07-20]; PLAYER_GR_001760[weight=0.15,from=2025-07-24]; PLAYER_GR_001947[weight=0.15,from=2025-07-25]; PLAYER_GR_001708[weight=0.15,from=2025-07-20]
  - `PAY_SHARED_074` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.765, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.710306, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_SHARED_074, accounts_sharing=7, links=PLAYER_AT_000274[weight=1.0,from=2025-07-12]; PLAYER_GR_002168[weight=0.15,from=2025-07-25]; PLAYER_GR_001283[weight=0.15,from=2025-07-25]; PLAYER_GR_001794[weight=0.15,from=2025-07-20]; PLAYER_GR_001760[weight=0.15,from=2025-07-24]; PLAYER_GR_001947[weight=0.15,from=2025-07-25]; PLAYER_GR_001708[weight=0.15,from=2025-07-20]
  - `PAY_GR_0004300` (PaymentMethod, 1 hop(s) via USES_PAYMENT, score 0.763, components {'graph_distance': 0.666667, 'relationship_type': 0.8, 'semantic_relevance': 0.70342, 'temporal_validity': 1.0}); source_table=player_payment_method, source_record_id=PAY_GR_0004300, accounts_sharing=1, links=PLAYER_GR_001283[weight=1.0,from=2025-04-04]
  - `PLAYER_GR_001708` (Player, 2 hop(s) via USES_PAYMENT, score 0.697, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.632988, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001708, player_id=PLAYER_GR_001708, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_VALUE_MAINSTREAM
  - `PLAYER_GR_001760` (Player, 2 hop(s) via USES_PAYMENT, score 0.690, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.614902, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_GR_001760, player_id=PLAYER_GR_001760, market_id=MKT_GR, account_status=ACTIVE, value_segment=SEG_VALUE_MAINSTREAM
  - `PLAYER_AT_000274` (Player, 2 hop(s) via USES_PAYMENT, score 0.681, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.588153, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_AT_000274, player_id=PLAYER_AT_000274, market_id=MKT_AT, account_status=ACTIVE, value_segment=SEG_VALUE_BUDGET
  - `PLAYER_AT_000847` (Player, 2 hop(s) via USES_PAYMENT, score 0.680, components {'graph_distance': 0.5, 'relationship_type': 0.8, 'semantic_relevance': 0.585426, 'temporal_validity': 1.0}); source_table=players, source_record_id=PLAYER_AT_000847, player_id=PLAYER_AT_000847, market_id=MKT_AT, account_status=ACTIVE, value_segment=SEG_VALUE_BUDGET
  - `SEG_VALUE_BUDGET` (PlayerSegment, 1 hop(s) via MAPS_TO, score 0.640, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.565829, 'temporal_validity': 1.0})
  - `SEG_ENG_ENGAGED` (PlayerSegment, 1 hop(s) via MAPS_TO, score 0.630, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.537533, 'temporal_validity': 1.0})
  - `SEG_ENG_CASUAL` (PlayerSegment, 1 hop(s) via MAPS_TO, score 0.621, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.511811, 'temporal_validity': 1.0})
  - `SEG_VALUE_VIP` (PlayerSegment, 1 hop(s) via MAPS_TO, score 0.618, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.504737, 'temporal_validity': 1.0})
  - `SEG_ENG_DORMANT` (PlayerSegment, 1 hop(s) via MAPS_TO, score 0.611, components {'graph_distance': 0.666667, 'relationship_type': 0.5, 'semantic_relevance': 0.482519, 'temporal_validity': 1.0})
- discarded nodes: 28
- document chunks, shared vector channel (5):
  - `CHNK_0009_02` Campaign Evaluation: CMP_007 (similarity 0.563)
  - `CHNK_0075_02` Product Spec: GAME_AT_01 (similarity 0.549)
  - `CHNK_0073_00` Release Note: APPV_AT_520 (similarity 0.545)
  - `CHNK_0052_00` Product Spec: GAME_GR_01 (similarity 0.544)
  - `CHNK_0241_00` Product Spec: GAME_GR_05 (similarity 0.543)
- events: graph.candidate.discarded=31, graph.candidate.selected=19, graph.context.assembled=1, graph.entity.resolved=2, graph.entity_resolution.started=1, graph.evidence_path.completed=1, graph.generation.completed=1, graph.generation.started=1, graph.node.discovered=40, graph.ontology.expanded=1, graph.relationship.traversed=40, graph.seed.selected=2, graph.traversal.started=1
- context tokens: 877

**Answer** (ollama/qwen3.5:35b-a3b-q4_K_M, 72244 ms):

Based on the provided context sources, PLAYER_GR_001283 shares payment instruments with other accounts under two specific payment methods, each involving a total of 7 accounts [8][9].

*   **PaymentMethod PAY_SHARED_058**: This method involves 7 accounts [8]. The accounts sharing this instrument include PLAYER_AT_000847, PLAYER_GR_002168, PLAYER_GR_001794, PLAYER_GR_001760, PLAYER_GR_001947, and PLAYER_GR_001708.
*   **PaymentMethod PAY_SHARED_074**: This method also involves 7 accounts [9]. The accounts sharing this instrument include PLAYER_AT_000274, PLAYER_GR_002168, PLAYER_GR_001794, PLAYER_GR_001760, PLAYER_GR_001947, and PLAYER_GR_001708.

Additionally, PaymentMethod PAY_GR_0004300 is linked to PLAYER_GR_001283 but involves only 1 account, indicating no sharing for that specific instrument [10].

**Citations:** 19


