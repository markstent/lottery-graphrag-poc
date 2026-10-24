// Captures what the browser specs' mock API answers for the shell, Overview and
// Results from a running API into e2e/fixtures/world-shell.json: the demo
// questions, the models, readiness, the datasets, the dataset's index status,
// the published runs and the newest run (and the newest smoke run, which is
// what /benchmarks/latest answers when a smoke run is the newest).
//
// A run's summary is large (the smoke run's is 4 MB), so only the parts the
// screens read are kept: its selection, headlines, instance counts and the
// overall metrics. Nothing is invented here.
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

const slim = (run) => ({
  ...run,
  summary: {
    selection: run.summary.selection,
    headlines: run.summary.headlines,
    instances: run.summary.instances,
    metrics: { overall: run.summary.metrics?.overall },
  },
})

const runs = await get('/benchmarks')
const smoke = runs.find((run) => run.run_kind === 'smoke')
if (!smoke) throw new Error('no smoke run is published')
const datasets = await get('/datasets')
const active = datasets.find((dataset) => dataset.active)

const world = {
  demo_questions: await get('/demo/questions'),
  models: await get('/models'),
  ready: await get('/health/ready'),
  datasets,
  dataset: await get(`/datasets/${active.dataset_id}`),
  runs,
  latest: slim(await get('/benchmarks/latest')),
  latest_smoke: slim(await get(`/benchmarks/${smoke.run_id}`)),
}
writeFileSync(
  new URL('../e2e/fixtures/world-shell.json', import.meta.url),
  `${JSON.stringify(world, null, 1)}\n`,
)
console.log(
  `world-shell.json: ${world.demo_questions.length} questions, ${runs.length} runs, latest ${world.latest.run_id}`,
)
