# AGENTS.md

## Mission

Build and maintain a professional experimental application that demonstrates the incremental value of adding a knowledge graph and enterprise ontology above an existing synthetic enterprise data layer.

The application compares conventional RAG with graph-enhanced retrieval across a synthetic multinational lottery environment operating in:

- United Kingdom
- Greece
- Austria
- Czech Republic

This is presentation-quality software and a credible experiment.

It is not a throwaway prototype.

Read the relevant files under `/docs` before implementing or modifying any subsystem.

---

# Non-Negotiable Naming and Data Rules

Never use the real employer/company name anywhere in:

- source code
- documentation
- synthetic data
- prompts
- tests
- screenshots
- UI
- comments
- fixtures
- database names
- environment names

Never use the word `Atlas` as:

- project name
- product name
- platform name
- system name
- database name
- environment name
- internal codename
- synthetic company name

All customer, player, employee, transaction, product, document and operational information must be synthetic.

Never introduce real proprietary, personal, customer or employee information.

---

# Source of Truth

Use this precedence when requirements conflict:

1. `AGENTS.md`
2. explicit instructions from the project owner
3. `docs/superpowers/specs/2026-10-18-overhaul-design.md`
4. `docs/architecture.md`
5. `docs/data.md`
6. `docs/graph-and-ontology.md`
7. `docs/scenarios.md`
8. `docs/retrieval.md`
9. `docs/evaluation.md`
10. `docs/api.md`
11. `docs/ux.md`
12. `docs/operations.md`
13. `README.md`
14. existing implementation

`docs/reference/` is an archive of earlier specifications.
It records history and is not a source of truth.

If implementation conflicts with a written specification, do not silently preserve the implementation.

Document the discrepancy.

Do not materially change product requirements, research methodology, ontology semantics, data provenance rules, scoring, or UX hierarchy merely to make implementation easier.

---

# Human-in-the-Loop Rule

This repository uses mandatory human approval gates.

The coding agent must stop at defined checkpoints.

Do not proceed beyond a checkpoint without explicit human approval.

Silence is not approval.

A successful build, passing tests, or apparent correctness is not approval.

Explicit approval may be phrased as:

```text
Approved
Proceed
Continue
HITL-07 approved
Proceed to the next phase
```

The current approved checkpoint state should be recorded in project documentation.

---

# Required Human Checkpoints

## HITL-01 - Product Scope

Stop after preparing:

- product requirements
- research hypotheses
- experimental configurations
- non-goals
- success criteria

Do not finalise architecture until approved.

---

## HITL-02 - Architecture

Stop after preparing:

- system architecture
- frontend/backend boundaries
- model gateway
- vector layer
- Neo4j overlay
- event streaming
- major ADRs

Do not implement the final architecture until approved.

---

## HITL-03 - Synthetic Data Model

Stop after preparing:

- relational schema
- entity model
- event model
- dataset volumes
- source-of-truth boundaries
- representative sample records

Do not build large-scale generators or ingestion until approved.

---

## HITL-04 - Ontology and Graph Model

Stop after preparing:

- ontology
- node types
- relationship types
- canonical concepts
- source provenance
- cross-market mappings
- example traversals

Do not implement final graph ingestion or GraphRAG until approved.

---

## HITL-05 - Scenario Library and Truth Ledger

Stop after preparing:

- planted scenario library
- scenario generation rules
- truth-ledger schema
- expected observable signals

Do not generate official benchmark data until approved.

---

## HITL-06 - UX Information Architecture

Stop after preparing:

- screen inventory
- navigation
- user journeys
- live comparison flow
- evidence-inspection flow
- presentation flow

Do not start final high-fidelity design until approved.

---

## HITL-07 - High-Fidelity UX

Stop after preparing:

- wireframes
- approved visual language
- Live Lab mock-up
- graph traversal mock-up
- RAG retrieval mock-up
- Results Dashboard mock-up
- Semantic Layer mock-up
- loading/error/completed states
- presentation mode concept

Do not build the final frontend until approved.

---

## HITL-08 - Retrieval Behaviour

Stop after implementing prototypes of:

- conventional RAG
- GraphRAG
- evidence tracking
- graph traversal telemetry
- context assembly

Present real execution traces.

Do not lock benchmark methodology until approved.

---

## HITL-09 - Benchmark and Scoring

Stop after preparing:

- benchmark categories
- question bank
- deterministic scoring
- evidence scoring
- fairness controls
- LLM-as-judge rules if used

Do not perform official benchmark runs until approved.

---

## HITL-10 - Testing and Quality

Stop after preparing:

- CI
- test matrix
- unit tests
- integration tests
- E2E tests
- visual regression tests
- critical coverage report

Do not declare release-candidate status until approved.

---

## HITL-11 - Presentation Readiness

Stop after preparing:

- presentation mode
- demo reset
- replay
- final dashboard
- demo script
- recovery procedure
- final architecture explanation

Do not declare the POC complete until approved.

---

## HITL-12 - Overhaul v2

The project owner approved the overhaul design on 2026-10-18.
For the v2 work the approval model is one design document, then three checkpoints.

- The design document is `docs/superpowers/specs/2026-10-18-overhaul-design.md`.
- CP1 Experiment: stop after world v2, ontology v2, eight planted scenarios, pipelines v2, bank 2.0.0, harness v2 and a small real-model smoke run.
- CP2 Product: stop after Overview, Live Lab, Data Model and Help are built against the live API.
- CP3 Official run: stop after the Results screen, the model and cost choice for the official run, and a dry run on four questions, before the full run.

HITL-12 supersedes gates HITL-03 to HITL-09 for the v2 work.
The agent stops at each checkpoint and reports with artefacts and screenshots, as in "What to Provide at Every HITL Gate".
Work happens on branch `overhaul/v2`, merged to `main` at each approved checkpoint.
`HITL_STATUS.md` records HITL-12 and each checkpoint, and only the project owner may mark one approved.

---

# What to Provide at Every HITL Gate

At each checkpoint provide:

1. completed artefacts
2. concise summary
3. screenshots or diagrams where relevant
4. unresolved decisions
5. known risks
6. alternatives considered
7. recommended choice
8. tests completed
9. explicit statement of what approval is required

Then stop.

Do not continue into the next gated phase.

---

# Graph Augmentation Principle

The knowledge graph is an augmentation layer over the existing synthetic enterprise data layer.

Neo4j must not be treated as a wholesale replacement for the analytical or transactional data layer.

Where appropriate:

- authoritative quantitative facts remain in the underlying structured layer
- documents remain in the document/vector layer
- Neo4j stores semantic entities, relationships, ontology mappings and provenance
- graph nodes retain references to authoritative source records
- graph retrieval may guide the agent toward relevant source-system queries
- final numerical claims should use authoritative source data where available

The system must demonstrate incremental graph adoption.

---

# Experimental Configurations

Support at least:

```text
A. Existing data layer + conventional RAG
B. Existing data layer + graph relationships
C. Existing data layer + graph relationships + enterprise ontology
```

Do not design this as a database replacement comparison.

The purpose is to isolate and quantify the value added by graph and ontology layers.

---

# Experimental Integrity

Do not bias one system to make another appear better.

In strict comparison mode use:

- same question
- same synthetic world
- same source corpus
- same embedding model
- same generation model
- same model parameters
- equivalent context budgets where practical

Never expose evaluator truth to any retrieval pipeline.

Never leak expected benchmark answers into prompts.

The conventional RAG baseline must be credible and well tuned.

---

# Before Starting Any Task

Before modifying code:

1. inspect the relevant specification
2. inspect existing implementation
3. inspect existing tests
4. identify the relevant HITL phase
5. confirm the requested change does not cross an unapproved gate

Do not make broad architectural changes while solving a narrow task unless necessary.

For material architectural changes, create or update an ADR.

---

# LLM Access

All model access must pass through the configured abstraction layer.

Do not hard-code a provider.

Support local and remote inference through configuration.

Never expose hidden chain-of-thought.

The UI may display observable execution events only.

Examples:

- query submitted
- entities resolved
- chunks retrieved
- graph seed selected
- relationship traversed
- evidence ranked
- context assembled
- answer generated

Never fabricate model reasoning.

---

# Synthetic Data

Generation must be deterministic.

Every world records:

- generator version
- world seed
- scenario seed
- configuration

Given identical inputs, generation should reproduce identical outputs.

All planted patterns must be produced through the scenario system.

Do not manually patch benchmark datasets to make demonstrations work.

Every planted scenario requires truth-ledger metadata.

---

# Truth-Ledger Isolation

The truth ledger exists only for evaluation.

Retrieval code must never import, query or inspect evaluator-only truth.

Add tests specifically verifying truth-ledger isolation.

Treat any leakage as a critical defect.

---

# Code Quality

Treat the repository as production-quality software.

Do not:

- create giant files unnecessarily
- duplicate substantial logic
- hard-code experiment configuration
- swallow exceptions
- silently change experimental behaviour
- leave dead code
- introduce unexplained magic constants
- add fake placeholder implementations to completed features
- use TODO comments instead of required implementation
- disable tests to make CI pass

Prefer clear, maintainable code.

---

# Python Standards

Use:

- type annotations
- Pydantic at external boundaries
- structured exceptions
- dependency injection where useful
- cohesive modules
- async I/O where appropriate

Run:

```bash
ruff format .
ruff check .
pytest
```

Run configured static type checking before marking work complete.

---

# TypeScript / React Standards

Use TypeScript strict mode.

Avoid `any`.

If `any` is unavoidable, document why.

Separate:

- API access
- state management
- domain/business logic
- retrieval telemetry
- presentation components

Do not bury scoring or experimental logic inside React components.

Use design tokens.

---

# UX Rules

The application must remain visually coherent.

Follow `docs/ux.md`, which holds the screens, visual language, interaction, animation and accessibility rules.

Primary target is a 16:9 desktop presentation.

Every important interaction must support:

- normal
- loading
- empty where relevant
- error
- disabled where relevant

Animation must explain system state.

Do not add motion for decoration alone.

---

# Mock-up Contract

Approved mock-ups are visual contracts.

Do not materially change:

- information hierarchy
- layout
- component placement
- colour semantics
- interaction patterns

without updating the relevant UX specification and obtaining the appropriate human approval.

---

# Graph Traversal Visualisation

Graph traversal is a primary product feature.

The GraphRAG UI must visualise actual retrieval events rather than a generic graph representation.

Each displayed node or edge must correspond to:

- a real seed
- a real traversal
- a candidate
- selected evidence
- rejected evidence
- an ontology concept
- a source record

Support visual states for:

```text
seed
active_traversal
candidate
selected
discarded
ontology_concept
source_record
```

Graph expansion must be progressive.

Do not render the entire enterprise graph.

Prefer clear evidence paths over maximum node count.

All traversal animation must be driven by structured backend telemetry.

Traversal must be replayable.

Do not fabricate graph activity.

---

# Standard RAG Visualisation

The Standard RAG side must visualise real retrieval events:

- embedding
- candidate chunks
- similarity
- reranking
- selected context
- discarded context

Do not create fake activity purely for presentation.

---

# Accessibility

Preserve:

- keyboard navigation
- visible focus states
- readable contrast
- semantic structure
- reduced motion
- non-colour status cues
- textual alternatives for graph information

Do not make primary interactions mouse-only.

---

# Testing

Every meaningful change must include appropriate tests.

Use:

- pytest
- Vitest
- React Testing Library
- Playwright

Critical areas requiring strong test coverage:

- scoring
- truth-ledger isolation
- scenario injection
- deterministic generation
- evidence selection
- benchmark execution
- experiment configuration
- graph traversal limits
- provenance

CI must not require a live commercial model.

Use deterministic fake/model adapters for CI.

---

# Regression Discipline

Before completing work:

- run relevant existing tests
- run type checks
- run linters
- run formatting
- update docs
- check visual regression if UI changed

Do not delete inconvenient tests.

If requirements genuinely change, update specifications first.

---

# API Contracts

Use typed request and response models.

Use versioned endpoints.

Do not expose database internals directly.

Execution telemetry must use explicit typed schemas.

Breaking API changes require coordinated frontend updates.

---

# Neo4j Rules

Centralise Cypher.

Do not scatter raw Cypher strings across unrelated code.

Graph traversal must have explicit limits.

Traversal depth, relationship types, node limits and candidate limits must be configurable.

Never run unbounded user-driven traversal.

Preserve evidence provenance.

---

# Standard RAG Rules

Standard RAG must be a credible baseline.

Do not intentionally weaken:

- chunking
- semantic retrieval
- reranking
- context construction

Record all candidate and selected evidence.

---

# GraphRAG Rules

Track:

- seed evidence
- resolved entities
- traversed relationships
- candidate nodes
- selected evidence
- rejected evidence
- traversal depth
- ontology concepts used

Do not assume that more graph context is better.

Respect context budgets.

---

# Evaluation Rules

Evaluation must be implementation-independent.

Retrieval systems must not call evaluator internals.

Prefer deterministic scoring.

LLM-as-judge must be clearly identified and versioned.

Every official result must retain complete reproducibility metadata.

---

# Observability

Use structured logs.

Include identifiers such as:

```text
experiment_id
run_id
question_id
pipeline
```

Record timings for:

- embedding
- vector retrieval
- graph traversal
- reranking
- context building
- LLM generation
- evaluation

Never log secrets.

---

# Secrets

Never commit:

- API keys
- passwords
- tokens
- credentials

Use environment variables.

Update `.env.example` when new configuration is introduced.

---

# Documentation

When behaviour changes, documentation changes with it.

Every major subsystem should explain:

- purpose
- architecture
- operation
- configuration
- testing
- extension points
- failure modes

Documentation should teach the project owner how the system works.

---

# Dependencies

Add dependencies only when they provide clear value.

Before adding one:

- check whether an existing dependency solves the problem
- prefer maintained libraries
- avoid overlapping libraries
- record major dependency decisions

Pin versions.

---

# Error Handling

Never present fake success after real failure.

Surface meaningful errors for:

- model calls
- embeddings
- Neo4j
- vector retrieval
- scenario generation
- benchmark execution
- evaluation

User-facing errors should be understandable.

Logs should preserve technical detail.

---


# Lean Engineering and Minimum Sufficient Code

The project must be implemented with the **minimum sufficient code required to satisfy the approved specifications and tests**.

Professional engineering does not mean maximum abstraction.

Optimise for:

- small, cohesive modules
- clear responsibilities
- simple control flow
- explicit data contracts
- low coupling
- high testability
- minimal dependency count
- reuse only where genuine duplication exists
- straightforward code that another engineer can understand quickly

Do not introduce architecture or abstractions merely because they may be useful later.

Avoid:

- speculative abstractions
- unnecessary base classes
- unnecessary interfaces or protocols
- factories where direct construction is sufficient
- repository/service/manager layers that add no meaningful boundary
- wrapper classes around libraries without a concrete need
- duplicate domain models
- unnecessary indirection
- generic frameworks built specifically for this POC
- premature plugin systems
- event buses where direct typed calls are sufficient
- excessive helper utilities
- dependency injection containers unless clearly justified
- multiple libraries solving the same problem
- premature optimisation
- code generated only to appear "enterprise"

Prefer:

```text
simple function
before
class hierarchy

direct typed call
before
generic event abstraction

one well-defined module
before
multiple pass-through layers

existing library capability
before
custom framework

configuration
before
duplicated implementations
```

## Abstraction Rule

Create an abstraction only when at least one of these is true:

1. two or more real implementations currently exist,
2. it isolates an external dependency that must be replaceable,
3. it creates a meaningful test seam,
4. it enforces a genuine domain boundary,
5. the approved architecture explicitly requires it.

"May be useful later" is not sufficient.

## Dependency Rule

Before adding a dependency, verify:

1. the standard library or an existing dependency cannot reasonably solve it,
2. the dependency removes more code/complexity than it adds,
3. it is maintained,
4. it does not substantially overlap another dependency.

Record justification for significant new dependencies.

## Module Size and Responsibility

Prefer modules organised around cohesive domain responsibilities.

Do not split code into tiny files solely to achieve an arbitrary line count.

Do not allow unrelated responsibilities to accumulate in one giant module.

A module should have one clear reason to change.

## Refactoring Rule

Do not refactor working code merely to introduce a pattern.

Refactor when there is concrete evidence of:

- duplication
- difficult testing
- poor cohesion
- high coupling
- repeated defects
- a newly approved architectural requirement

## Code Review Self-Check

Before completing a task, ask:

- Can any new layer be removed without losing clarity or testability?
- Can this be implemented with fewer concepts?
- Did I add a dependency that is not necessary?
- Did I create an abstraction with only one implementation and no clear boundary reason?
- Did I duplicate a model or transformation unnecessarily?
- Is the code easy to trace from API/event input to domain behaviour to output?

If the simpler version is equally correct and maintainable, use the simpler version.


# Definition of Done

A task is complete only when:

- implementation is complete
- relevant tests exist
- tests pass
- linting passes
- formatting passes
- type checking passes
- documentation is updated
- error states are handled
- acceptance criteria are met
- relevant accessibility checks are complete
- required HITL approval has been obtained

For frontend changes also confirm:

- presentation behaviour
- loading state
- error state
- accessibility
- visual regression where appropriate

---

# When Uncertain

Do not silently invent important:

- business rules
- graph semantics
- ontology concepts
- benchmark logic
- scoring
- UX hierarchy
- architecture

For small implementation details, choose the simplest maintainable option consistent with approved specifications.

For material decisions affecting:

- architecture
- ontology
- graph semantics
- experimental fairness
- scoring
- data provenance
- UX
- security

stop and raise the decision at the appropriate human checkpoint.
