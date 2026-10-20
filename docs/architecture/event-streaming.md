# Event Streaming

Use SSE by default for one-way execution telemetry (ADR-004).

Use WebSocket only if interactive runtime control cannot be cleanly supported through normal HTTP + SSE.

## Event structure

Every event carries exactly these eight fields, in replay and in the stream:

- event_id
- timestamp
- run_id
- pipeline
- event_type
- t_ms
- payload
- sequence

Event types are the typed catalogue in `docs/07-api-event-spec.md` (run.* and pipeline.* lifecycle events, rag.*, graph.*, ontology.*, evaluation.*).

## Lifecycle

1. Pipeline stages emit typed events through the recorder.
2. The recorder persists each event (SQLite, ordered by `sequence`, ADR-007) before it is fanned out.
3. The SSE hub streams persisted events to connected clients for the run.
4. Replay (`GET /queries/{run_id}/events`) serves the stored sequence and never re-runs retrieval.
5. Persisted events are exactly what was streamed: no fabrication, no post-hoc rewriting.

## Ordering and delivery

- `sequence` is monotonic per run; clients render in sequence order.
- A heartbeat event keeps connections alive through proxies during long pipeline stages.
- On pipeline failure a `pipeline.failed` event and then the terminal `run.failed` event (both carrying the typed error envelope of `docs/07`) are persisted and streamed; the run row records the failure state. Fake success is never presented.

## Consumers

- Live Lab: progressive graph traversal and RAG retrieval visualisation.
- Replay: run reconstruction from stored events.
- Evidence Explorer: events reference evidence IDs persisted with the run.
