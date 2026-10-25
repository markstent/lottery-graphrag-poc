# Stable command surface defined in docs/reference/development/commands.md.
# Targets for later phases fail loudly instead of faking success.

BACKEND := backend
FRONTEND := frontend
UV := uv --directory $(BACKEND)
PNPM := pnpm -C $(FRONTEND)

.DEFAULT_GOAL := help
.PHONY: help setup dev dev-backend dev-frontend test test-graph lint typecheck format build api-contract e2e services-up services-down generate-dev-data generate-demo-data ingest-graph index-vector pull-models ingest-demo-graph index-demo-vector serve-demo-api demo-reset ground-bank ground-demo-bank run-smoke run-benchmark run-sweep traces

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

setup: ## Install Python, frontend and Playwright dependencies
	$(UV) sync
	$(PNPM) install
	$(PNPM) exec playwright install chromium

dev-backend: ## Run the FastAPI backend with reload
	$(UV) run uvicorn app.main:app --reload --port 8000

dev-frontend: ## Run the Vite frontend dev server
	$(PNPM) run dev

dev: ## Run backend and frontend together (Ctrl+C stops both)
	$(MAKE) -j2 dev-backend dev-frontend

test: ## Run Python and frontend unit tests
	$(UV) run pytest
	$(PNPM) run test

test-graph: ## Run live-graph integration tests (wipes the Neo4j database)
	GRAPH_E2E=1 $(UV) run pytest tests/test_graph_ingestion.py

lint: ## Run ruff and oxlint
	$(UV) run ruff check .
	$(PNPM) run lint

typecheck: ## Run mypy and TypeScript checks
	$(UV) run mypy
	$(PNPM) run typecheck

format: ## Apply ruff and Prettier formatting
	$(UV) run ruff format .
	$(UV) run ruff check --fix .
	$(PNPM) run format

build: ## Build the frontend production bundle
	$(PNPM) run build

api-contract: ## Export the OpenAPI schema and regenerate the frontend types
	$(UV) run python -m app.api.openapi_export
	$(PNPM) run api:types

e2e: ## Build the frontend and run Playwright smoke tests
	$(PNPM) run build
	$(PNPM) run e2e

services-up: ## Start Neo4j and Qdrant via Docker Compose
	docker compose up -d

services-down: ## Stop and remove local services
	docker compose down

generate-dev-data: ## Generate the development dataset (Phase 3)
	$(UV) run python -m app.datasets --profile dev --world-seed 2026

ingest-graph: ## Ingest the development dataset into Neo4j (Phase 4)
	$(UV) run python -m app.graph --wipe

index-vector: ## Build the document vector index in Qdrant (Phase 8)
	$(UV) run python -m app.retrieval.standard

traces: ## Write side-by-side A/B/C example traces (fake generator; needs the dev graph and index)
	$(UV) run python -m app.traces --generator fake > docs/evaluation/example-traces.md.tmp
	mv docs/evaluation/example-traces.md.tmp docs/evaluation/example-traces.md

pull-models: ## Pull the local embedding model
	ollama pull bge-m3

generate-demo-data: ## Generate the demo dataset (5M tickets; writes a separate truth ledger)
	$(UV) run python -m app.datasets --profile demo --world-seed 2026 \
		--truth-path ../data/truth/ledger-demo.json

# The demo world lives beside the development world and uses its own Qdrant
# collection, so demo and development states never overwrite each other.
DEMO_DATASET_DIR = ../data/generated/demo-seed2026
DEMO_ENV = DATASET_DIR=$(DEMO_DATASET_DIR) TRUTH_LEDGER_PATH=../data/truth/ledger-demo.json QDRANT_COLLECTION=semantic_context_lab_demo

ingest-demo-graph: ## Ingest the demo dataset into Neo4j (demo reset, part 1)
	$(DEMO_ENV) $(UV) run python -m app.graph --wipe

index-demo-vector: ## Build the demo vector index in Qdrant (demo reset, part 2)
	$(DEMO_ENV) $(UV) run python -m app.retrieval.standard

serve-demo-api: ## Serve the API against the demo world
	$(DEMO_ENV) $(UV) run uvicorn app.main:app --port 8000

demo-reset: ## Reset the presentation demo state (re-ingest graph + rebuild vector index)
	$(MAKE) ingest-demo-graph index-demo-vector
	@echo "demo reset complete: restart serve-demo-api to clear in-memory runs"

# Benchmark v2 (docs/reference/evaluation/reproducibility.md). Runs are written to
# data/evaluation/runs/<run id>; worlds 2027 and 2028 are generated, indexed
# and grounded on first use, and the seed 2026 graph is restored afterwards.
SEEDS = 2026,2027,2028

ground-bank: ## Ground bank 2.0.0 into the active world (DATASET_DIR and TRUTH_LEDGER_PATH)
	$(UV) run python -m app.evaluation ground

ground-demo-bank: ## Ground bank 2.0.0 into the demo world and its ledger
	$(DEMO_ENV) $(UV) run python -m app.evaluation ground

run-smoke: ## Scorer smoke test on three worlds (fake generator and judge; needs services)
	$(UV) run python -m app.evaluation run --kind smoke --seeds $(SEEDS)

run-benchmark: ## Official run on three worlds, 3 repeats (reads GENERATION_* and JUDGE_*)
	@test "$$GENERATION_PROVIDER" = litellm || { echo "set GENERATION_PROVIDER=litellm and the GENERATION_* model (see .env.example)"; exit 1; }
	@test "$$JUDGE_PROVIDER" = litellm || { echo "set JUDGE_PROVIDER=litellm and the JUDGE_* model (see .env.example)"; exit 1; }
	$(UV) run python -m app.evaluation run --kind official --seeds $(SEEDS) --repeats 3

run-sweep: ## H1 depth sweep 0 to 3 for B and C on three worlds (reads JUDGE_* and GENERATION_*)
	@test "$$JUDGE_PROVIDER" = litellm || { echo "set JUDGE_PROVIDER=litellm and the JUDGE_* model (see .env.example)"; exit 1; }
	$(UV) run python -m app.evaluation sweep --seeds $(SEEDS) --depths 0,1,2,3
