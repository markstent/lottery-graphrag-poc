# Architecture

This page describes how the system is put together: what runs where, how data and events move, and where the rules that protect the experiment are enforced.
Each subsystem has its own page for detail.
This page names those pages and does not repeat them.

| Subsystem | Page |
|---|---|
| The synthetic world and the source tables | [data.md](data.md) |
| The Neo4j overlay and the ontology | [graph-and-ontology.md](graph-and-ontology.md) |
| The planted scenarios and the truth ledger | [scenarios.md](scenarios.md) |
| Pipelines A, B and C | [retrieval.md](retrieval.md) |
| The question bank, scoring and statistics | [evaluation.md](evaluation.md) |
| Routes, events and errors | [api.md](api.md) |
| The six screens | [ux.md](ux.md) |
| Running, recovering and testing | [operations.md](operations.md) |

## Purpose

The system measures whether a knowledge graph and an enterprise ontology, added above an existing synthetic data layer, give an AI assistant better answers and better evidence.
It runs the same question through three pipelines over one synthetic world and compares them.

| Pipeline | Name on screen | What it has |
|---|---|---|
| A | Text search | Hybrid search over document chunks and serialised table rows, one shared re-ranker, one prompt |
| B | Graph | Everything A has, plus a bounded walk over relationships between records |
| C | Graph + Ontology | Everything B has, plus the ontology: concept matching, query expansion and concept-bound records |

The graph does not replace the data layer.
Numbers and facts stay in the Parquet tables, documents stay in the vector index, and Neo4j holds entities, relationships, ontology mappings and a reference back to the source row (decision D-004, ADR-001).
The experiment is not a database comparison.
It isolates what the graph layer and the ontology layer add.

What the project is not for, from the approved design ([overhaul design](superpowers/specs/2026-10-18-overhaul-design.md), section 2):

- replacing the warehouse with Neo4j;
- proving a universal result, because the claim is about this synthetic enterprise and these question types;
- mobile layouts, a general graph browser, accounts or authentication, or deployment beyond one operator's machine.

## Architecture

### Components

```text
Browser: React single-page app (Vite)
   |  REST + server-sent events, /api/v1
FastAPI process (one process, one operator)
   |-- Query service: one worker thread per run, pipelines in order A, B, C
   |-- Recording sink -> SQLite run store (runs, events, results, scores)
   |-- Benchmark jobs: one background thread, one job at a time
   |-- Lab: the shared retrieval components, built once in the background
   |       |-- Dense embeddings: Ollama (bge-m3) over HTTP
   |       |-- Sparse embeddings and re-ranker: fastembed, in process
   |       |-- Vector store: Qdrant, one collection for A, B and C
   |       |-- Source lookup and corpus: Parquet read through DuckDB
   |       |-- Graph reader: Neo4j (bolt), bounded Cypher in one module
   |       `-- Answer generator: model gateway (LiteLLM, or the deterministic stand-in)
   `-- Evaluation package: the only reader of the truth ledger
Files under data/: generated worlds, truth ledgers, frozen banks, benchmark runs, app.db
```

The services the system needs are Neo4j 5.26 Community and Qdrant 1.14.1, started by `docker-compose.yml`, and Ollama on the host for the embedding model and for local answer models.
The backend and the frontend run on the host (`make dev`).
Nothing in the application is containerised.

### Backend

The backend is one Python 3.13 package, `backend/app/`, with one module group for each responsibility.

| Module | Responsibility |
|---|---|
| `datasets/` | The deterministic world generator, schema registry, validation and Parquet writer |
| `scenarios/` | The eight scenario injectors and the writer of the truth ledger |
| `ontology/` | Ontology loader, term table and game similarity |
| `graph/` | Row builders, Cypher statements and the ingestion CLI |
| `retrieval/standard/` | Pipeline A, and the shared embeddings, search, re-ranker, context selection and generation |
| `retrieval/graph/` | Pipelines B and C: resolution, traversal, ranking and the six stages |
| `lab.py` | The one place that builds A, B and C from one configuration |
| `models/gateway.py` | The model gateway and its reachability probe |
| `events/`, `evidence/` | The typed telemetry events and the evidence records |
| `persistence/store.py` | The SQLite run store |
| `evaluation/` | The question bank, grounding, scoring, judge, statistics, report and the benchmark CLI |
| `api/` | The routes, error mapping, readiness, the graph lease and the benchmark jobs |
| `observability/logging.py` | JSON logs with run context |
| `config/__init__.py` | The one settings module |

Route handlers stay thin.
Pipelines emit typed events and know nothing about HTTP.

### The one lab

`lab.py` builds the embedding model, the vector store, the corpus, the source lookup, the re-ranker, the ontology and the three pipelines from one configuration.
The API, the benchmark runner and the trace command all use it, so they run the same retrieval.
A test pins that B is C minus the ontology layer, and that A, B and C share the same embedder, store, re-ranker, generator and source lookup instances (`backend/tests/test_lab_fairness.py`).
The fairness contract is in [retrieval.md](retrieval.md).

The API builds the lab in a background thread at start-up.
No route waits for it.
A run started meanwhile waits for it, and a failed build is retried by the next run (D-038).

### Model gateway

All answer generation and all judge calls go through one function, `complete` in `backend/app/models/gateway.py`, so every request carries the same parameters and fails the same way (ADR-003, D-010).
Two providers are configured by environment:

- `fake`: a deterministic generator for CI and tests, which builds a structured answer from the context titles;
- `litellm`: LiteLLM, which reaches Ollama for local models and OpenRouter for hosted ones.

The embedding model is the exception.
It calls Ollama over `httpx` (or the deterministic hashing embedder in CI) and does not go through LiteLLM.
Sparse embeddings and the re-ranker run in process through fastembed (D-021).
The API loads LiteLLM once at start-up when `GENERATION_PROVIDER=litellm`, before any run thread exists (D-059).
The model is chosen by configuration and is not named in application logic.
The model never reasons in view: the UI shows recorded events only.

### Events and replay

Each pipeline emits typed events into a sink.
For a live run the sink writes every event to the run store the moment it is emitted, and the stream route reads the same stored events.
A replay reads the stored sequence and never re-runs retrieval (ADR-004, ADR-007).
The envelope has eight fields and is identical in replay and in the stream (D-034).
The event names and payloads are in [api.md](api.md).

The frontend draws the graph, the panels and the timeline from these events and keeps no retrieval state of its own.
That is the rule that keeps the animation honest: a node or an edge appears only because an event recorded it.

### Persistence

| Concern | Store | Location |
|---|---|---|
| Structured facts, authoritative | Parquet, read with DuckDB | `data/generated/<profile>-seed<seed>/` |
| Documents and chunks | Parquet | the same directory |
| Dense and sparse vectors | Qdrant collection | the Compose volume |
| Entities, relationships, ontology, provenance | Neo4j | the Compose volume |
| Runs, events, results, live scores | SQLite, WAL mode | `data/app.db` (`APP_DB_PATH`) |
| Truth ledger, evaluator only | JSON | `data/truth/` |
| Frozen question banks | JSON | `data/evaluation/bank/` |
| Benchmark runs | JSON and Markdown | `data/evaluation/runs/<run id>/` |

`data/` is not committed.
Worlds are reproduced from seeds and configuration, not from stored files.

The SQLite store has four tables (`runs`, `events`, `results`, `scores`) at schema version 1.
Each thread has its own connection, and every write runs in a `BEGIN IMMEDIATE` transaction, so an event's sequence number is assigned and stored in one step (D-033, ADR-007).
The store keeps the newest `RUN_RETENTION` finished live runs (500 by default) and never prunes a queued or running run.
At start-up, every run left queued or running is marked failed with `INTERRUPTED`.
Two API processes on one database are not supported.

### Run flow

1. `POST /api/v1/queries` validates the request, stores a queued run and starts one worker thread.
2. The worker takes a lease on the graph, runs the requested pipelines in order A, B, C, and stores each result as soon as that pipeline finishes.
3. Every event goes through the recording sink into the store.
   Between events the worker checks a cancel flag, so a pipeline stops at its next emitted event (D-034).
4. The worker stores the terminal event (`run.completed`, `run.failed` or `run.cancelled`) before the final row, so a client that sees the final status finds every event.
5. A bank question is then scored with the benchmark runner's deterministic scorer, and the score is stored (D-035).
   No judge runs live.
6. The client follows the run over server-sent events, or reads it afterwards from the store.

### The graph lease

Live runs and benchmark jobs share one Neo4j.
A benchmark job ingests other worlds into it, so the two must not overlap.
Any number of live runs may hold the lease together, or one benchmark job may hold it, never both.
Each side is refused with a retryable 409 while the other holds it (D-037).
Which world the graph holds is checked by comparing the node count of every label with the active dataset's `_graph_stats.json`.
Equal counts are a fingerprint, not a proof.

## Security and isolation

All data is synthetic.
The system has no accounts and no authentication, and it is meant to run on one operator's machine.

- Secrets come from environment variables and are never committed.
  Log fields whose names suggest a secret are redacted.
- Cypher is static and parameterised, and it all lives in `backend/app/graph/statements.py` and the `cypher/` folder beside it.
  Labels and relationship types come from fixed registries, never from user text.
- Graph traversal is bounded by depth, nodes per hop, edges per node type and total nodes.
  Every Neo4j read in the API is one statement under `NEO4J_TIMEOUT_S`.
- The Data Model routes check every table and column name against the schema registry before it reaches SQL, and bind every value as a parameter.
- No route returns a stack trace or a library's message.
  Each error code has one curated sentence, and the exception text goes to the log only.
- CORS allows the configured origins, the methods GET and POST, and three request headers.

### Truth-ledger isolation

The truth ledger exists only for evaluation (ADR-008).
It is written once per generation to `data/truth/` and is read back only inside `app/evaluation/`.
Retrieval code never imports or queries it, and no live route, event or log record carries an expected answer or a hidden truth.
Tests enforce the boundary:

- a static scan of every module in `retrieval`, `api`, `datasets`, `graph`, `ontology`, `scenarios`, `config`, `events`, `observability`, `persistence`, `models` and `lab.py` for imports of `app.evaluation` and for the ledger path, with the two API modules below as the only exceptions;
- only `app/api/benchmarks.py` and `app/api/scoring.py` may import `app.evaluation`, and they reach the ledger only through evaluator functions (D-035);
- the ontology package imports nothing from the bank or the scenarios;
- a subprocess test imports the lab and every retrieval module in a fresh interpreter and asserts that no evaluation module was loaded;
- a test that the generated manifest carries no ledger fields (four marker words are absent, and only planted row counts appear).
  It does not scan Parquet values, vector payloads, graph properties or run-store rows, although ADR-008 describes such a test.

The Help screen shows each question's answer key and each planted scenario's hidden truth.
Both are evaluator output served after the fact by `GET /api/v1/benchmarks/questions`, which is the one route that serves them (owner decision of 2026-10-18).
The trace command is the one operator tool outside the runtime rule, by choice, as ADR-008 records.

## Frontend

The frontend is a React 19 and TypeScript single-page app, built with Vite 8 and Tailwind CSS 4, in `frontend/`.
TypeScript runs in strict mode.
Its layers are kept apart:

| Folder | Holds |
|---|---|
| `src/api/` | The typed client, the error type and the event-stream subscription. Types are generated from the committed OpenAPI file (D-042). |
| `src/app/` | The shell, the hash router (six destinations), settings, presentation mode and the readiness poll |
| `src/run/` | The run reducer, the replay clock, the recorded runs, the step lanes and the market coverage rule |
| `src/graph/` | The graph view model, layout, canvas and the textual path list |
| `src/results/` | Run, question and start-form logic for Results |
| `src/charts/` | Chart primitives drawn in plain SVG (D-039) |
| `src/components/` | Panel, drawer, evidence drawer and flow diagram |
| `src/screens/` | One folder for each screen. A test forbids imports between screens. |
| `src/design/`, `src/copy/` | Design tokens, evidence-state design, glossary and the copy budget |

Scoring and statistics are never computed in the frontend.
Every number comes from the API: a run summary, an instance score or a stored result.
Routing is a hand-written hash router, so every screen and tab is a link (D-008).
The frontend never calls Neo4j, Qdrant or a model directly.

Frontend dependencies are pinned, and a test checks the pinning.
The notable ones are `@xyflow/react` and `elkjs` for the graph canvas (D-043), `lucide-react` for icons (D-040) and `@fontsource-variable/inter` for type (D-041).
Screens, states and accessibility are in [ux.md](ux.md).

## Configuration

Settings are read from the process environment only.
The Python code loads no `.env` file itself.
The Makefile reads a root `.env` and exports it to every target, and `.env.example` lists every variable with its default.
A process started outside `make` needs the variables exported in its shell.
The settings module is `backend/app/config/__init__.py`.
Retrieval, model and traversal settings are read when the lab is built.
The API settings (`CORS_ORIGINS`, `APP_DB_PATH`, `RUN_RETENTION`, `SSE_HEARTBEAT_S`, `BENCHMARK_DIR`, `LOG_LEVEL`) are read once, when the app is created, and need a restart to change.
Invalid values raise a `ValueError` that names the variable.
The full list with meanings is in [operations.md](operations.md).

## Observability

Logs are JSON, one handler on the root logger.
Run identifiers are bound through context variables and copied onto every record, so a request id, a run id and a pipeline id appear without being repeated at each call.
The stage names that carry timings are `embedding`, `vector_retrieval`, `graph_traversal`, `reranking`, `context_building`, `generation`, `evaluation` and `pipeline_run`.
Every response carries `X-Request-ID`, either the client's value (1 to 64 letters, digits or hyphens) or a generated one.
Logs never carry an expected answer, a generated answer in the benchmark runner, or a secret.

## Testing

The test strategy and the commands are in [operations.md](operations.md).
The architecture is protected by these tests in particular:

- `test_lab_fairness.py` for the A, B and C contract;
- `test_truth_ledger_isolation.py` for the ledger boundary;
- `test_openapi_contract.py` and `pnpm api:check` for the API contract;
- `test_docs_links.py` for the documents.

## Extension points

- A new market-local code needs an entry in `datasets/taxonomies.py` and a binding in `schemas/ontology/ontology.yaml`.
- A new scenario needs an injector registered in `scenarios/plant.py` and an entry set to enabled in `scenarios/catalogue.py`.
  Seven catalogue entries exist and are disabled.
- A new generation or judge model is a change of environment variables, not of code.
- A new route needs a typed response model, and then `make api-contract`.
- A change to how pipelines select evidence is a method change and needs owner approval before an official run (see [retrieval.md](retrieval.md)).

## Failure modes

| Failure | What happens |
|---|---|
| Neo4j unreachable | B and C record a `GRAPH_QUERY_ERROR`, and A keeps its result. Readiness reports the graph check failed. |
| Graph holds another world | A run of B or C is refused with a 503 `CONFIGURATION_ERROR`. Run `make ingest-graph`. |
| Qdrant or embedding model unreachable | The run fails with `VECTOR_RETRIEVAL_ERROR` or `EMBEDDING_ERROR`. No answer is faked. |
| Model unreachable or empty answer | The run fails with `MODEL_ERROR`. In a benchmark, that repeat has no score and is left out. |
| Server stops during a run | The next start-up marks the run failed with `INTERRUPTED`. |
| Benchmark job running | A live run is refused with a retryable 409 until the job ends. |
| Stored event no longer validates | Replay answers 500 `RUN_ERROR`, because an older version stored it. |

## Decisions

The architecture decision records are archived under [reference/architecture/adr/](reference/architecture/adr/ADR-001-neo4j-overlay.md), with the rulings made since in [DECISIONS.md](../DECISIONS.md).
ADR-006 to ADR-009 are recorded as accepted at HITL-02 in [HITL_STATUS.md](../HITL_STATUS.md).
The others were part of the same architecture package.

| ADR | Decision | Where the code differs from the text |
|---|---|---|
| [ADR-001](reference/architecture/adr/ADR-001-neo4j-overlay.md) | Neo4j augments the data layer | None |
| [ADR-002](reference/architecture/adr/ADR-002-shared-vector-layer.md) | One shared vector layer for A, B and C | None |
| [ADR-003](reference/architecture/adr/ADR-003-litellm.md) | A LiteLLM-compatible model gateway | Embeddings bypass the gateway and call Ollama directly (D-010) |
| [ADR-004](reference/architecture/adr/ADR-004-sse.md) | Server-sent events for telemetry | None |
| [ADR-005](reference/architecture/adr/ADR-005-graph-visualisation.md) | A dedicated 2D graph library | The library is React Flow with elkjs layout (D-043) |
| [ADR-006](reference/architecture/adr/ADR-006-structured-data-layer.md) | Parquet read with DuckDB | Pipeline A does not run SQL at query time. Table rows are serialised once into the vector index. |
| [ADR-007](reference/architecture/adr/ADR-007-run-persistence.md) | SQLite for runs, events, results and scores | None |
| [ADR-008](reference/architecture/adr/ADR-008-truth-ledger-isolation.md) | The truth ledger is readable by evaluation only | None |
| [ADR-009](reference/architecture/adr/ADR-009-tooling-and-layout.md) | uv, pnpm, one backend package | None |

Engineering rules for contributors, including lean code, typed boundaries and no speculative abstraction, are in [AGENTS.md](../AGENTS.md).
