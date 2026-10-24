/**
 * The first application is gone. No source file may import its mock
 * telemetry, its backend adapter or its views, and none of those files may
 * come back.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx}', '/e2e/**/*.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)

const V1_PATH = String.raw`['"][^'"]*(?:\/mock\/|backend-run|\/views\/|v1-)`
/** `from 'x'`, `import 'x'` (side effect) and `import('x')`. */
const IMPORT_OF_V1 = new RegExp(
  String.raw`\bfrom\s+${V1_PATH}|\bimport\s*\(?\s*${V1_PATH}`,
)

describe('the first application', () => {
  it('is not imported by any source or e2e file', () => {
    const importers = Object.entries(sources)
      .filter(([path]) => !path.endsWith('/no-v1.test.ts'))
      .filter(([, source]) => IMPORT_OF_V1.test(source))
      .map(([path]) => path)
    expect(importers).toEqual([])
  })

  it('has no file left under views or mock, and no backend adapter or v1 file', () => {
    const left = Object.keys(sources).filter((path) =>
      /^\/src\/(?:views|mock)\/|backend-run|\/v1-/.test(path),
    )
    expect(left).toEqual([])
  })

  it('is checked by a pattern that catches an import', () => {
    expect(IMPORT_OF_V1.test("import { x } from '../mock/telemetry'")).toBe(
      true,
    )
    expect(IMPORT_OF_V1.test("import { y } from '../api/backend-run'")).toBe(
      true,
    )
    expect(IMPORT_OF_V1.test("const m = import('./views/help')")).toBe(true)
    expect(IMPORT_OF_V1.test("import './views/help'")).toBe(true)
    expect(IMPORT_OF_V1.test('import "../mock/telemetry"')).toBe(true)
    expect(IMPORT_OF_V1.test("import { z } from '../screens/help/help'")).toBe(
      false,
    )
  })
})
