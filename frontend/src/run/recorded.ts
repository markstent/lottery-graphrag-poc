// Real runs of the four demo questions, captured from the API with a local
// model (scripts/capture-run.mjs --strata H1,H2,H3,H5). They are the offline
// Live Lab replay data and are stored exactly as the API returned them.
import type { components } from '../api/schema'
import h1 from './fixtures/recorded/L05-2026-INC_037.json'
import h2 from './fixtures/recorded/L09-2026-GAME_AT_05.json'
import h3 from './fixtures/recorded/L01-2026-GAME_AT_04.json'
import h5 from './fixtures/recorded/L15-2026-INC_041.json'
import type { RunEvent } from './reduce'

export interface RecordedRun {
  instance_id: string
  question: string
  stratum: string
  run_id: string
  model: string
  captured_at: string
  results: components['schemas']['QueryResults']
  events: RunEvent[]
}

export const RECORDED_RUNS: readonly RecordedRun[] = [
  h1,
  h2,
  h3,
  h5,
] as unknown as RecordedRun[]
