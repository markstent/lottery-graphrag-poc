# Commands

Phase 0 should implement stable commands for:

```text
setup
dev
test
lint
typecheck
format
build
api-contract
services-up
services-down
generate-dev-data
ingest-graph
index-vector
traces
test-graph
ground-bank
run-smoke
run-benchmark
run-sweep
demo-reset
```

Exact command implementation may use Makefile or task runner.

## API contract

The backend's OpenAPI schema is committed as `frontend/src/api/openapi.json`, and the frontend types as `frontend/src/api/schema.d.ts`.
The frontend imports its API types only from `schema.d.ts`.
After changing a route or a response model, run `make api-contract`.
It writes the schema with `python -m app.api.openapi_export` and then regenerates the types with `pnpm api:types`.

Two checks fail when the files drift:

- `backend/tests/test_openapi_contract.py` compares the committed `openapi.json` with the schema the application serves.
- `pnpm api:check` regenerates the types from the committed `openapi.json` into a temporary file and compares it byte for byte with `schema.d.ts`.
  It needs no backend, so the frontend CI job runs it after the typecheck.

`openapi.json` and `schema.d.ts` are generated output, so Prettier ignores both and oxlint ignores `schema.d.ts`.

## Live tests

The default `make test` runs offline.
Three flags switch on the live tests, which need running services.
`make services-up` starts Neo4j and Qdrant; Ollama runs on the host.

| Flag               | Needs                                                                                                                    | Enables                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `GRAPH_E2E=1`      | Neo4j                                                                                                                    | the live graph tests; several wipe and re-ingest Neo4j                                                                      |
| `VECTOR_E2E=1`     | Qdrant                                                                                                                   | the live vector store tests                                                                                                 |
| `LIVE_WORLD_E2E=1` | the presentation world (`make generate-dev-data ingest-graph index-vector ground-bank`), its ledger and bank, and Ollama | the live benchmark, the live API test on the presentation world, the live graph read test and the dev-world grounding tests |

Run the whole live suite from `backend/`:

```bash
GRAPH_E2E=1 VECTOR_E2E=1 LIVE_WORLD_E2E=1 uv run pytest -rs
```

A test whose flag is unset is skipped; `-rs` lists each skip with its reason, and CI runs with it.
A test whose flag is set never skips: a missing prerequisite or an unreachable service fails it, so a green run with the flags set means the live tests ran.
CI sets `GRAPH_E2E` and `VECTOR_E2E` with service containers, and never `LIVE_WORLD_E2E`, because the presentation world is not generated there.
After each test module a fixture ingests the presentation world (`DATASET_DIR`'s) again if Neo4j holds another, when that world's `_graph_stats.json` exists.
Running the whole live suite therefore leaves the graph at the presentation world; check it with `GET /api/v1/health/ready`.
The gating helpers are in `backend/tests/live.py`.
