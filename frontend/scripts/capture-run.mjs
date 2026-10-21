// Captures one A, B, C run through the HTTP API into src/run/fixtures/run-abc.json.
// Serve the backend first (GENERATION_PROVIDER=fake, the dev world):
//   node scripts/capture-run.mjs [http://localhost:8000]
// The run id and timestamps are kept as the API gave them.
import { writeFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:8000'
const OUTPUT = 'src/run/fixtures/run-abc.json'
const CONFIGURATIONS = ['A', 'B', 'C']
const FINISHED = ['completed', 'failed', 'cancelled']
const POLL_MS = 500
const DEADLINE_MS = 300_000

async function api(path, init) {
  const response = await fetch(`${BASE}/api/v1${path}`, init)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return response.json()
}

const questions = await api('/demo/questions')
const question = questions.find((entry) => entry.stratum === 'H1')
if (!question) throw new Error('the bank has no H1 question')

const { run_id: runId } = await api('/queries', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: question.text,
    configurations: CONFIGURATIONS,
    market_scope: question.market_scope,
  }),
})

const deadline = Date.now() + DEADLINE_MS
let run = await api(`/queries/${runId}`)
while (!FINISHED.includes(run.status)) {
  if (Date.now() > deadline) throw new Error(`${runId} did not finish`)
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  run = await api(`/queries/${runId}`)
}
if (run.status !== 'completed') {
  throw new Error(`${runId} ended ${run.status}: ${JSON.stringify(run.error)}`)
}

const { events } = await api(`/queries/${runId}/events`)
const fixture = {
  run_id: runId,
  instance_id: question.instance_id,
  question: question.text,
  market_scope: question.market_scope,
  configurations: CONFIGURATIONS,
  events,
}
writeFileSync(OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`${OUTPUT}: ${runId}, ${events.length} events`)
