/** The four recorded runs, loaded in full once, for tests that read their events and results. */

import {
  loadRecording,
  RECORDED_INDEX,
  type RecordedRun,
} from '../run/recorded'

export const RECORDINGS: readonly RecordedRun[] = await Promise.all(
  RECORDED_INDEX.map((run) => loadRecording(run.instance_id)),
)
