// Real runs of the four demo questions, captured from the API with a local
// model (scripts/capture-run.mjs --strata H1,H2,H3,H5). They are the offline
// Live Lab replay data and are stored exactly as the API returned them.
// The index is small and always loaded; a recording's events and results
// are a chunk of their own, fetched when that recording is chosen.
import type { components } from '../api/schema'
import index from './fixtures/recorded/index.json'
import { EVENT_TYPES } from '../api/event-types'
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
  /** The retrieval method the recording was made under, such as "0.3.0". */
  method: string
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

export class UnknownEventTypeError extends Error {
  constructor(instanceId: string, eventType: string, position: number) {
    super(
      `Recording ${instanceId} has an event of unknown type "${eventType}" at position ${position}.`,
    )
    this.name = 'UnknownEventTypeError'
  }
}

/** Returns the recording when every event is of a type the contract knows, so a stale capture fails here, not part way through a replay. */
export function checkRecording(run: RecordedRun): RecordedRun {
  const position = run.events.findIndex((e) => !(e.event_type in EVENT_TYPES))
  if (position >= 0)
    throw new UnknownEventTypeError(
      run.instance_id,
      run.events[position].event_type,
      position,
    )
  return run
}

/** Fetches one recording; rejects when the chunk cannot be loaded, has no such recording or holds an event the contract does not know. */
export function loadRecording(instanceId: string): Promise<RecordedRun> {
  const load = FILES[`./fixtures/recorded/${instanceId}.json`]
  return load
    ? load().then(checkRecording)
    : Promise.reject(new Error(`No recording for ${instanceId}.`))
}
