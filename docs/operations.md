# Operations

This page describes how to set the system up, run it, change its models, prepare and recover a demonstration, and test it.
It names every command and every environment variable.
The subsystems behind them are in [architecture.md](architecture.md), [data.md](data.md), [graph-and-ontology.md](graph-and-ontology.md), [retrieval.md](retrieval.md) and [evaluation.md](evaluation.md).

## Purpose

One operator runs the whole system on one machine: the backend and the frontend on the host, Neo4j and Qdrant in Docker, and Ollama on the host for local models.
Nothing in the application is containerised.
Everything is synthetic, and nothing leaves the machine unless a hosted model is configured.

## Setup

Requirements: Python 3.13 with `uv`, Node 24 with `pnpm` 12, Docker (or OrbStack) for the two services, and Ollama for the embedding model and local answer models.

```bash
make setup           # uv sync, pnpm install, Playwright's Chromium
make services-up     # Neo4j 5.26 Community and Qdrant 1.14.1, with pinned images
make pull-models     # pulls bge-m3 into Ollama (Ollama must be running)
```

On a fresh clone there is no `data/` directory.
Generate the world before anything live runs.
Offline tests need neither data nor services, because they build a tiny world in a temporary directory.

**Environment.**
The backend reads settings from the process environment only.
The Makefile reads a root `.env` when it exists (it is git-ignored), so copy `.env.example` to `.env` and change what you need, and every `make` target sees it.
Write `KEY=value` with no quotes, because make reads the file and expands a `$` in a value.
Make also treats `#` as the start of a comment, so a value containing `#` is cut there without a warning.
A key left empty is exported as an empty string, and a few settings treat that differently from unset, so delete a line to get its default.
A process started without `make` (for example `uv run uvicorn` directly) needs the variables exported in its shell.
The demo targets set `DATASET_DIR`, `TRUTH_LEDGER_PATH` and `QDRANT_COLLECTION` on the command line, which wins over `.env`.

**Machine notes** recorded on the owner's Mac on 2026-10-18 and 2026-10-19, which may not hold now:

- The Homebrew `pnpm` shim could not find its script.
  The working form was `node ~/.cache/node/corepack/v1/pnpm/12.14.0/bin/pnpm.mjs <script>`, run inside `frontend/`.
- The Docker daemon was not running by default (`open -a Docker`).
- Ollama held `qwen3.6:latest`, `qwen3.6:35b-mlx`, `gemma4:31b`, `llama4:scout` and `bge-m3`.

## Run the system

The first start and each new world need these steps, in this order:

```bash
make generate-dev-data      # the world -> data/generated/dev-seed2026/
make ingest-graph           # Neo4j, wiping it first
make index-vector           # Qdrant, with Ollama and bge-m3
make ground-bank            # freeze the question bank into this world
make dev-backend            # API on :8000
make dev-frontend           # the screens on :5173
make dev                    # the last two together
```

Open `http://localhost:5173`.
The frontend calls relative `/api` paths, and both the Vite dev server and `vite preview` forward them to `localhost:8000` (`frontend/vite.config.ts`), so the API must be on port 8000.

The API builds its retrieval lab in the background at start-up.
The first build loads the sparse model and the re-ranker, and the re-ranker downloads about 2.3 GB on first use into `FASTEMBED_CACHE`.
Until the lab is built, the model status in the header reads Starting and Live is disabled.

Check the whole system at any time with `GET /api/v1/health/ready` (see [api.md](api.md)).
It reports five checks: `lab`, `index`, `graph`, `model` and `embedding`.

### Demo world

The demo world is the same generator at the demo profile (100,000 players, 5,000,000 tickets) with its own ledger, graph load and Qdrant collection.
The separate state means development and demo never overwrite each other.

```bash
make generate-demo-data     # once
make demo-reset             # ingest the demo graph and rebuild the demo vector index
make ground-demo-bank       # freeze the bank for the demo world
make serve-demo-api         # API on :8000 against the demo world
```

`make demo-reset` runs `ingest-demo-graph` and `index-demo-vector`.
The demo environment sets `DATASET_DIR=../data/generated/demo-seed2026`, `TRUTH_LEDGER_PATH=../data/truth/ledger-demo.json` and `QDRANT_COLLECTION=semantic_context_lab_demo`.
Neo4j holds one world at a time, so after a demo reset the development API reports that the graph holds another world, and the reverse.
Return to development with `make ingest-graph` and `make index-vector`.
The benchmark cannot run in the demo environment (see [evaluation.md](evaluation.md)).

Which world is the presentation world is an open owner question.
It is defined by `DATASET_DIR`, which defaults to the dev world, and the four recorded runs were captured on the dev world.

## Models

All model access goes through the gateway (see [architecture.md](architecture.md)).
Local and hosted models are chosen by environment, and no model is named in application code.

| Role | Variables | Notes |
|---|---|---|
| Dense embedding | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `OLLAMA_HOST` | `bge-m3` through Ollama. `hashing` is the CI model. |
| Sparse and re-ranker | `SPARSE_*`, `RERANK_*`, `FASTEMBED_CACHE` | Run in process. They download on first use. |
| Answer generation | `GENERATION_*` | `fake` is the deterministic CI generator. `litellm` reaches Ollama or OpenRouter. |
| Benchmark judge | `JUDGE_*` | Smoke runs always use the fake judge. A sweep or official run needs `litellm` and a model of another family than the generator. |

**Local answer model.**

```bash
export GENERATION_PROVIDER=litellm GENERATION_MODEL=ollama/qwen3.6:latest
export GENERATION_API_BASE=http://localhost:11434 GENERATION_REASONING=off
make serve-demo-api
```

The four recorded runs used `ollama/qwen3.6:latest` with reasoning off.
A thinking model left on `default` can spend its whole token cap thinking and return an empty answer, which the gateway reports as an error.
`off` is sent as `think=false` for `ollama/` and `ollama_chat/` models and as `reasoning.enabled=false` for `openrouter/` models.
Settings refuse `off` for any other provider prefix, for the generator and the judge alike.
If a model reports reasoning tokens although reasoning is off, the call fails and names the model.

**Hosted model.**
Set `GENERATION_MODEL` to an `openrouter/...` model and `OPENROUTER_API_KEY` in the environment.
Never commit a key or write it to a log.

**Official run.**
The generation model and the judge for the official run are chosen at CP3, with an estimated cost and duration.
An official run requires `GENERATION_MODEL_FAMILY`, `JUDGE_MODEL_FAMILY` (different), `GENERATION_PROVIDER=litellm` and `JUDGE_PROVIDER=litellm`.

**A failed official run.**
Each finished world is kept in `worlds/<seed>.json` inside the run directory, so a failure in world 3 does not lose worlds 1 and 2.
Nothing is published until the whole run finishes.
Continue it with `make run-benchmark OUT=data/evaluation/runs/<run id> RESUME=1`, with the same model, judge and options.
`OUT` is relative to the repository root, and the directory must exist.
Resume refuses any setting that differs from the kept worlds and says which (see [evaluation.md](evaluation.md)).
An official run resumes only from a clean checkout at the same revision, so any code change, committed or not, means a new run rather than a resume.
A job started from the API never resumes; its failure message names the command to run.

## Command reference

| Command | What it does |
|---|---|
| `make help` | Lists the targets |
| `make setup` | Installs Python, frontend and Playwright dependencies |
| `make dev`, `dev-backend`, `dev-frontend` | Runs the API, the screens, or both |
| `make test` | Backend and frontend unit tests, offline |
| `make test-graph` | The live graph tests. They wipe Neo4j. |
| `make lint`, `make typecheck`, `make format` | ruff and oxlint, mypy and tsc, ruff and Prettier |
| `make build` | The frontend production bundle |
| `make api-contract` | Exports the OpenAPI file and regenerates the frontend types |
| `make e2e` | Builds the frontend and runs the Playwright specs |
| `make services-up`, `services-down` | Starts or stops Neo4j and Qdrant |
| `make pull-models` | Pulls `bge-m3` |
| `make generate-dev-data`, `generate-demo-data` | Generates a world |
| `make ingest-graph`, `ingest-demo-graph` | Loads a world into Neo4j |
| `make index-vector`, `index-demo-vector` | Builds the vector index |
| `make ground-bank`, `ground-demo-bank` | Freezes the question bank into a world |
| `make demo-reset` | The demo graph load and index build |
| `make serve-demo-api` | Serves the API against the demo world |
| `make traces` | Writes the side-by-side example traces (needs the dev graph, index and bank) |
| `make dry-run` | Four-question dry run of the official settings; it wipes and restores the graph, and needs owner approval first |
| `make run-smoke`, `run-benchmark`, `run-sweep` | The benchmark runs (see [evaluation.md](evaluation.md)) |

The Makefile is the stable command surface.

## Recovery and troubleshooting

Do not fake success while a service is down.
The product shows the failed check and its plain reason.

| Symptom | Cause | Fix |
|---|---|---|
| Header says Not ready | A readiness check failed | Open the model status list. It names the check. |
| Live is disabled, "The backend is still starting." | The lab is building | Wait. The first build is slow. |
| Graph check: "the graph holds another world" | A benchmark, a live test or a demo reset loaded another world | `make ingest-graph` (or `make ingest-demo-graph`) |
| Graph check: "a benchmark run is using the graph" | A benchmark job holds the lease | Wait for it, or cancel it from Results. |
| Index check fails, or text search finds nothing | The index is missing, dense-only, or built by another serialiser version | `make index-vector` |
| Embedding model not listed | Ollama is not running or the model is not pulled | Start Ollama, then `make pull-models` |
| Answer model not listed or unreachable | The model is not pulled, or the provider is down | `ollama pull <model>`, or fix `GENERATION_API_BASE` |
| A run fails with `MODEL_ERROR` | The gateway call failed or returned nothing | Check the model. A thinking model needs `GENERATION_REASONING=off`. A failure naming reasoning tokens means the provider ignored `off`; use another model. |
| 503 "the question bank has not been grounded" | No frozen bank for this world | `make ground-bank` (`make ground-demo-bank` for the demo world) |
| 503 "the question bank does not match the active world" | The world, ledger or serialiser changed since grounding | Re-run the grounding command. |
| 409 "a benchmark run is using the graph" | A job is running | Retry when it ends. |
| Server stopped during a benchmark job | Jobs are in memory, and Neo4j may hold a benchmark world | `make ingest-graph`, then check readiness |
| A run shows `INTERRUPTED` | The server stopped during it | Start it again. Nothing was lost beyond that run. |
| The API refuses to start with a message naming a variable | An invalid setting | Fix the variable. |
| The run store is refused | `data/app.db` has a newer schema version than the code | Use matching code, or move the file aside. |
| Stream cuts out through a proxy | The proxy buffers server-sent events | Connect directly to localhost. Heartbeats keep the connection warm. |
| Graph looks wrong after live tests | A `GRAPH_E2E` test wiped and reloaded Neo4j | `make ingest-graph`. After each live test module a fixture restores the presentation world when its stats file exists. |

Reset the demonstration: `make demo-reset`, then restart the API.
The committed generator is deterministic, so a lost world is regenerated byte-identically from its seeds.
Do not clear a running run by editing the database.
Cancel it from the screen, or stop the server, and the next start-up marks it interrupted.

## Configuration reference

Every variable below is read from the process environment.
`.env.example` has the same list with comments.
A key shown commented in that file must stay unset, not empty, to get its default.

| Group | Variable | Default |
|---|---|---|
| Hosted models | `OPENROUTER_API_KEY` | unset |
| Neo4j | `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`, `NEO4J_TIMEOUT_S` | `bolt://localhost:7687`, `neo4j`, `devpassword`, `neo4j`, 10 |
| Qdrant | `QDRANT_URL`, `QDRANT_COLLECTION` | `http://localhost:6333`, `semantic_context_lab` |
| World | `DATASET_DIR`, `TRUTH_LEDGER_PATH` | `data/generated/dev-seed2026`, `data/truth/ledger.json` |
| Embeddings | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `OLLAMA_HOST` | `ollama`, `bge-m3`, 1024, `http://localhost:11434` |
| Sparse | `SPARSE_PROVIDER`, `SPARSE_MODEL`, `FASTEMBED_CACHE` | unset, `Qdrant/bm25`, `~/.cache/fastembed` |
| Retrieval | `RAG_TOP_K`, `RAG_CONTEXT_TOKEN_BUDGET`, `RAG_EVIDENCE_SLOTS`, `RAG_GRAPH_SLOTS`, `RAG_DEDUPE_THRESHOLD` | 40, 2000, 12, 6, 0.85 |
| Re-ranker | `RERANK_PROVIDER`, `RERANK_MODEL` | `cross_encoder`, `BAAI/bge-reranker-v2-m3` |
| Generation | `GENERATION_PROVIDER`, `GENERATION_MODEL`, `GENERATION_TEMPERATURE`, `GENERATION_API_BASE`, `GENERATION_MAX_TOKENS`, `GENERATION_TIMEOUT_S`, `GENERATION_MODEL_FAMILY`, `GENERATION_MODEL_QUANTISATION`, `GENERATION_REASONING` | `fake`, `fake-answer-v1`, 0, unset, 1200, 120, unset, unset, `default` |
| Judge | `JUDGE_PROVIDER`, `JUDGE_MODEL`, `JUDGE_MODEL_FAMILY`, `JUDGE_API_BASE`, `JUDGE_TEMPERATURE`, `JUDGE_REASONING` | `fake`, `fake-judge-v1`, unset, unset, 0, `default` |
| Graph | `GRAPH_DEPTH`, `GRAPH_MAX_NODES_PER_HOP`, `GRAPH_MAX_EDGES_PER_NODE_TYPE`, `GRAPH_MAX_TOTAL_NODES`, `GRAPH_REFERENCE_DATE` | 2, 100, 4, 200, end of the dataset window |
| API | `CORS_ORIGINS`, `BENCHMARK_DIR`, `APP_DB_PATH`, `RUN_RETENTION`, `SSE_HEARTBEAT_S`, `LOG_LEVEL` | the two `localhost:5173` and `127.0.0.1:5173` origins, `data/evaluation/runs`, `data/app.db`, 500, 15, `INFO` |
| Test flags | `GRAPH_E2E`, `VECTOR_E2E`, `LIVE_WORLD_E2E` | unset. `make test` runs pytest with `GRAPH_E2E` unset even when `.env` sets it, so the live graph tests, which wipe Neo4j, run only through `make test-graph`. |

The API settings in the last two groups are read once when the app is created, and a change needs a restart.
`.env.example` sets `RERANK_PROVIDER=cross_encoder` explicitly, although its own comment says an unset value means the lexical judge under the hashing embedder.
Exporting the whole file in a hashing setup therefore keeps the cross-encoder.
`docker-compose.yml` reads `NEO4J_PASSWORD` (default `devpassword`), so a changed password set in `.env` reaches `make services-up` and every other `make` target.
A process started without `make` needs it exported.

## Testing and CI

### Gates

Run these from `backend/` before a commit:

```bash
uv run ruff format .
uv run ruff check .
uv run mypy                # strict, covers app, scripts and tests
uv run pytest              # warnings are errors
```

And from `frontend/`, through `pnpm` (or the `node` form above):

```bash
pnpm format:check
pnpm lint                  # oxlint
pnpm typecheck             # tsc, strict
pnpm api:check             # generated types match openapi.json
pnpm test                  # Vitest
pnpm build
```

The suite at the time of writing: 1,208 backend tests are collected (live ones skip without their flag), 86 frontend test files, ten Playwright spec files and 126 visual baselines.
`test_docs_links.py` fails on a broken relative Markdown link outside the archive, and on any file that still names a document at the path it had before it moved into `docs/reference/`.
A test renders the question bank page from a tiny world and checks that it lists every question and instance.
The committed generated pages are not compared with the data.

### Layers

| Layer | Where | What |
|---|---|---|
| Static checks | local and CI | ruff, mypy, Prettier, oxlint, tsc |
| Unit and component | local and CI | Backend pytest, frontend Vitest with Testing Library |
| Contract | local and CI | The OpenAPI drift checks on both sides |
| Integration, live services | CI, and locally under flags | Neo4j ingestion and traversal, Qdrant, the full benchmark runner |
| End to end | CI | Playwright against a build in mode `e2e` on port 4180, with mocked API answers |
| Visual regression | the owner's machine only | `pnpm e2e:visual`, 126 baselines, maximum 2 percent of pixels different (D-009) |
| Live model benchmark | manual | Official, sweep and compare runs |

The live tests are switched on by three flags:

| Flag | Needs | Enables |
|---|---|---|
| `GRAPH_E2E=1` | Neo4j | Tests that use Neo4j. Several wipe and reload it. |
| `VECTOR_E2E=1` | Qdrant | The live vector store tests |
| `LIVE_WORLD_E2E=1` | The presentation world, its ledger and bank, and Ollama | The live benchmark, the live API test, the live graph read test and the dev-world grounding tests |

```bash
cd backend && GRAPH_E2E=1 VECTOR_E2E=1 LIVE_WORLD_E2E=1 uv run pytest -rs
```

A test whose flag is unset is skipped, and `-rs` lists each skip with its reason.
A test whose flag is set never skips: a missing prerequisite fails it.
CI sets `GRAPH_E2E` and `VECTOR_E2E` with service containers, and never `LIVE_WORLD_E2E`.
After each test module a fixture loads the presentation world into Neo4j again when the graph holds another, so the whole live suite leaves the graph at the presentation world.

### CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests, in three jobs:

- **Backend:** Python 3.13 with Neo4j and Qdrant as service containers, then `ruff format --check`, `ruff check`, `mypy` and `pytest -rs`.
- **Frontend:** Node 24 and pnpm 12, then `format:check`, `lint`, `typecheck`, `api:check`, `test` and `build`.
- **End to end:** the Playwright functional specs against the built bundle.

CI never needs a live commercial model.
It uses the stand-in generator, the hashing embedder and the lexical judge.
The visual baselines are not a CI gate.

### Critical areas

Scoring, truth-ledger isolation, scenario injection, deterministic generation, evidence selection, benchmark execution, experiment configuration, graph traversal limits and provenance have dedicated tests.
The test files are named on each subsystem's page.
Failure-mode tests (`test_failure_modes.py`) check that a gateway, embedder or vector store failure propagates and is never turned into an answer.

### Performance

No automated gate fails a build on latency, because timing assertions are unreliable in shared CI.
Latency and context tokens are recorded for every benchmark repeat and reported separately from quality.
Demo-profile generation was timed once, in October 2026, at about 100 seconds with the first generator version.
There is no memory or throughput measurement on file.

## Extension points

- A new service dependency belongs in `docker-compose.yml` with a pinned image, a readiness check in `api/readiness.py` and a row in the recovery table.
- A new command belongs in the Makefile, and the Help screen's command list is checked against it by a test.
- A new environment variable needs an entry in `.env.example`, the settings module, and the configuration reference above.
- A change to how a demonstration is prepared changes the recovery table, and the Help screen's "Running it" section.

## Failure modes

| Failure | What happens |
|---|---|
| A service is down | The matching readiness check fails with a curated sentence, and runs that need it fail with a typed error. |
| A command is run in the wrong order | The step that needs the earlier output fails loudly (a missing file, a stale bank, an empty index). It does not continue with partial state. |
| The environment is not exported | Defaults apply silently, and the fake generator answers. The Settings drawer shows the configured models, and a run's generation events name the model that answered. |
| `make serve-demo-api` is started against a world that was never ingested | Readiness reports the graph and index checks failed. |

The archived development and demo documents are under [reference/development/](reference/development/commands.md) and [reference/demo/](reference/demo/presentation.md).
