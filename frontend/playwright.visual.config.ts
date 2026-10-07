import { defineConfig } from '@playwright/test'

// Visual regression project (local only, not run in CI): generates and
// checks the HITL-07 approved screenshots in e2e/visual.spec.ts.
export default defineConfig({
  testDir: './e2e',
  testMatch: /visual\.spec\.ts$/,
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
  // Cross-machine font rendering varies; baselines are regenerated on the
  // owning machine with --update-snapshots when the UI changes materially.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
})
