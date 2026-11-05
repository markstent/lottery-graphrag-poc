// Captures what the browser specs' mock API answers for the shell from a
// running API into e2e/fixtures/world-shell.json: the demo questions, the
// models, readiness, the datasets and the dataset's index status. The runs
// the mock serves are generated (backend/scripts/fixture_official.py).
// Nothing is invented here.
//
// Usage: node scripts/capture-shell.mjs [http://localhost:8000]
// Read only: it ingests nothing.
import { writeFileSync } from 'node:fs'

const API = `${process.argv[2] ?? 'http://localhost:8000'}/api/v1`

const get = async (path) => {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}

const datasets = await get('/datasets')
const active = datasets.find((dataset) => dataset.active)

const world = {
  demo_questions: await get('/demo/questions'),
  models: await get('/models'),
  ready: await get('/health/ready'),
  datasets,
  dataset: await get(`/datasets/${active.dataset_id}`),
}
writeFileSync(
  new URL('../e2e/fixtures/world-shell.json', import.meta.url),
  `${JSON.stringify(world, null, 1)}\n`,
)
console.log(
  `world-shell.json: ${world.demo_questions.length} questions, ${datasets.length} datasets`,
)
