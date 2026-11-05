// Captures GET /benchmarks/questions of a running API into the two e2e fixtures the
// mock API serves: the bank as the backend answers it (unscored when no whole-bank
// official run is published), and the same bank scored by the named run, so the
// mock's score cells have the shape the API gives. Usage:
// node scripts/capture-questions.mjs [http://localhost:8000] [run id to score by].
// Read only: it ingests nothing.
import { writeFileSync } from 'node:fs'

const API = `${process.argv[2] ?? 'http://localhost:8000'}/api/v1`
const RUN = process.argv[3] ?? 'dry-run-2026-10-29'

const get = async (path) => {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}

const write = (name, body) =>
  writeFileSync(
    new URL(`../e2e/fixtures/${name}`, import.meta.url),
    `${JSON.stringify(body, null, 1)}\n`,
  )

write('benchmark-questions-unscored.json', await get('/benchmarks/questions'))
write(
  'benchmark-questions-scored.json',
  await get(`/benchmarks/questions?run_id=${encodeURIComponent(RUN)}`),
)
