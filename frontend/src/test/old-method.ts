/**
 * Makes a recording read as one made under the old method (v0.2), which named
 * no method and scored evidence on F1. The four recordings in the repository
 * are of method v0.3, so a test of how the Live Lab reads an old one starts here.
 */

import {
  RECORDED_INDEX,
  type RecordedRun,
  type RecordedRunSummary,
} from '../run/recorded'

/** The recording as the old method made it: no method, F1 in place of recall. */
export function asOldMethod(run: RecordedRun): RecordedRun {
  const old = structuredClone(run)
  delete old.method
  for (const own of Object.values(old.results.score?.per_pipeline ?? {})) {
    own.evidence_f1 = own.evidence_recall ?? null
    own.evidence_recall = null
  }
  return old
}

/** Makes the index name no method for one recording; returns the call that undoes it. */
export function indexAsOldMethod(instanceId: string): () => void {
  const entry = RECORDED_INDEX.find(
    (run) => run.instance_id === instanceId,
  ) as { -readonly [K in keyof RecordedRunSummary]: RecordedRunSummary[K] }
  const { method } = entry
  delete entry.method
  return () => {
    entry.method = method
  }
}
