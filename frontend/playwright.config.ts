import { defineConfig } from '@playwright/test'

import { BASE_URL, webServer } from './playwright.shared'

// Default (CI) project: functional smoke and the graph canvas. Visual baselines live in
// playwright.visual.config.ts and run locally via `pnpm e2e:visual`.
export default defineConfig({
  testDir: './e2e',
  testMatch: /(smoke|graph-canvas-200|live-lab|data-model)\.spec\.ts$/,
  webServer,
  use: { baseURL: BASE_URL },
})
