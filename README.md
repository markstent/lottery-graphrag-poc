# Semantic Context Lab

A synthetic experiment that measures what a knowledge graph and an enterprise ontology add when they sit above an existing enterprise data layer.

The graph does not replace the data layer.
It makes relationships and enterprise meaning available to AI.

The synthetic organisation is a multinational lottery operator in the United Kingdom, Greece, Austria and the Czech Republic.
All data, brands, products, people, incidents, documents and systems are synthetic.

## What it compares

Three approaches answer the same question over the same synthetic world, the same documents, the same embedding model and the same answer model.

| Approach | What it adds |
|---|---|
| A | The existing data layer with conventional retrieval-augmented generation (RAG) |
| B | A, plus graph relationships |
| C | B, plus the enterprise ontology |

The experiment isolates the value of the graph and of the ontology.
It is not a comparison of databases.
Fairness rules and the shared context budget are in [docs/retrieval.md](docs/retrieval.md).

## Headline numbers

There is no official run yet, so there are no official numbers.
The official run follows checkpoint CP3 and waits for the project owner.

Four live development runs have been recorded in the Live Lab.
They used one question each from the strata H1 (multi-hop), H2 (ontology-dependent), H3 (single fact) and H5 (planted pattern), with the answer model qwen3.6 through Ollama on the seed 2026 development world, and one repeat each.
They showed B and C no better than A.
B and C were level with A on three of the four questions.
On the ontology question B and C wrote a slightly better answer and found less of the needed evidence.

The selection rule has changed since those runs (decision D-081, 2026-10-25, after the CP3 proposal).
Decision D-025 had made all three approaches choose what the model sees through one shared re-ranker.
On the multi-hop question, B's graph search found the record that carries the claim the answer needed, and the shared re-ranker kept that record out of the prompt.
Now half of the 12 evidence slots go to the graph's own selection in B and C, and A keeps all 12 for documents.
The pilot runs described here used the old rule.
The detail is in [docs/retrieval.md](docs/retrieval.md) and [docs/evaluation.md](docs/evaluation.md).

## Run it

Requirements are Python 3.13 with `uv`, Node 24 with `pnpm`, Docker for Neo4j and Qdrant, and Ollama for the embedding model and local answer models.
Settings go in a root `.env` (copy `.env.example`), which `make` reads.

```bash
make setup               # Python, frontend and Playwright dependencies
make services-up         # Neo4j and Qdrant
make pull-models         # the embedding model, with Ollama running
make generate-dev-data   # the synthetic world
make ingest-graph        # the graph, in Neo4j
make index-vector        # the document index, in Qdrant
make ground-bank         # freeze the question bank into this world
make dev                 # API on :8000 and the screens on :5173
```

Open `http://localhost:5173`.
A fresh clone has no `data/` directory, so generate the world first.
The demonstration targets, recovery steps and every setting are in [docs/operations.md](docs/operations.md).

The product has five screens, and each is a link:

| Screen | Link | What it is for |
|---|---|---|
| Overview | `http://localhost:5173/#/overview` | The verdict from the latest official run, how the approaches differ, and a way into Live Lab |
| Live Lab | `http://localhost:5173/#/live-lab` | Run one question through A, B and C and watch them work |
| Results | `http://localhost:5173/#/results` | Published benchmark runs with their scores, questions and reproducibility record, and a form to start a run |
| Data Model | `http://localhost:5173/#/data-model` | The warehouse, graph, ontology and scenarios, with live counts |
| Help | `http://localhost:5173/#/help` | How it works, every benchmark question with its answer key, the glossary and how to run it |

Live Lab can replay a recorded run, which needs no model, or run a question live, which needs the services, the vector index, the graph and the answer model.
Add `?present=1` to the address, or use the header button, for presentation mode.

Tests, without services or a model:

```bash
make test
```

## Map of the documents

Ten primary documents hold the current truth.

| Document | Holds |
|---|---|
| `README.md` | This page |
| [docs/architecture.md](docs/architecture.md) | System, backend, frontend, model gateway, events, persistence, security, decision index |
| [docs/data.md](docs/data.md) | The synthetic world, the warehouse, documents and provenance |
| [docs/graph-and-ontology.md](docs/graph-and-ontology.md) | The graph model, ingestion, the ontology and cross-market mappings |
| [docs/scenarios.md](docs/scenarios.md) | The eight planted scenarios and the truth ledger |
| [docs/retrieval.md](docs/retrieval.md) | Pipelines A, B and C, the fairness contract, the context budget and re-ranking |
| [docs/evaluation.md](docs/evaluation.md) | The question bank, scoring, the judge, statistics and reproducibility |
| [docs/api.md](docs/api.md) | Routes, events and errors |
| [docs/ux.md](docs/ux.md) | Screens, visual language, interaction, accessibility and presentation mode |
| [docs/operations.md](docs/operations.md) | Running, models, the demonstration, recovery, troubleshooting, testing and CI |

The generated question bank is `docs/evaluation/question-bank.md`.

Governance files stay at the repository root:

- `AGENTS.md`: the rules for working in this repository, including the human approval checkpoints
- `HITL_STATUS.md`: the status of each gate and checkpoint
- `DECISIONS.md`: the numbered decisions and who approved them
- `CHANGELOG.md`: generated release notes
- `CONTRIBUTING.md`: how to contribute
- `RELEASE.md`: the release record

`docs/superpowers/` holds the overhaul design and the implementation plans.
`docs/reference/` is an archive of the documents written before and during the build, kept unchanged, with a note on which primary document replaced each file.
