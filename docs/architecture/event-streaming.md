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

Event types are the typed catalogue in `docs/07-api-event-spec.md` (run.* and pipeline.* lifecycle events, rag.* and graph.*; the ontology.* and evaluation.* families are reserved and not emitted).

## Lifecycle

1. Pipeline stages emit typed events through the recorder.
2. The recorder persists each event (SQLite, ordered by `sequence`, ADR-007) before it is fanned out.
3. The stream route reads persisted events for the run and waits for new ones, so every client sees the stored sequence.
4. Replay (`GET /queries/{run_id}/events`) serves the stored sequence and never re-runs retrieval.
5. Persisted events are exactly what was streamed: no fabrication, no post-hoc rewriting.

## Ordering and delivery

- `sequence` is monotonic per run; clients render in sequence order.
- While no event arrives, a `: keep-alive` comment frame (not an event, so it has no sequence) is sent every `SSE_HEARTBEAT_S` seconds (default 15) to keep connections alive through proxies during long pipeline stages.
- A client resumes after a dropped connection with the `Last-Event-ID` header (or `?after=`) and receives only the events it has not seen.
- Exactly one terminal event ends a run (`run.completed`, `run.failed` or `run.cancelled`), and the stream closes after it.
- Cancellation is cooperative at event boundaries: the running pipeline stops at its next event, and a cancel and a finish that race are settled by one claim under a lock, so the run has one outcome.
- On pipeline failure a `pipeline.failed` event and then the terminal `run.failed` event (both carrying the typed error envelope of `docs/07`) are persisted and streamed; the run row records the failure state. Fake success is never presented.

## Consumers

- Live Lab: progressive graph traversal and RAG retrieval visualisation.
- Replay: run reconstruction from stored events.
- Evidence Explorer: events reference evidence IDs persisted with the run.
