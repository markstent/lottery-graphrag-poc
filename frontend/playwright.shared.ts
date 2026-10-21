import type { PlaywrightTestConfig } from '@playwright/test'

/**
 * The server both Playwright projects run against. The development pages
 * (src/dev) are left out of a production build, so the specs run against a
 * build in mode "e2e" on its own port, never a preview of the production build
 * someone left running. Node runs vite directly because the pnpm shim is not
 * available everywhere.
 */
export const BASE_URL = 'http://localhost:4180'

export const webServer: NonNullable<PlaywrightTestConfig['webServer']> = {
  command:
    'node node_modules/vite/bin/vite.js build --mode e2e --outDir dist-e2e && node node_modules/vite/bin/vite.js preview --outDir dist-e2e --port 4180 --strictPort',
  url: BASE_URL,
  reuseExistingServer: false,
  timeout: 120_000,
}
