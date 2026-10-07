# Implementation Phases and Human Approval Plan

## 1. Purpose

Define the order in which OpenCode should implement the POC.

The agent must not attempt the entire system in one task.

Each phase has:

- inputs
- deliverables
- tests
- human gate

---

# Phase 0 — Repository Bootstrap

## Build

- repository structure
- Python environment
- frontend environment
- linting
- formatting
- type checking
- pytest
- Vitest
- Playwright skeleton
- GitHub Actions
- `.env.example`
- Makefile/task commands
- Docker Compose skeleton

## Do not build yet

- final ontology
- final Neo4j model
- final UX
- final benchmark

## Acceptance

All empty/scaffold builds pass CI.

---

# Phase 1 — Product Documentation

Produce:

- product requirements
- research hypotheses
- non-goals
- terminology
- success criteria
- experimental configurations A/B/C

## Stop at HITL-01

Human approval required.

---

# Phase 2 — Architecture

Produce:

- system architecture
- backend modules
- frontend modules
- model abstraction
- vector layer
- Neo4j overlay design
- event streaming
- ADRs

## Prototype

Minimal mocked event flow is allowed.

## Stop at HITL-02

Human approval required.

---

# Phase 3 — Synthetic Data Model

Implement only after approved design.

Deliver:

- schemas
- small deterministic generator
- development dataset
- validation
- provenance

## Tests

- reproducibility
- referential integrity
- market/currency correctness

## Stop at HITL-03 before scaling

---

# Phase 4 — Ontology and Graph Model

Deliver:

- ontology definitions
- graph schema
- Neo4j constraints/indexes
- ingestion from development dataset
- example Cypher
- provenance

## Tests

- schema constraints
- source references
- bounded traversal

## Stop at HITL-04

---

# Phase 5 — Scenario Engine

Deliver:

- scenario configuration
- planted patterns
- evaluator-only truth ledger
- isolation tests

## Stop at HITL-05

---

# Phase 6 — UX Information Architecture

Before final frontend:

- user flows
- navigation
- screen specifications
- wireframes

## Stop at HITL-06

---

# Phase 7 — High-Fidelity UX Prototype

Build a frontend prototype using mocked data/events.

Required:

- Live Lab
- graph traversal animation
- RAG retrieval animation
- Evidence Explorer
- Results Dashboard
- Semantic Layer view
- presentation mode

No production retrieval integration is required yet.

## Visual regression baselines

Create approved screenshots.

## Stop at HITL-07

---

# Phase 8 — Standard RAG

Deliver credible baseline:

- chunking
- multilingual embeddings
- vector search
- optional reranking
- evidence object model
- citations
- telemetry

## Tests

- retrieval correctness
- context limits
- deterministic fake-model integration

---

# Phase 9 — GraphRAG

Deliver:

- entity resolution
- seed retrieval
- bounded graph traversal
- ontology expansion
- graph evidence ranking
- source-data lookup
- telemetry

## Demonstrate

At least three real side-by-side example traces.

## Stop at HITL-08

---

# Phase 10 — Benchmark and Evaluation

Deliver:

- 30-question bank
- scoring engine
- deterministic evaluator
- optional judge
- fairness controls
- reproducibility metadata

## Stop at HITL-09

No official benchmark before approval.

---

# Phase 11 — Full Integration

Connect:

- frontend
- API
- event stream
- retrieval engines
- graph
- evaluator
- replay
- evidence explorer

Run end-to-end tests.

---

# Phase 12 — Test Hardening

Deliver:

- unit test coverage
- integration test suite
- E2E suite
- visual regression
- failure-mode tests
- performance smoke tests

## Stop at HITL-10

---

# Phase 13 — Presentation Mode

Deliver:

- demo dataset
- fixed demo configuration
- saved questions
- reset/recovery
- benchmark results screen
- semantic overlay explanation
- replay

## Stop at HITL-11

---

# Phase 14 — Final Release Candidate

Only after HITL-11 approval:

- tag release
- generate final docs
- record benchmark version
- record demo run
- prepare presentation artefacts

---

# OpenCode Task Pattern

Every OpenCode instruction should be narrow.

Good:

```text
Read AGENTS.md and the approved Phase 3 specifications.
Implement the deterministic Market and Game generators only.
Add tests for reproducibility and referential integrity.
Do not implement Players or Transactions yet.
Stop after tests pass and report changed files.
```

Bad:

```text
Build the entire POC.
```

---

# Human Gate Report Template

At every gate, OpenCode must provide:

```text
Checkpoint:
Completed:
Artefacts:
Tests:
Screenshots/diagrams:
Open decisions:
Risks:
Recommended choice:
Approval required:
```

Then stop.

---

# Change Control

A previously approved phase must return to human review if a change materially affects:

- architecture
- ontology
- graph semantics
- data provenance
- experimental fairness
- benchmark scoring
- UX hierarchy
- presentation story
- security

Small bug fixes do not reopen a gate.
