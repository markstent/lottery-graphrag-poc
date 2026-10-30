/** The run picker and the run history: the same list, as a select and as compact links. */

import type { Schemas } from '../../api/client'
import { kindWord } from '../../app/run-kinds'
import { hrefFor } from '../../app/router'
import { standingWord } from '../../results/runs'

type Run = Schemas['BenchmarkRunOut']

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** "date - kind word - label". */
const runText = (run: Run) =>
  [date(run.started_at), kindWord(run.run_kind), run.label]
    .filter(Boolean)
    .join(' - ')

export function RunPicker({
  runs,
  selected,
}: {
  /** Newest first. */
  runs: readonly Run[]
  /** The shown run's id; null when the address names a run that is not published. */
  selected: string | null
}) {
  const current = runs.find((run) => run.run_id === selected)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="run-picker"
          className="text-sm font-semibold text-text-primary"
        >
          Run
        </label>
        <select
          id="run-picker"
          value={selected ?? ''}
          onChange={(event) => {
            window.location.hash = hrefFor('results', {
              run: event.target.value,
            })
          }}
          className="max-w-full rounded-chip border border-border bg-surface px-3 py-1 text-sm text-text-primary"
        >
          {current ? null : (
            <option value="" disabled>
              Choose
            </option>
          )}
          {runs.map((run) => (
            <option key={run.run_id} value={run.run_id}>
              {runText(run)}
            </option>
          ))}
        </select>
        {current && (
          <span className="text-sm font-medium text-text-primary">
            {standingWord(current)}
          </span>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-text-primary">
          All runs
        </summary>
        <ul className="mt-2 divide-y divide-hairline text-sm">
          {runs.map((run) => (
            <li key={run.run_id}>
              <a
                href={hrefFor('results', { run: run.run_id })}
                aria-current={run.run_id === selected ? 'true' : undefined}
                className={`flex flex-wrap justify-between gap-x-4 py-1 text-text-primary hover:bg-surface-raised ${run.run_id === selected ? 'font-semibold' : ''}`}
              >
                <span>{runText(run)}</span>
                <span className="text-text-secondary">{standingWord(run)}</span>
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
