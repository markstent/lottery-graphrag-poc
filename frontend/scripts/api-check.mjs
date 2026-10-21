// Fails when src/api/schema.d.ts is not what openapi-typescript generates from
// the committed src/api/openapi.json. Needs no backend and no Python.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SPEC = 'src/api/openapi.json'
const COMMITTED = 'src/api/schema.d.ts'
const directory = mkdtempSync(join(tmpdir(), 'api-check-'))
const fresh = join(directory, 'schema.d.ts')

try {
  execFileSync(
    join('node_modules', '.bin', 'openapi-typescript'),
    [SPEC, '-o', fresh],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  )
  if (!readFileSync(fresh).equals(readFileSync(COMMITTED))) {
    console.error(
      `${COMMITTED} does not match ${SPEC}. Run "make api-contract" (or "pnpm api:types") and commit the result.`,
    )
    process.exitCode = 1
  } else {
    console.log(`${COMMITTED} matches ${SPEC}`)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
