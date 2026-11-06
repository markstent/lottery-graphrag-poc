/**
 * The newest official run's outcomes, for the scoring chapter: found, missed
 * and extra records, and the answers by score. Only a full official run is
 * drawn, as on Overview; any other newest run reads as no official run. The
 * figures come from the API, so none is written into the copy.
 */

import { getBenchmarkOutcomes } from '../../api/client'
import { isFullOfficial, loadLatest } from '../../app/latest-run'
import { useLoad } from '../../app/use-load'
import { ErrorNote } from '../../components/error-note'
import { OutcomeBars } from '../../components/outcome-bars'

async function loadNewestOutcomes(signal: AbortSignal) {
  const latest = await loadLatest(signal)
  return latest && isFullOfficial(latest)
    ? await getBenchmarkOutcomes(latest.run_id, signal)
    : null
}

export function HelpOutcomes() {
  const load = useLoad(loadNewestOutcomes, 'help-outcomes')
  if (load.status === 'loading')
    return <p role="status">Loading the newest run's outcomes.</p>
  if (load.status === 'error')
    return <ErrorNote error={load.error} retry={load.retry} />
  if (load.data === null) return <p>No official run is published yet.</p>
  return <OutcomeBars outcomes={load.data} />
}
