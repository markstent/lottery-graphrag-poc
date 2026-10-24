// Real runs of the four demo questions, captured from the API with a local
// model (scripts/capture-run.mjs --strata H1,H2,H3,H5). They are the offline
// Live Lab replay data and are stored exactly as the API returned them.
// The index is small and always loaded; a recording's events and results
// are a chunk of their own, fetched when that recording is chosen.
import type { components } from '../api/schema'
import index from './fixtures/recorded/index.json'
import type { RunEvent } from './reduce'

export interface RecordedRunSummary {
  instance_id: string
  question: string
  stratum: string
  /** The world the recording was captured on; its records belong to that world. */
  dataset_id: string
  run_id: string
  model: string
  captured_at: string
}

export interface RecordedRun extends RecordedRunSummary {
  results: components['schemas']['QueryResults']
  events: RunEvent[]
}

export const RECORDED_INDEX: readonly RecordedRunSummary[] = index

const FILES = import.meta.glob<RecordedRun>(
  ['./fixtures/recorded/*.json', '!./fixtures/recorded/index.json'],
  { import: 'default' },
)

/** Fetches one recording; rejects when the chunk cannot be loaded or has no such recording. */
export function loadRecording(instanceId: string): Promise<RecordedRun> {
  const load = FILES[`./fixtures/recorded/${instanceId}.json`]
  return load
    ? load()
    : Promise.reject(new Error(`No recording for ${instanceId}.`))
}
