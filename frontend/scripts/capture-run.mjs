// Captures A, B, C runs through the HTTP API.
//
// Fixture run (default), one fake-generator run into src/run/fixtures/run-abc.json:
//   node scripts/capture-run.mjs [http://localhost:8000]
//
// Recorded runs, live runs of the demo questions of the given strata. Each is
// posted with its benchmark_instance_id, so the API applies the instance's own
// scope and returns the live score. The generation provider and model are the
// server's own configuration (GENERATION_PROVIDER, GENERATION_MODEL, ...); the
// script records what GET /models reports:
//   node scripts/capture-run.mjs [http://localhost:8000] --strata H1,H2,H3,H5 \
//     --out-dir src/run/fixtures/recorded
//
// The run id and timestamps are kept as the API gave them. The final results
// (GET /queries/{id}) are stored beside the events, so the evidence paths and
// source records the pipelines returned are part of the fixture.
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    strata: { type: 'string' },
    'out-dir': { type: 'string' },
  },
})
const BASE = positionals[0] ?? 'http://localhost:8000'
const STRATA = values.strata ? values.strata.split(',') : ['H1']
const OUT_DIR = values['out-dir']
if (values.strata && !OUT_DIR) throw new Error('--strata needs --out-dir')
const FIXTURE = 'src/run/fixtures/run-abc.json'
const CONFIGURATIONS = ['A', 'B', 'C']
const FINISHED = ['completed', 'failed', 'cancelled']
const POLL_MS = 500
const DEADLINE_MS = 1_800_000

async function api(path, init) {
  const response = await fetch(`${BASE}/api/v1${path}`, init)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return response.json()
}

async function capture(question, live) {
  const { run_id: runId } = await api('/queries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(live
        ? { benchmark_instance_id: question.instance_id }
        : { question: question.text }),
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
    throw new Error(
      `${runId} ended ${run.status}: ${JSON.stringify(run.error)}`,
    )
  }
  const { events } = await api(`/queries/${runId}/events`)
  return { runId, run, events }
}

const questions = await api('/demo/questions')
const find = (stratum) => {
  const question = questions.find((entry) => entry.stratum === stratum)
  if (!question) throw new Error(`the bank has no ${stratum} question`)
  return question
}

if (OUT_DIR) {
  mkdirSync(OUT_DIR, { recursive: true })
  const { generation } = await api('/models')
  for (const stratum of STRATA) {
    const question = find(stratum)
    const { runId, run, events } = await capture(question, true)
    const fixture = {
      instance_id: question.instance_id,
      question: question.text,
      stratum: question.stratum,
      run_id: runId,
      model: generation.model,
      captured_at: new Date().toISOString(),
      results: run,
      events,
    }
    const path = `${OUT_DIR}/${question.instance_id}.json`
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`)
    console.log(`${path}: ${runId}, ${events.length} events`)
  }
} else {
  const question = find('H1')
  const { runId, run, events } = await capture(question, false)
  const fixture = {
    run_id: runId,
    instance_id: question.instance_id,
    question: question.text,
    market_scope: question.market_scope,
    configurations: CONFIGURATIONS,
    results: run,
    events,
  }
  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`${FIXTURE}: ${runId}, ${events.length} events`)
}
