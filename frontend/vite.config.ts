/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The elk worker is code-split by the build, which an IIFE worker cannot be.
  worker: { format: 'es' },
  build: {
    // The Live Lab chunk carries the four recorded runs (2.4 MB of JSON), its
    // offline replay data, so it passes Vite's 500 kB default by design.
    chunkSizeWarningLimit: 2048,
  },
  test: {
    // jsdom has no Worker: elk's in-process worker stands in for the real one.
    alias: {
      'elkjs/lib/elk-worker.min.js?worker': fileURLToPath(
        new URL('./src/test/elk-worker.ts', import.meta.url),
      ),
    },
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
