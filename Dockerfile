# The public, read-only Semantic Context Lab (PUBLIC_MODE=1, docs/operations.md "Deploying the public site").
# Three targets: the frontend build, the API (with the deterministic dev world built in), and a small web server.
# Built on the lab server itself (Arm64); every base image is multi-arch.

# ---------- Frontend: the static screens, with the recorded Live Lab runs ----------
FROM node:24-alpine AS frontend
RUN npm install -g pnpm@12.18.0
WORKDIR /repo/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

# ---------- API: FastAPI in public mode, plus the world it reads ----------
FROM python:3.13-slim AS api
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /repo/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
WORKDIR /repo
COPY . .
RUN cd backend && uv sync --frozen --no-dev
# The world, its truth ledger and the grounded question bank: files only, deterministic, no services or models.
RUN cd backend && .venv/bin/python -m app.datasets --profile dev --world-seed 2026 \
 && .venv/bin/python -m app.evaluation ground
# The graph's statistics live on the persistent /state volume beside the graph itself (Neo4j's volume),
# so a rebuilt container finds both and does not reload. The fingerprint says which world was built.
RUN ln -sf /state/_graph_stats.json /repo/data/generated/dev-seed2026/_graph_stats.json \
 && find /repo/data/generated/dev-seed2026 -type f -exec sha256sum {} + | sort -k2 | sha256sum | cut -d" " -f1 > /repo/deploy/world.sha
ENV PUBLIC_MODE=1 \
    BENCHMARK_DIR=/repo/deploy/published-runs \
    APP_DB_PATH=/state/app.db \
    EMBEDDING_PROVIDER=hashing \
    RERANK_PROVIDER=lexical \
    GENERATION_PROVIDER=fake \
    JUDGE_PROVIDER=fake \
    LOG_LEVEL=INFO
# The API user owns the world folder: loading the graph writes its statistics there.
RUN useradd --create-home --uid 10001 lab && mkdir -p /state && chown lab /state && chown -R lab /repo/data/generated \
 && chmod -R a+rX /repo/deploy/published-runs
USER lab
EXPOSE 8000
CMD ["/repo/backend/.venv/bin/python", "/repo/deploy/start_api.py"]

# ---------- Web: serves the screens and passes /api/ to the API ----------
FROM caddy:2.11-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /repo/frontend/dist /srv
EXPOSE 8080
