# Stable command surface defined in docs/development/commands.md.
# Targets for later phases fail loudly instead of faking success.

BACKEND := backend
FRONTEND := frontend
UV := uv --directory $(BACKEND)
PNPM := pnpm -C $(FRONTEND)

.DEFAULT_GOAL := help
.PHONY: help setup dev dev-backend dev-frontend test test-graph lint typecheck format build e2e services-up services-down generate-dev-data generate-demo-data ingest-graph run-benchmark demo-reset

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

run-benchmark: ## Run the benchmark suite (Phase 10)
	cd backend && $(UV) run python -m app.evaluation --generator fake

generate-demo-data: ## Generate the demo dataset (5M tickets; writes a separate truth ledger)
	cd backend && $(UV) run python -m app.datasets --profile demo --world-seed 2026 \
		--truth-path ../data/truth/ledger-demo.json

demo-reset: ## Reset the presentation demo state (Phase 13)
	@echo "demo-reset is not implemented yet; it arrives with Phase 13 (presentation mode, HITL-11 approved)." >&2
	@exit 1
