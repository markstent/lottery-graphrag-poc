# Reference archive

This folder holds the documentation written before and during the build, moved here unchanged.
It records what was specified and decided at the time.
It is not kept current, and links inside it may point at paths that no longer exist.

The current truth lives in ten primary documents:

- `README.md` at the repository root
- `docs/architecture.md`
- `docs/data.md`
- `docs/graph-and-ontology.md`
- `docs/scenarios.md`
- `docs/retrieval.md`
- `docs/evaluation.md`
- `docs/api.md`
- `docs/ux.md`
- `docs/operations.md`

The governance files stay at the repository root: `AGENTS.md`, `DECISIONS.md`, `HITL_STATUS.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and `RELEASE.md`.
Plans and the overhaul design spec stay under `docs/superpowers/`.
The generated question bank stays at `docs/evaluation/question-bank.md`.

Each entry below names an archived file, says what it was, and says which primary document replaces it.
A test (`backend/tests/test_docs_links.py`) fails if any file outside this folder still names one of these files at its old path.

## Numbered specifications

- `docs/reference/01-synthetic-data-spec.md` - the synthetic world specification: profiles, volumes, master data, tables, validation. Replaced by `docs/data.md`.
- `docs/reference/02-graph-schema-spec.md` - the original graph schema: node and relationship types, constraints, centralised Cypher. Replaced by `docs/graph-and-ontology.md`.
- `docs/reference/03-ontology-spec.md` - the original enterprise ontology and cross-market mappings. Replaced by `docs/graph-and-ontology.md`.
- `docs/reference/04-scenario-catalogue.md` - the planted scenario catalogue and truth-ledger design. Replaced by `docs/scenarios.md`.
- `docs/reference/05-benchmark-spec.md` - the original benchmark and scoring specification. Replaced by `docs/evaluation.md`.
- `docs/reference/06-ux-spec.md` - the original product experience specification. Replaced by `docs/ux.md`.
- `docs/reference/07-api-event-spec.md` - the original API and event contract. Replaced by `docs/api.md`.
- `docs/reference/08-implementation-phases.md` - the original phase plan for the build. Replaced by `HITL_STATUS.md`, which records the phases as built.

## Root planning documents

- `docs/reference/MASTER_SPECIFICATION.md` - the single-page statement of the project at the start. Replaced by `README.md` and `docs/architecture.md`.
- `docs/reference/START_HERE.md` - the reading order for the first coding agent. Replaced by `README.md`.
- `docs/reference/BUILD_PLAN.md` - the first build plan. Replaced by `HITL_STATUS.md`.
- `docs/reference/FILE_INVENTORY.md` - the inventory of the starting document set. Replaced by the document map in `README.md`.
- `docs/reference/MODEL_HANDOFF_CHECKLIST.md` - the checklist for handing work between model sessions. Replaced by `docs/operations.md`.

## Product

- `docs/reference/product/demo-script.md` - the first demo script. Replaced by `docs/operations.md`.
- `docs/reference/product/non-goals.md` - what the experiment does not try to do. Replaced by `README.md`.
- `docs/reference/product/product-requirements.md` - the product requirements. Replaced by `README.md` and `docs/architecture.md`.
- `docs/reference/product/research-hypotheses.md` - the research hypotheses. Replaced by `docs/evaluation.md`.
- `docs/reference/product/success-criteria.md` - the success criteria. Replaced by `docs/evaluation.md`.
- `docs/reference/product/terminology.md` - the project glossary. Replaced by `docs/ux.md`.
- `docs/reference/product/user-journeys.md` - the user journeys. Replaced by `docs/ux.md`.

## Architecture

- `docs/reference/architecture/adr/ADR-001-neo4j-overlay.md` - the decision to use Neo4j as an overlay. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-002-shared-vector-layer.md` - the decision on one shared vector layer. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-003-litellm.md` - the decision on the model gateway. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-004-sse.md` - the decision to stream events over server-sent events. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-005-graph-visualisation.md` - the decision on graph visualisation. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-006-structured-data-layer.md` - the decision on the structured data layer. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-007-run-persistence.md` - the decision on run persistence. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-008-truth-ledger-isolation.md` - the decision on truth-ledger isolation. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/adr/ADR-009-tooling-and-layout.md` - the decision on tooling and repository layout. Replaced by the ADR index in `docs/architecture.md`.
- `docs/reference/architecture/backend-architecture.md` - the backend design. Replaced by `docs/architecture.md`.
- `docs/reference/architecture/data-layer-integration.md` - how the graph sits above the data layer. Replaced by `docs/architecture.md` and `docs/graph-and-ontology.md`.
- `docs/reference/architecture/event-streaming.md` - the event streaming design. Replaced by `docs/architecture.md` and `docs/api.md`.
- `docs/reference/architecture/frontend-architecture.md` - the frontend design. Replaced by `docs/architecture.md`.
- `docs/reference/architecture/lean-engineering-principles.md` - the lean engineering rules. Replaced by `AGENTS.md`.
- `docs/reference/architecture/model-layer.md` - the model gateway design. Replaced by `docs/architecture.md`.
- `docs/reference/architecture/security-architecture.md` - the security design. Replaced by `docs/architecture.md`.
- `docs/reference/architecture/system-architecture.md` - the system architecture. Replaced by `docs/architecture.md`.

## Data

- `docs/reference/data/data-dictionary.md` - the data dictionary. Replaced by `docs/data.md`.
- `docs/reference/data/document-corpus.md` - the synthetic document corpus design. Replaced by `docs/data.md`.
- `docs/reference/data/graph-ingestion.md` - how source tables become graph nodes. Replaced by `docs/graph-and-ontology.md`.
- `docs/reference/data/provenance-model.md` - the provenance rules. Replaced by `docs/data.md`.
- `docs/reference/data/source-system-contracts.md` - the contracts of the synthetic source systems. Replaced by `docs/data.md`.

## Retrieval

- `docs/reference/retrieval/context-budgeting.md` - the context budget rules. Replaced by `docs/retrieval.md`.
- `docs/reference/retrieval/embeddings.md` - the embedding model choices. Replaced by `docs/retrieval.md`.
- `docs/reference/retrieval/evidence-ranking.md` - the graph evidence ranking signals. Replaced by `docs/retrieval.md`.
- `docs/reference/retrieval/graph-rag.md` - the graph pipeline design. Replaced by `docs/retrieval.md`.
- `docs/reference/retrieval/reranking.md` - the shared reranker. Replaced by `docs/retrieval.md`.
- `docs/reference/retrieval/retrieval-fairness.md` - the fairness contract between pipelines. Replaced by `docs/retrieval.md`.
- `docs/reference/retrieval/standard-rag.md` - the conventional RAG pipeline design. Replaced by `docs/retrieval.md`.

## Evaluation

- `docs/reference/evaluation/failure-taxonomy.md` - the failure categories. Replaced by `docs/evaluation.md`.
- `docs/reference/evaluation/fairness-matrix.md` - the fairness controls per configuration. Replaced by `docs/evaluation.md` and `docs/retrieval.md`.
- `docs/reference/evaluation/harness-validation.md` - the validation record of the first harness. Replaced by `docs/evaluation.md`.
- `docs/reference/evaluation/reproducibility.md` - the reproducibility metadata. Replaced by `docs/evaluation.md`.
- `docs/reference/evaluation/scoring.md` - the scoring rules. Replaced by `docs/evaluation.md`.
- `docs/reference/evaluation/statistics.md` - the statistics rules. Replaced by `docs/evaluation.md`.

## Testing

- `docs/reference/testing/acceptance-criteria.md` - the acceptance criteria. Replaced by `docs/operations.md`.
- `docs/reference/testing/coverage.md` - the coverage record. Replaced by `docs/operations.md`.
- `docs/reference/testing/performance-testing.md` - the performance testing plan. Replaced by `docs/operations.md`.
- `docs/reference/testing/test-data-strategy.md` - the test data strategy. Replaced by `docs/operations.md`.
- `docs/reference/testing/testing-strategy.md` - the testing strategy. Replaced by `docs/operations.md`.
- `docs/reference/testing/visual-regression.md` - the visual regression plan. Replaced by `docs/operations.md`.

## UX

- `docs/reference/ux/accessibility.md` - the accessibility requirements. Replaced by `docs/ux.md`.
- `docs/reference/ux/animation-specification.md` - the animation rules. Replaced by `docs/ux.md`.
- `docs/reference/ux/graph-visualisation-spec.md` - the graph visualisation specification. Replaced by `docs/ux.md`.
- `docs/reference/ux/information-architecture.md` - the original screen inventory and navigation. Replaced by `docs/ux.md`.
- `docs/reference/ux/interaction-specification.md` - the interaction rules. Replaced by `docs/ux.md`.
- `docs/reference/ux/presentation-mode.md` - the presentation mode concept. Replaced by `docs/ux.md`.
- `docs/reference/ux/responsive-behaviour.md` - the responsive behaviour rules. Replaced by `docs/ux.md`.
- `docs/reference/ux/screen-specifications.md` - the screen specifications. Replaced by `docs/ux.md`.
- `docs/reference/ux/user-flows.md` - the user flows. Replaced by `docs/ux.md`.
- `docs/reference/ux/visual-language.md` - the visual language and design tokens. Replaced by `docs/ux.md`.

## Development and demo

- `docs/reference/development/commands.md` - the stable command surface. Replaced by `docs/operations.md`.
- `docs/reference/development/demo-recovery.md` - how to recover a demo. Replaced by `docs/operations.md`.
- `docs/reference/development/local-development.md` - local setup. Replaced by `docs/operations.md`.
- `docs/reference/development/model-setup.md` - local and remote model setup. Replaced by `docs/operations.md`.
- `docs/reference/development/neo4j-setup.md` - Neo4j setup. Replaced by `docs/operations.md`.
- `docs/reference/development/troubleshooting.md` - troubleshooting notes. Replaced by `docs/operations.md`.
- `docs/reference/demo/presentation.md` - the presentation run-of-show. Replaced by `docs/operations.md`.
