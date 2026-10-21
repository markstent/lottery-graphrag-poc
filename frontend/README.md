# Frontend — Semantic Context Lab

High-fidelity UX prototype (Phase 7 / HITL-07). Implements the approved
information architecture (`docs/ux/information-architecture.md`) with mocked
retrieval telemetry; no backend integration yet (Phase 9 wires the API).

## Purpose

Demonstrate the comparison story — Current Approach versus + Graph & Ontology —
with real event-driven visuals, replayable execution, evidence inspection and
presentation mode, before production retrieval is connected.

## Architecture

```text
src/
  app/          shell (header, nav, settings drawer), settings context, hash router
  components/   panes, graph canvas, timeline, score strip, answer block
  views/        seven IA screens (Live Lab, Experiment Home, Scenario Lab,
                Evidence Explorer, Benchmark, Results, Semantic Layer)
  state/        useRunPlayback: merged-timeline playback with exact rewind
  mock/         telemetry events (docs/07 sections 7-11), content, evidence
```

Key principle: the UI renders only prefixes of a merged telemetry timeline.
Every visible change corresponds to an event, so replay and rewind are exact
and no activity is ever fabricated.

## Operation

- `pnpm dev` — dev server.
- `pnpm test` — Vitest + Testing Library (13 tests: projections, playback,
  shell).
- `pnpm e2e` - Playwright smoke and the graph canvas at 200 nodes (the CI
  set). It builds the app in mode `e2e` into `dist-e2e/` and serves it on port
  4180, because the development pages under `src/dev` (the graph canvas
  harness at `#/__graph`) are left out of the production build. Install the
  browser once with `node node_modules/@playwright/test/cli.js install chromium`.
- `node scripts/make-graph-200.mjs` - regenerates the 200-node test fixture
  `src/dev/fixtures/graph-200.json` from the recorded run.
- `pnpm e2e:visual` — visual regression against committed baselines
  (`e2e/visual.spec.ts-snapshots/`). Local only: fonts differ across
  platforms. Regenerate with `pnpm e2e:visual -- --update-snapshots` after
  approved visual changes.

## Configuration

Design tokens live in `src/index.css` (`@theme`): the docs/06 section 19
palette, type scale, radii and motion durations. Presentation mode and
reduced motion are runtime toggles (settings drawer; `prefers-reduced-motion`
is honoured automatically).

## Extension points

- Replace `src/mock/*` with API clients (Phase 9): `useRunPlayback` consumes
  any event stream in the docs/07 shapes; views stay unchanged.
- Graph canvas: add node kinds in `telemetry.ts` plus a shape in
  `graph-canvas.tsx`; layout is deterministic layered BFS.

## Failure modes

Error states are specified (`docs/ux/screen-specifications.md` section 1.4)
but not yet reachable with mocked telemetry; the backend-integration phase
must surface docs/07 section 11 error events in the failing pane while the
other pane continues.
