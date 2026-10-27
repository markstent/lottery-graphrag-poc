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

The official run v0.2.0 ran from 2026-10-26 11:42 to 2026-10-27 03:21 UTC at commit 27a4ce4 with a clean tree.
It covered three worlds (seeds 2026, 2027 and 2028), the whole bank (150 instances), the three approaches and three repeats: 1,350 answers, each judged.
The answer model was qwen3.6 and the judge gemma4 31B, both local through Ollama with reasoning off, under the selection rule D-081.

The result: no detectable difference between the approaches in any of the eight tested comparisons (graph against text search, and ontology against graph, on multi-hop, ontology-dependent, single-fact and planted-pattern questions; Wilcoxon, Holm-adjusted).

| Over every question | A: text search | B: graph | C: graph and ontology |
|---|---|---|---|
| Evidence score (F1, 114 instances with evidence) | 0.19 | 0.17 | 0.19 |
| Answer score (150 instances) | 0.44 | 0.44 | 0.44 |

Outside the tested family, and so descriptive only:

- on the 18 instances that name a game in a market's own language, B found 14.7 evidence points less than A (95 percent interval 10.8 to 18.6 less), and C found 13.4 more than B (8.4 to 18.6) and answered 10.4 points better (3.6 to 18.6);
- over every ontology-dependent question, C was 4.0 evidence points and 4.1 answer points above B.

What this says: under these settings the graph and the ontology did not measurably improve the answers.
The likely cause is evidence selection, not the graph's reach: the selection diagnostic showed the graph finding many of the needed facts and the re-ranker and the 12 prompt slots keeping most of them out, and "the needed evidence was not retrieved" is the most common failure for every approach (216, 213 and 201 of 450 answers).

Limits on reading it:

- the judge and the deterministic answer score agree on only 53 percent of answers (kappa 0.07, by the old 0.5-threshold definition), so the two measures of a right answer often disagree;
- each comparison rests on 12 question groups, so intervals are wide and a small effect would not be detected;
- one small local answer model; a larger model might use the evidence differently;
- 2 of 1,350 judge calls failed (both in B, while the machine slept), and no answer failed.

The run is kept in `data/evaluation/runs/official-2026-10-26/` (not in git) and is the default run on the Overview and Results screens.

Before it, four live development runs in the Live Lab and two pilot subset runs showed B and C no better than A.
The selection rule changed after them (decision D-081, 2026-10-25), and the pilot runs described here used the older rule (D-025: all three approaches choose what the model sees through one shared re-ranker).
On the multi-hop question, B's graph search found the record that carries the claim the answer needed, and the shared re-ranker kept that record out of the prompt.

Method v0.3 is the next step, and it is not yet run.
The v0.2.0 data showed that the 12 evidence slots decided what the model saw, and that two answer measures each had a specific fault.
So v0.3 changes the method after seeing a result in which the graph did not win, and every report of it says so: the graph ranks its own records, every approach fills the same 2,000 token budget with no item limit, records are shown as compact facts with a path line for graph records, the scorer and judge are fixed, and groundedness is added (decisions D-083 to D-093).
Development uses the presentation world (seed 2026) only.
The official run will use six worlds no one has looked at (seeds 2029 to 2034), and v0.3.0 will be published whatever it shows, including no difference.
The v0.2.0 result stands as published, labelled as the old method.
The reasons and the data are in [docs/evaluation/v0.3-method-proposal.md](docs/evaluation/v0.3-method-proposal.md), and the details in [docs/retrieval.md](docs/retrieval.md) and [docs/evaluation.md](docs/evaluation.md).

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
