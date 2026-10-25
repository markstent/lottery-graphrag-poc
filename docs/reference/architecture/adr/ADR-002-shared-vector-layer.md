# ADR-002 — Shared Vector Layer for Strict Comparison

**Decision:** Use a shared vector retrieval layer for strict A/B/C experiments.

**Reason:** Reduces confounding caused by comparing different vector engines.

**Consequence:** Neo4j-native vector search may be offered as a separate mode, not the primary fairness benchmark.
