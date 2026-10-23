import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// The Phase 5 dependencies are pinned exactly (AGENTS.md: pin versions).
const PINNED = [
  'lucide-react',
  '@fontsource-variable/inter',
  '@xyflow/react',
  'elkjs',
  'openapi-typescript',
]

describe('package.json', () => {
  it('pins the Phase 5 dependencies to an exact version', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const all = { ...manifest.dependencies, ...manifest.devDependencies }
    for (const name of PINNED)
      expect(all[name], name).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
