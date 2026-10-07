import { defineConfig } from '@playwright/test'

// Default (CI) project: functional smoke only. Visual baselines live in
// playwright.visual.config.ts and run locally via `pnpm e2e:visual`.
export default defineConfig({
  testDir: './e2e',
  testMatch: /smoke\.spec\.ts$/,
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
})
