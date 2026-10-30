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

### Official run v0.3.0, the current result

The official run v0.3.0, under method v0.3, ran from 2026-10-29 14:41 UTC to about 02:06 UTC on 2026-10-30 (when summary.json was written; the run record has no end time) at commit 4c62325 with a clean tree.
It covered six worlds no one had looked at (seeds 2029 to 2034), the whole bank (300 instances) and the three approaches, with each question asked once: 900 answers, each judged.
The answer model was qwen3.6 and the judge gemma4 31B, both local through Ollama with reasoning off.
The settings were scorer 2.2.1, judge prompt 1.2.0, answer parser 2.1.1, an output limit of 4,096 tokens and one evidence budget of 2,000 tokens for every approach.
No answer and no judge call failed.

Method v0.3 was made after seeing the v0.2.0 result, in which the graph did not win, and this result is read with that in mind (D-093).
The guards were development on seed 2026 only, every rule written down before the official run, and worlds no one had looked at; they limit what the method could have been fitted to, and they do not remove the doubt.

The result of the 14 tests fixed before the run (Wilcoxon on group means, Holm-adjusted, a difference counts when the adjusted p-value is below 0.05):

- one comparison shows a detectable difference: on multi-hop questions, B (graph) found 22.1 evidence-recall points more than A (text search), with a 95 percent interval of 10.4 to 34.1, 72 pairs in 24 groups and a Holm-adjusted p of 0.030;
- the other 13 show no detectable difference, and that includes every test of C (graph and ontology) against B.

Five of those 13 have a 95 percent interval that leaves out zero, but the Holm-adjusted test does not pass:

- ontology-dependent questions anchored by id, C against B: evidence recall 18.9 points higher (6.2 to 33.2, Holm-adjusted p 0.38) and answer score 21.0 points higher (7.3 to 36.4, Holm-adjusted p 0.28);
- multi-hop questions, B against A: answer score 12.4 points higher (3.6 to 22.2, Holm-adjusted p 0.17);
- planted patterns, B against A: evidence recall 6.9 points lower (2.5 to 12.1 lower, Holm-adjusted p 0.23) and answer score 8.0 points lower (1.9 to 14.8 lower, Holm-adjusted p 1.0).

Here the interval and the test disagree.
The rule written before the run is the test, so these five are not findings, and they are not hidden either.

| Over every question | A: text search | B: graph | C: graph and ontology |
|---|---|---|---|
| Evidence recall (231 instances with claims) | 0.42 | 0.45 | 0.57 |
| Answer score (300 instances) | 0.58 | 0.61 | 0.67 |

These overall means are not tested.

Outside the tested family, and so descriptive only:

- on the 36 instances that name a game in a market's own language (12 groups), B found 16.7 evidence points less than A (95 percent interval 12.0 to 21.1 less), and C found 38.4 more than B (30.1 to 46.3) and answered 14.3 points better (9.2 to 18.9);
- C against A, which is never tested: 21.3 evidence points more on multi-hop questions (9.0 to 34.0) and 18.6 more on ontology-dependent questions anchored by id (4.4 to 34.1);
- single facts are near the ceiling for every approach: answer score 1.00 for A, 0.99 for B and 0.94 for C, with C 5.6 points below A (1.4 to 11.1 below);
- groundedness, the share of the ids, dates and numbers in an answer that the evidence it cites holds, is 0.87 for A, 0.94 for B and 0.92 for C, with no test run.

What this says: under these settings the graph helped get the needed evidence to the answer model on multi-hop questions, and that is the one tested finding.
C's averages were higher than B's on the questions that need the ontology, but no test of C against B passed, so this run does not show that the ontology helps.
On planted patterns the graph's averages were lower than text search's, and that did not pass the test either.

Limits on reading it:

- the judge and the deterministic answer score agree on 88 percent of the 637 answers that answered (weighted kappa 0.77) and on 70 percent of the 263 that said "unknown" (weighted kappa 0.25);
- judge prompt 1.2.0 reads the whole answer and was not checked against hand labels, and the labels that checked the earlier judge came from one model labeller, not a human (D-094, D-096);
- "the needed evidence was not retrieved" is still the most common failure cause: 124, 119 and 100 of 300 answers for A, B and C; "the evidence was retrieved but the answer was wrong" is 24, 17 and 19;
- each comparison rests on 24 question groups (48 for planted patterns), so a difference must be large to pass the test;
- one small local answer model, and each question asked once (D-097); a larger model might use the evidence differently.

The run is kept in `data/evaluation/runs/official-2026-10-29/` (not in git) and is the run the Overview and Results screens open on.
It awaits the owner's review (CP4, see `HITL_STATUS.md`).

### Official run v0.2.0, the earlier result (method 0.2.0)

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

What it said: under those settings the graph and the ontology did not measurably improve the answers.
The likely cause was evidence selection, not the graph's reach: the selection diagnostic showed the graph finding many of the needed facts and the re-ranker and the 12 prompt slots keeping most of them out, and "the needed evidence was not retrieved" was the most common failure for every approach (216, 213 and 201 of 450 answers).

Limits on reading it:

- the judge and the deterministic answer score agreed on only 53 percent of answers (kappa 0.07, by the old 0.5-threshold definition), so the two measures of a right answer often disagreed;
- each comparison rested on 12 question groups, so intervals were wide and a small effect would not be detected;
- one small local answer model; a larger model might use the evidence differently;
- 2 of 1,350 judge calls failed (both in B, while the machine slept), and no answer failed.

The run is kept in `data/evaluation/runs/official-2026-10-26/` (not in git) and stays listed on Results, labelled as the old method.

Before it, four live development runs in the Live Lab and two pilot subset runs showed B and C no better than A.
The selection rule changed after them (decision D-081, 2026-10-25), and the pilot runs described here used the older rule (D-025: all three approaches choose what the model sees through one shared re-ranker).
On the multi-hop question, B's graph search found the record that carries the claim the answer needed, and the shared re-ranker kept that record out of the prompt.

The v0.2.0 data showed that the 12 evidence slots decided what the model saw, and that two answer measures each had a specific fault.
So method v0.3 changed the method after seeing a result in which the graph did not win: the graph ranks its own records, every approach fills the same 2,000 token budget with no item limit, records are shown as compact facts with a path line for graph records, the scorer and judge are fixed, and groundedness is added (decisions D-083 to D-093).
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
