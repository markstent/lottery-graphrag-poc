# Stable command surface, described in docs/operations.md.

# A root .env (git-ignored) sets the backend's variables for every target. Write
# KEY=value with no quotes: make reads the file, a $ in a value is expanded, and a # starts a comment.
-include .env
export

BACKEND := backend
FRONTEND := frontend
UV := uv --directory $(BACKEND)
PNPM := pnpm -C $(FRONTEND)

.DEFAULT_GOAL := help
.PHONY: help setup dev dev-backend dev-frontend check-ollama dev-official dev-official-backend test test-graph lint typecheck format build api-contract e2e services-up services-down generate-dev-data generate-demo-data ingest-graph index-vector pull-models ingest-demo-graph index-demo-vector serve-demo-api demo-reset ground-bank ground-demo-bank run-smoke run-benchmark run-sweep dry-run dev-run diagnose-selection traces addendum-v020 label-sample label-agreement second-judge judges-combined

help: ## Show available commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-19s %s\n", $$1, $$2}'

setup: ## Install Python, frontend and Playwright dependencies
	$(UV) sync
	$(PNPM) install
	$(PNPM) exec playwright install chromium

dev-backend: ## Run the FastAPI backend with reload (a question run reads Neo4j and Qdrant and calls the configured models)
	$(UV) run uvicorn app.main:app --reload --port 8000

dev-frontend: ## Run the Vite frontend dev server
	$(PNPM) run dev

dev: ## Run backend and frontend together (Ctrl+C stops both; the backend reads Neo4j and Qdrant and calls the configured models)
	$(MAKE) -j2 dev-backend dev-frontend

# The official run's answer model and settings (official-2026-10-29), so Live Lab
# answers come from the model the published results used, not the fake default.
OLLAMA_HOST ?= http://localhost:11434
REAL_MODEL := qwen3.6:latest
EMBEDDING_MODEL_TAG := bge-m3:latest
REAL_MODEL_ENV = GENERATION_PROVIDER=litellm GENERATION_MODEL=ollama/$(REAL_MODEL) GENERATION_MODEL_FAMILY=qwen GENERATION_API_BASE=$(OLLAMA_HOST) GENERATION_REASONING=off GENERATION_TEMPERATURE=0 GENERATION_MAX_TOKENS=4096

check-ollama: ## Check that Ollama answers and holds the official answer model (qwen3.6) and the embedding model (bge-m3); no model call
	@tags=$$(curl -sf --max-time 5 $(OLLAMA_HOST)/api/tags) || { echo "Ollama is not answering at $(OLLAMA_HOST). Start it (open -a Ollama, or ollama serve) and try again."; exit 1; }; \
	for model in $(REAL_MODEL) $(EMBEDDING_MODEL_TAG); do \
	  echo "$$tags" | grep -q "\"name\":\"$$model\"" || { echo "Ollama does not have $$model. Run: ollama pull $$model"; exit 1; }; \
	done; \
	echo "Ollama is answering at $(OLLAMA_HOST) and has $(REAL_MODEL) and $(EMBEDDING_MODEL_TAG)."

dev-official-backend: check-ollama ## Run the backend with reload on the official answer model (qwen3.6 through Ollama) instead of the fake one
	$(REAL_MODEL_ENV) $(UV) run uvicorn app.main:app --reload --port 8000

dev-official: check-ollama ## Run backend and frontend together on the official answer model, for a demo (Ctrl+C stops both)
	$(MAKE) -j2 dev-official-backend dev-frontend

test: ## Run Python and frontend unit tests (never the live graph tests)
	env -u GRAPH_E2E $(UV) run pytest
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

generate-dev-data: ## Generate the development dataset
	$(UV) run python -m app.datasets --profile dev --world-seed 2026

ingest-graph: ## Ingest the development dataset into Neo4j (wipes Neo4j first; no model)
	$(UV) run python -m app.graph --wipe

index-vector: ## Build the document vector index in Qdrant (writes Qdrant; runs the embedding model)
	$(UV) run python -m app.retrieval.standard

traces: ## Write side-by-side A/B/C example traces (reads Neo4j and Qdrant, runs the embedding and re-ranking models; fake generator, no answer model)
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

ingest-demo-graph: ## Ingest the demo dataset into Neo4j (wipes Neo4j first; no model; demo reset, part 1)
	$(DEMO_ENV) $(UV) run python -m app.graph --wipe

index-demo-vector: ## Build the demo vector index in Qdrant (writes Qdrant; runs the embedding model; demo reset, part 2)
	$(DEMO_ENV) $(UV) run python -m app.retrieval.standard

serve-demo-api: ## Serve the API against the demo world (reads Neo4j and Qdrant; calls the configured models)
	$(DEMO_ENV) $(UV) run uvicorn app.main:app --port 8000

demo-reset: ## Reset the presentation demo state (wipes Neo4j and re-ingests; rebuilds the Qdrant index with the embedding model; no answer model)
	$(MAKE) ingest-demo-graph index-demo-vector
	@echo "demo reset complete: restart serve-demo-api to load the new world"

# Benchmark v2 (docs/reference/evaluation/reproducibility.md). Runs are written to
# data/evaluation/runs/<run id>; worlds other than 2026 are generated, indexed
# and grounded on first use, and the seed 2026 graph is restored afterwards.
# SEEDS are the seen worlds, for smoke runs and sweeps. OFFICIAL_SEEDS are the
# unseen worlds of the method v0.3 official run (D-091): only a full-bank
# official run may use them.
SEEDS = 2026,2027,2028
OFFICIAL_SEEDS = 2029,2030,2031,2032,2033,2034

ground-bank: ## Ground bank 2.0.0 into the active world (DATASET_DIR and TRUTH_LEDGER_PATH; files only, no Neo4j, no model)
	$(UV) run python -m app.evaluation ground

ground-demo-bank: ## Ground bank 2.0.0 into the demo world and its ledger (files only, no Neo4j, no model)
	$(DEMO_ENV) $(UV) run python -m app.evaluation ground

run-smoke: ## Scorer smoke test on three worlds (wipes and restores Neo4j, indexes new worlds in Qdrant; fake generator and judge, so no answer or judge model)
	$(UV) run python -m app.evaluation run --kind smoke --seeds $(SEEDS)

run-benchmark: ## Official run on the six unseen worlds, each question asked once (D-097; REPEATS=N asks each N times) (wipes and restores Neo4j, indexes new worlds in Qdrant; calls the answer and judge models, reads GENERATION_* and JUDGE_*); OUT=DIR names the run, OUT=DIR RESUME=1 continues a failed one
	@test -z "$(RESUME)" || test -n "$(OUT)" || { echo "RESUME=1 needs OUT=<the run directory to continue>"; exit 1; }
	@test "$$GENERATION_PROVIDER" = litellm || { echo "set GENERATION_PROVIDER=litellm and the GENERATION_* model (see .env.example)"; exit 1; }
	@test "$$JUDGE_PROVIDER" = litellm || { echo "set JUDGE_PROVIDER=litellm and the JUDGE_* model (see .env.example)"; exit 1; }
	$(UV) run python -m app.evaluation run --kind official --seeds $(OFFICIAL_SEEDS) --repeats $(or $(REPEATS),1) $(if $(OUT),--out $(OUT)) $(if $(and $(OUT),$(RESUME)),--resume)

dry-run: ## Four-question dry run of the official settings, each question asked once (D-097; REPEATS=N asks each N times) (wipes and restores Neo4j, indexes new worlds in Qdrant; calls the answer and judge models; owner approval required)
	@test "$$GENERATION_PROVIDER" = litellm || { echo "set GENERATION_PROVIDER=litellm and the GENERATION_* model (see .env.example)"; exit 1; }
	@test "$$JUDGE_PROVIDER" = litellm || { echo "set JUDGE_PROVIDER=litellm and the JUDGE_* model (see .env.example)"; exit 1; }
	$(UV) run python -m app.evaluation run --kind official --seeds 2026 --repeats $(or $(REPEATS),1) --limit 1 --questions $$($(UV) run python -m app.evaluation dry-run-questions) $(if $(OUT),--out $(OUT))

dev-run: ## Development run on seed 2026, not a result (wipes and restores Neo4j, indexes new worlds in Qdrant; calls the answer and judge models; owner go-ahead required)
	@test "$$GENERATION_PROVIDER" = litellm || { echo "set GENERATION_PROVIDER=litellm and the GENERATION_* model (see .env.example)"; exit 1; }
	@test "$$JUDGE_PROVIDER" = litellm || { echo "set JUDGE_PROVIDER=litellm and the JUDGE_* model (see .env.example)"; exit 1; }
	$(UV) run python -m app.evaluation run --kind dev --seeds 2026 --repeats $(or $(REPEATS),1) $(if $(STRATA),--strata $(STRATA)) $(if $(LIMIT),--limit $(LIMIT)) $(if $(OUT),--out $(OUT))

diagnose-selection: ## Read-only: which claim records each approach finds and the selection keeps (seed 2026; no answer model; reads Neo4j, runs the embedding and re-ranking models)
	$(UV) run python -m app.evaluation diagnose-selection

addendum-v020: ## Rescore official run v0.2.0 with the current scorer and groundedness (no Neo4j, no model)
	$(UV) run python -m app.evaluation addendum --run ../data/evaluation/runs/official-2026-10-26

label-sample: ## Build the hand-labelling sample from the official run v0.2.0 (no Neo4j, no model)
	$(UV) run python -m app.evaluation label-sample --run ../data/evaluation/runs/official-2026-10-26

label-agreement: ## Agreement of the measures with the hand labels (no Neo4j, no model)
	$(UV) run python -m app.evaluation label-agreement --run ../data/evaluation/runs/official-2026-10-26

second-judge: ## Second judge over a stored run, RUN=<run id>, or the hand-labelled sample, LABELS=v0.2.0-sample (D-100; no Neo4j; calls the SECOND_JUDGE_* model, writes data/evaluation/second-judge, resumes)
	@test -n "$(RUN)$(LABELS)" || { echo "set RUN=<run id> (under data/evaluation/runs) or LABELS=v0.2.0-sample"; exit 1; }
	@test "$$SECOND_JUDGE_PROVIDER" = litellm || { echo "set SECOND_JUDGE_PROVIDER=litellm and the SECOND_JUDGE_* model (see .env.example)"; exit 1; }
	$(UV) run python -m app.evaluation second-judge $(if $(RUN),--run $(RUN),--labels $(LABELS))

judges-combined: ## The two judges' combined mark of a run whose second judge has finished, RUN=<run id> (D-105; no Neo4j, no model; writes combined.json beside the second judge)
	@test -n "$(RUN)" || { echo "set RUN=<run id> (under data/evaluation/runs)"; exit 1; }
	$(UV) run python -m app.evaluation judges-combined --run $(RUN)

run-sweep: ## H1 depth sweep 0 to 3 for B and C on three worlds (wipes and restores Neo4j, indexes new worlds in Qdrant; calls the judge model, and the answer model unless GENERATION_PROVIDER=fake)
	@test "$$JUDGE_PROVIDER" = litellm || { echo "set JUDGE_PROVIDER=litellm and the JUDGE_* model (see .env.example)"; exit 1; }
	$(UV) run python -m app.evaluation sweep --seeds $(SEEDS) --depths 0,1,2,3
