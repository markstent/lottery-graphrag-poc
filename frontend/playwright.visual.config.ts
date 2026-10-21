import { defineConfig } from '@playwright/test'

import { BASE_URL, webServer } from './playwright.shared'

// Visual regression project (local only, not run in CI): generates and
// checks the HITL-07 approved screenshots in e2e/visual.spec.ts.
export default defineConfig({
  testDir: './e2e',
  testMatch: /visual\.spec\.ts$/,
  webServer,
  use: { baseURL: BASE_URL },
  // Cross-machine font rendering varies; baselines are regenerated on the
  // owning machine with --update-snapshots when the UI changes materially.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
})
