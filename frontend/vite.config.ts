/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_PROXY = { '/api': 'http://localhost:8000' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The elk worker is code-split by the build, which an IIFE worker cannot be.
  worker: { format: 'es' },
  // The client calls relative /api paths, so the dev server and the preview
  // both forward them to the backend. The browser specs run against a preview
  // of the e2e build; the ones that use the real backend
  // (e2e/live-lab-live.spec.ts) reach it through this proxy, and every other
  // spec answers the API itself and never gets this far.
  server: { proxy: API_PROXY },
  preview: { proxy: API_PROXY },
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
