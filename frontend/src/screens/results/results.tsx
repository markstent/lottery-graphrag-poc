/**
 * Results: the published benchmark runs, newest first. A stopgap list until
 * the full dashboard: each run's kind, label, date, selection and headlines,
 * with a link to its summary (the reproducibility fields).
 */

import type { Schemas } from '../../api/client'
import { listBenchmarks } from '../../api/client'
import { plainName } from '../../app/plain-words'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { Screen } from '../screen'

type Run = Schemas['BenchmarkRunOut']

const KIND_WORDS: Record<string, string> = {
  official: 'Official run',
  smoke: 'Quick check run',
  sweep: 'Depth sweep',
}

const kindWord = (kind: string) => KIND_WORDS[kind] ?? plainName(kind)

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

function selectionText({ strata, limit }: Run['selection']): string | null {
  if (strata == null && limit == null) return null
  const parts = [
    Array.isArray(strata)
      ? `strata: ${strata.map((name) => plainName(String(name))).join(', ')}`
      : 'all strata',
  ]
  if (typeof limit === 'number')
    parts.push(
      `at most ${limit} ${limit === 1 ? 'instance' : 'instances'} per question`,
    )
  return `Subset (${parts.join('; ')})`
}

function RunCard({ run }: { run: Run }) {
  const subset = selectionText(run.selection)
  const { headlines } = run
  const headingId = `run-${run.run_id}`
  return (
    <article
      aria-labelledby={headingId}
      className="rounded-card border border-hairline bg-surface p-4"
    >
      <h3 id={headingId} className="text-base font-semibold text-text-primary">
        {date(run.started_at)}
      </h3>
      <p className="mt-1 text-sm text-text-secondary">
        {kindWord(run.run_kind)}
        {run.label && ` - ${run.label}`}
      </p>
      {subset && (
        <p className="mt-1 text-sm font-medium text-text-primary">{subset}</p>
      )}
      {headlines.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-primary">
          {headlines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
      <a
        href={`/api/v1/benchmarks/${encodeURIComponent(run.run_id)}`}
        target="_blank"
        rel="noopener"
        className="mt-3 inline-block text-sm text-text-primary underline"
      >
        Reproducibility record (JSON)
      </a>
    </article>
  )
}

export function Results() {
  const load = useLoad(listBenchmarks, 'benchmark-runs')
  const empty = load.status === 'ready' && load.data.length === 0
  return (
    <Screen destination="results">
      <Panel
        title="Benchmark runs"
        state={empty ? 'empty' : load.status}
        message="No benchmark runs yet."
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      >
        {load.status === 'ready' && (
          <div className="space-y-3">
            {load.data.map((run) => (
              <RunCard key={run.run_id} run={run} />
            ))}
          </div>
        )}
      </Panel>
    </Screen>
  )
}
