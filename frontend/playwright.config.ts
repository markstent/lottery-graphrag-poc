import { defineConfig } from '@playwright/test'

// Default (CI) project: functional smoke and the graph canvas. Visual baselines live in
// playwright.visual.config.ts and run locally via `pnpm e2e:visual`.
export default defineConfig({
  testDir: './e2e',
  testMatch: /(smoke|graph-canvas-200)\.spec\.ts$/,
  webServer: {
    // The dev pages (src/dev) are left out of a production build, so the
    // specs run against a build in mode "e2e" on its own port, never a
    // preview of the production build someone left running. Node runs vite
    // directly because the pnpm shim is not available everywhere.
    command:
      'node node_modules/vite/bin/vite.js build --mode e2e --outDir dist-e2e && node node_modules/vite/bin/vite.js preview --outDir dist-e2e --port 4180 --strictPort',
    url: 'http://localhost:4180',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:4180',
  },
})
