import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { build } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'

/** Strings only the development pages carry: their routes and the gallery's own markup. */
const DEV_ONLY = [
  '__gallery',
  '__graph',
  'Foundation gallery',
  'data-gallery',
  'Graph harness',
]

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [join(dir, entry.name)],
  )

describe('production build', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'scl-production-'))
  afterAll(() => rmSync(outDir, { recursive: true, force: true }))

  it('leaves the gallery and the graph harness out', async () => {
    await build({
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    })
    const built = files(outDir).filter((file) => /\.(js|css|html)$/.test(file))
    expect(built.length).toBeGreaterThan(0)
    for (const file of built) {
      const text = readFileSync(file, 'utf8')
      for (const marker of DEV_ONLY)
        expect(text, `${marker} in ${file}`).not.toContain(marker)
    }
  }, 180_000)
})
