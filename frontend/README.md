# Frontend - Semantic Context Lab

The frontend of the experiment, a React and TypeScript single-page app.
It reads the backend through typed clients and draws what the backend recorded.
Phase 5 laid the foundation: the shell, the design system, the run reducer and replay, and the graph canvas.
Phase 6 builds the five destinations on it.

## Purpose

Show the comparison between RAG, GraphRAG and GraphRAG with ontology.
Every visible change comes from a recorded event, so a replay is exact and no activity is made up.

## Architecture

```text
src/
  api/          typed backend clients (schema.d.ts is generated), the event stream, loading a recorded run
  run/          the run reducer (events to state), the replay clock and its React hook
  graph/        the evidence graph: view model, layout (elk), canvas, nodes, edges, path list, legend
  charts/       grouped bars, interval plot, stat tile, data table, legend and tooltip
  design/       tokens, pipeline colours, evidence states, plain names for nodes and relationships
  copy/         the plain-words glossary and the banned-words scan
  dev/          the graph harness and the component gallery (left out of the production build)
  app/          shell, hash router, settings and presentation mode, readiness
  components/   panel, drawer, evidence drawer, live score and the other shared pieces
```

The v1 views in `src/views/`, and `src/mock/` with the mocked telemetry they read, remain until Phase 6 replaces them.
Nothing new should import from either.

The data flows one way.
`api/` brings events and results in, `run/` reduces them to state, `graph/` turns that state into a drawable view, and the components draw it.
Scoring and experiment logic stay out of React components.

## Operation

- `pnpm dev` - dev server.
- `pnpm test` - Vitest and Testing Library.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` - the static checks.
- `pnpm api:check` - fails when `schema.d.ts` has drifted from `openapi.json`.
- `pnpm build` - type check and production build.
  Each destination is its own chunk, and the build must stay free of chunk-size and worker warnings.
- `pnpm e2e` - Playwright smoke and the graph canvas at 200 nodes (the CI set).
  It builds the app in mode `e2e` into `dist-e2e/` and serves it on port 4180, because the development pages under `src/dev` (the graph harness at `#/__graph`, the gallery at `#/__gallery`) are left out of the production build.
  Install the browser once with `node node_modules/@playwright/test/cli.js install chromium`.
- `node scripts/make-graph-200.mjs` - regenerates the 200-node test fixture `src/dev/fixtures/graph-200.json` from the recorded run.
- `pnpm e2e:visual` - visual regression against committed baselines (`e2e/visual.spec.ts-snapshots/`).
  It runs locally only, because fonts differ across platforms.
  Regenerate with `pnpm e2e:visual -- --update-snapshots` after approved visual changes.

## Configuration

Design tokens live in `src/index.css` (`@theme`): palette, type scale, radii and motion durations.
Presentation mode (`?present=1`) and reduced motion are runtime toggles, each a class on the root element.
The Settings drawer sets reduced motion by hand, and `prefers-reduced-motion` is honoured automatically.
The visible-node cap for the graph is a setting, and its default is in `graph/model.ts`.

## Extension points

- A new destination: add a route in `app/router.ts`, build the view from `components/`, `charts/` and `graph/`, and load it with `React.lazy` in `App.tsx`.
- A new backend event: add its reducer rule in `run/reduce.ts` and its place in the graph view model in `graph/model.ts`.
  An event the reducer does not know is kept in the state's `unknown` list, never dropped.
- A new kind of graph node or relationship: add its plain name in `design/node-labels.ts` or `design/relationships.ts`.
  A test fails when a backend relationship type has no plain phrase.
- A new chart: build it in `charts/` from the scale helpers, and give it a data table alternative.

## Failure modes

Every panel has loading, empty, error and disabled states (`components/panel.tsx`), and an error that can be retried offers Retry.
If the graph layout fails, the canvas says so in a sentence and the detail goes to the console.
