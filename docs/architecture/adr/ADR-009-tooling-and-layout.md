# ADR-009 — Engineering Tooling and Repository Layout

**Decision:** Monorepo tooling and layout for implementation:

- Python: `uv` with pinned lockfile, Python 3.13, `ruff` (format + lint), `mypy --strict`, `pytest` (warnings as errors).
- Frontend: `pnpm` with pinned lockfile, Vite 8, React 19, TypeScript 6 in strict mode, Tailwind CSS v4 via the Vite plugin, `oxlint` + Prettier, Vitest + Testing Library, Playwright.
- Layout: single backend package `backend/app/` (modules per `backend-architecture.md`) and `frontend/` Vite root, rather than the master-specification §8 sketch of separate top-level `synthetic/`, `graph/`, `retrieval/`, `evaluation/` directories.

**Reason:** The Vite 8 template ships `oxlint` as its linter; it is ESLint-compatible for our rule needs, materially faster, and removes a config surface the POC does not need. `mypy` over `pyright` avoids a Node dependency in Python tooling. The single `app/` package keeps the POC cohesive: the "synthetic, graph, retrieval, evaluation" boundaries exist as modules inside `app/`, which is the leanest structure that still preserves the required isolation (evaluator, truth ledger) and matches `backend-architecture.md`.

**Consequences:**
- `docs/development/commands.md` is implemented as the Makefile's stable command surface.
- If linting requirements later outgrow oxlint, migrating to ESLint is mechanical and does not affect contracts.
- The master-specification §8 structure is superseded by this ADR for implementation layout; documentation structure under `docs/` is unchanged.
