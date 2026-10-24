# Semantic Context Lab

A specification-driven POC for measuring the value of adding a Neo4j knowledge graph and enterprise ontology above an existing synthetic enterprise data layer.

## Core thesis

> The graph does not replace the data layer. It makes relationships and enterprise meaning available to AI.

The synthetic organisation operates across:

- United Kingdom
- Greece
- Austria
- Czech Republic

All data, brands, products, people, incidents, documents and systems are synthetic.

## Start here

1. Read `START_HERE.md`.
2. Read `AGENTS.md`.
3. Read `MASTER_SPECIFICATION.md`.
4. Read all files under `/docs`.
5. Begin Phase 0 only.
6. Stop at every human-in-the-loop checkpoint.

## Never use

- the real employer/company name
- the word `Atlas` as any project, platform, system, environment, database, codename or synthetic organisation name

## Repository philosophy

This project is built from specifications first. Code must conform to the specifications and approved HITL decisions.

## Run the demo

```bash
make services-up      # Neo4j + Qdrant (Docker/OrbStack)
make demo-reset       # ingest the demo graph + rebuild the demo vector index
make serve-demo-api   # API on :8000 against the demo world
make dev-frontend     # UI on :5173
```

Then open `http://localhost:5173`.
The product has five screens, and each is a link:

| Screen | Link | What it is for |
|---|---|---|
| Overview | `http://localhost:5173/#/overview` | The verdict from the latest official run, how the approaches differ, and a way into Live Lab |
| Live Lab | `http://localhost:5173/#/live-lab` | Run one question through A, B and C and watch them work |
| Results | `http://localhost:5173/#/results` | The published benchmark runs (a stopgap list until Phase 7) |
| Data Model | `http://localhost:5173/#/data-model` | The warehouse, graph, ontology and scenarios, with live counts. Tabs are `?tab=warehouse`, `?tab=graph`, `?tab=ontology` and `?tab=scenarios` |
| Help | `http://localhost:5173/#/help` | How it works, every benchmark question with its answer key, the glossary and how to run it. Sections are `?section=what`, `approaches`, `data`, `stories`, `questions`, `scoring`, `glossary` and `running` |

Live Lab opens on a question bar.
Choose one of the four saved questions and the source "Recorded run" to replay a real captured run, which needs no model.
Choose "Live" to run it for real against the world the API serves.
That needs the services, the vector index, the graph and the answer model to be ready, and the model status in the header says whether they are.
Add `?present=1` to the address, or use the header button, for presentation mode.

To run the live end-to-end spec against the real backend and the dev world, start the backend and then run the spec.
It never runs in CI, and it skips unless `LIVE_WORLD_E2E=1` is set:

```bash
cd backend && GENERATION_PROVIDER=fake uv run uvicorn app.main:app --port 8000
cd frontend && LIVE_WORLD_E2E=1 node node_modules/@playwright/test/cli.js test e2e/live-lab-live.spec.ts
```

The run is real (embedding, search and graph traversal happen) and the graph is only read.

Development data and tests:

```bash
make generate-dev-data  # development dataset
make ingest-graph       # development world into Neo4j
make index-vector       # development document index into Qdrant
make test               # backend + frontend unit tests
make run-benchmark      # the evaluation harness
```

Presentation run-of-show and recovery procedures:
`docs/demo/presentation.md`. Release record: `RELEASE.md`.
