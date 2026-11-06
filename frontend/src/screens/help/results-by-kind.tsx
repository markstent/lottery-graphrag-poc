/**
 * The newest official run by kind of question, for chapter 12: Overview's
 * chart and switch, read through Overview's loader, so the figures come from
 * the API and none is written into the copy.
 */

import { loadOverview, verdictFrom } from '../../app/latest-run'
import { useLoad } from '../../app/use-load'
import { ErrorNote } from '../../components/error-note'
import { KindChart } from '../../components/kind-chart'

export function HelpResultsByKind() {
  const load = useLoad(loadOverview, 'help-results-by-kind')
  if (load.status === 'loading')
    return (
      <p role="status">Loading the newest run's scores by kind of question.</p>
    )
  if (load.status === 'error')
    return <ErrorNote error={load.error} retry={load.retry} />
  const verdict = verdictFrom(load.data.latest, load.data.combined)
  if (verdict.kind === 'none') return <p>No official run is published yet.</p>
  if (verdict.kinds.answer.length === 0)
    return <p>The newest official run has no scores by kind of question.</p>
  const clear = [
    ...verdict.findings.filter((f) => f.kind === 'clear'),
    ...(verdict.judges?.findings ?? []),
  ]
  return <KindChart kinds={verdict.kinds} clear={clear} />
}
