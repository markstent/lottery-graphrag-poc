# API and Event Contract Specification

## 1. Purpose

Define stable typed contracts between:

- frontend
- backend
- retrieval engines
- graph engine
- evaluation engine
- benchmark runner

Live visualisation must be driven by real backend events.

---

## 2. API Principles

- version endpoints
- typed request/response schemas
- no database objects exposed directly
- stable IDs
- explicit error types
- idempotency where appropriate
- structured telemetry
- no hidden truth in public APIs

Base path:

```text
/api/v1
```

---

## 3. Core Endpoints

### Experiments

```text
POST   /experiments
GET    /experiments/{experiment_id}
POST   /experiments/{experiment_id}/reset
```

### Datasets

```text
POST   /datasets/generate
GET    /datasets/{dataset_id}
GET    /datasets
```

### Scenarios

```text
GET    /scenarios
POST   /scenarios/validate
```

### Query execution

```text
POST   /queries
GET    /queries/{run_id}
GET    /queries/{run_id}/evidence
GET    /queries/{run_id}/events
```

### Benchmarks

```text
POST   /benchmarks
GET    /benchmarks/{benchmark_run_id}
POST   /benchmarks/{benchmark_run_id}/cancel
GET    /benchmarks/{benchmark_run_id}/results
```

### Models

```text
GET    /models
GET    /models/status
```

### Graph inspection

```text
GET    /graph/nodes/{node_id}
GET    /graph/evidence-paths/{run_id}
```

---

## 4. Query Request

```json
{
  "experiment_id": "EXP-001",
  "question": "Why did digital conversion fall in Greece?",
  "market_scope": ["GR"],
  "configurations": ["A", "B", "C"],
  "presentation_mode": false
}
```

---

## 5. Query Response

Initial request should return quickly:

```json
{
  "run_id": "RUN-001",
  "status": "RUNNING",
  "event_stream_url": "/api/v1/queries/RUN-001/events"
}
```

Final state:

```json
{
  "run_id": "RUN-001",
  "status": "COMPLETED",
  "results": {
    "A": {},
    "B": {},
    "C": {}
  }
}
```

---

## 6. Event Transport

Prefer Server-Sent Events unless bidirectional runtime control requires WebSocket.

Event structure:

```json
{
  "event_id": "EVT-00001",
  "event_type": "graph.relationship.traversed",
  "timestamp": "2026-01-01T10:00:00Z",
  "experiment_id": "EXP-001",
  "run_id": "RUN-001",
  "pipeline": "C",
  "sequence": 12,
  "payload": {}
}
```

Events must be ordered by `sequence`.

---

## 7. Standard RAG Events

```text
rag.query.received
rag.embedding.started
rag.embedding.completed
rag.vector_search.started
rag.candidate.retrieved
rag.rerank.started
rag.candidate.reranked
rag.evidence.selected
rag.evidence.discarded
rag.context.assembled
rag.generation.started
rag.generation.completed
```

Example:

```json
{
  "event_type": "rag.candidate.retrieved",
  "pipeline": "A",
  "payload": {
    "chunk_id": "CHUNK-0081",
    "document_id": "DOC-021",
    "similarity": 0.884,
    "rank": 2
  }
}
```

---

## 8. Graph Events

```text
graph.entity_resolution.started
graph.entity.resolved
graph.seed.selected
graph.traversal.started
graph.node.discovered
graph.relationship.traversed
graph.ontology.expanded
graph.candidate.selected
graph.candidate.discarded
graph.evidence_path.completed
graph.context.assembled
graph.generation.started
graph.generation.completed
```

Example:

```json
{
  "event_type": "graph.relationship.traversed",
  "pipeline": "C",
  "payload": {
    "source_id": "GAME_GR_04",
    "source_type": "Game",
    "relationship_type": "RUNS_ON",
    "target_id": "PLATFORM_MOBILE_02",
    "target_type": "Platform",
    "hop": 1,
    "confidence": 1.0
  }
}
```

---

## 9. Ontology Events

```text
ontology.term.mapped
ontology.concept.resolved
ontology.concept.expanded
ontology.equivalence.applied
```

Example:

```json
{
  "event_type": "ontology.concept.expanded",
  "pipeline": "C",
  "payload": {
    "source_entity_id": "GAME_GR_04",
    "concept_id": "CONCEPT_HIGH_FREQUENCY_GAME",
    "relation": "INSTANCE_OF"
  }
}
```

---

## 10. Evaluation Events

```text
evaluation.started
evaluation.metric.scored
evaluation.completed
```

Example:

```json
{
  "event_type": "evaluation.metric.scored",
  "payload": {
    "metric": "evidence_recall",
    "value": 0.92
  }
}
```

---

## 11. Error Events

Use explicit error classes.

```text
MODEL_ERROR
EMBEDDING_ERROR
VECTOR_RETRIEVAL_ERROR
GRAPH_QUERY_ERROR
ONTOLOGY_ERROR
CONTEXT_BUILD_ERROR
EVALUATION_ERROR
CONFIGURATION_ERROR
TIMEOUT_ERROR
```

Example:

```json
{
  "event_type": "run.error",
  "payload": {
    "error_code": "GRAPH_QUERY_ERROR",
    "message": "Graph traversal failed.",
    "retryable": true
  }
}
```

Do not expose secrets or stack traces to normal UI responses.

---

## 12. Evidence Object

Common evidence schema:

```json
{
  "evidence_id": "EVD-001",
  "evidence_type": "DOCUMENT_CHUNK",
  "source_id": "CHUNK-0081",
  "source_system": "synthetic_document_store",
  "title": "March Mobile Release Review",
  "excerpt": "...",
  "market_id": "GR",
  "valid_from": "2026-03-01",
  "valid_to": null,
  "score": 0.91,
  "provenance": {}
}
```

Other evidence types:

```text
STRUCTURED_RECORD
GRAPH_NODE
GRAPH_RELATIONSHIP
GRAPH_PATH
DERIVED_METRIC
DOCUMENT_CHUNK
```

---

## 13. Graph Node DTO

```json
{
  "node_id": "GAME_GR_04",
  "node_type": "Game",
  "display_label": "Synthetic Game 04",
  "market_id": "GR",
  "visual_state": "candidate",
  "provenance": {
    "source_system": "synthetic_warehouse",
    "source_record_id": "GAME_GR_04"
  }
}
```

---

## 14. Graph Edge DTO

```json
{
  "edge_id": "EDGE-992",
  "source_id": "GAME_GR_04",
  "target_id": "PLATFORM_MOBILE_02",
  "relationship_type": "RUNS_ON",
  "visual_state": "traversed",
  "properties": {}
}
```

---

## 15. Replay

Persist enough events to reconstruct UI state.

Replay endpoint:

```text
GET /queries/{run_id}/events
```

Replay must use recorded event sequence rather than rerunning retrieval.

---

## 16. Benchmark Results DTO

Each question result:

```json
{
  "question_id": "Q-021",
  "configuration": "C",
  "metrics": {
    "correctness": 0.94,
    "evidence_precision": 0.88,
    "evidence_recall": 1.0,
    "grounding": 0.96,
    "latency_ms": 2680,
    "input_tokens": 4120,
    "output_tokens": 480
  },
  "failure_class": null
}
```

---

## 17. Versioning

All contracts must include schema versions where persisted.

Breaking changes require:

- API version change or compatibility layer
- frontend coordination
- migration notes
- tests

---

## 18. Testing

Contract tests must cover:

- request validation
- invalid config
- event ordering
- event schema
- graph replay
- error events
- truth-ledger non-exposure

---

## 19. HITL Gate

API contracts are part of **HITL-02 Architecture Approval** and **HITL-08 Retrieval Behaviour Approval**.

Do not freeze event contracts before reviewing real prototype traces.
