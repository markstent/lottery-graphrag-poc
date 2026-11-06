import { defineConfig } from '@playwright/test'

import { BASE_URL, webServer } from './playwright.shared'

// Default (CI) project: functional smoke and the graph canvas. Visual baselines live in
// playwright.visual.config.ts and run locally via `pnpm e2e:visual`.
// live-lab-live.spec.ts needs the real backend and skips unless LIVE_WORLD_E2E is set.
export default defineConfig({
  testDir: './e2e',
  testMatch:
    /(smoke|graph-canvas-200|live-lab|live-lab-live|data-model|mock-data-model|help|results-run|results|public-site)\.spec\.ts$/,
  webServer,
  use: { baseURL: BASE_URL },
})
