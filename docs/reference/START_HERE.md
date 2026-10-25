# Start Here

Give the coding model this exact instruction after opening the repository:

> Read `AGENTS.md`, `MASTER_SPECIFICATION.md`, every file under `/docs`, every schema under `/schemas`, and every prompt under `/prompts` before making changes.
>
> Begin **Phase 0 only** from `docs/08-implementation-phases.md`.
>
> Bootstrap the repository structure, Python and frontend environments, linting, formatting, type checking, test frameworks, CI skeleton, `.env.example`, Makefile/task commands and Docker Compose support needed for local services.
>
> Do not implement the synthetic data model, ontology, Neo4j ingestion, RAG, GraphRAG, benchmark engine or final UI yet.
>
> When Phase 0 is complete:
> 1. run all relevant checks,
> 2. list changed files,
> 3. list commands to run locally,
> 4. report assumptions or problems,
> 5. begin Phase 1 documentation only,
> 6. stop at **HITL-01** and request explicit approval.
>
> Follow `AGENTS.md` strictly. Do not skip human approval gates.

## Project goal

Demonstrate whether adding a graph and ontology layer to an existing enterprise data architecture improves AI retrieval, contextual reasoning, cross-market understanding, evidence discovery and pattern detection.

## Experimental configurations

- A: existing data layer + conventional RAG
- B: existing data layer + graph relationships
- C: existing data layer + graph relationships + enterprise ontology

## Main UX requirement

The product must show both retrieval systems operating visually side by side, including live graph traversal driven by real backend events.


## Engineering constraint

Implement the **minimum sufficient code** needed to satisfy the approved specification and tests.

Do not over-engineer. Avoid speculative abstractions, unnecessary layers, generic frameworks, duplicate models, and unnecessary dependencies. Prefer the simplest modular design that preserves clear boundaries, testability, and maintainability.

Read the `Lean Engineering and Minimum Sufficient Code` section in `AGENTS.md` before writing application code.
