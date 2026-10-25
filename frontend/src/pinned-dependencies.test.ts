import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Every dependency is pinned exactly (AGENTS.md: pin versions).
describe('package.json', () => {
  it('pins every dependency and devDependency to an exact version', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const all = { ...manifest.dependencies, ...manifest.devDependencies }
    expect(Object.keys(all).length).toBeGreaterThan(0)
    for (const [name, version] of Object.entries(all))
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
