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

Then open `http://localhost:5173`. Live Lab starts on the committed demo
story (offline-safe); switch the composer to "Live backend" to execute real
A/B/C runs against the demo world. Development data and tests:

```bash
make generate-dev-data  # development dataset
make ingest-graph       # development world into Neo4j
make index-vector       # development document index into Qdrant
make test               # backend + frontend unit tests
make run-benchmark      # the evaluation harness
```

Presentation run-of-show and recovery procedures:
`docs/demo/presentation.md`. Release record: `RELEASE.md`.
