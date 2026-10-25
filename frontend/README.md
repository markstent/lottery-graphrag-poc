# Frontend - Semantic Context Lab

A React and TypeScript single-page app that reads the backend through typed clients and draws what the backend recorded.
The screens, the visual language, accessibility and presentation mode are described in `../docs/ux.md`.
The layers, the API contract and how to run the whole system are in `../docs/architecture.md`, `../docs/api.md` and `../docs/operations.md`.

## Commands

Run these inside `frontend/`.

- `pnpm dev` - the dev server on port 5173, which forwards `/api` to the backend on port 8000.
- `pnpm test` - Vitest and Testing Library.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` - the static checks.
- `pnpm api:check` - fails when `schema.d.ts` has drifted from `openapi.json`.
- `pnpm build` - type check and production build, which must stay free of chunk-size and worker warnings.
- `pnpm e2e` - the Playwright functional specs, the CI set.
  It builds the app in mode `e2e` into `dist-e2e/` and serves it on port 4180, because the development pages under `src/dev` are left out of the production build.
  Install the browser once with `node node_modules/@playwright/test/cli.js install chromium`.
- `pnpm e2e:visual` - visual regression against the committed baselines in `e2e/visual.spec.ts-snapshots/`.
  It runs locally only, because fonts differ across platforms.
  Regenerate with `pnpm e2e:visual -- --update-snapshots` after approved visual changes.
- `node scripts/make-graph-200.mjs` - regenerates the 200-node test fixture `src/dev/fixtures/graph-200.json` from a recorded run.
