/** How often each approach failed and how: each count sets the failure filter of the question table. */

import type { Schemas } from '../../api/client'
import { failureWords } from '../../app/plain-words'
import { PIPELINES } from '../../design/pipelines'
import { CAPTIONS, MEASURES, TABLE_HEADS } from '../../results/labels'
import { failureTotals } from '../../results/strata'
import { RunBadge } from './run-badge'

type Summary = Schemas['SummaryOut']

const CELL = 'tabular px-3 py-2 text-right'

export function FailurePanel({
  summary,
  badge,
  onFilter,
}: {
  summary: Summary
  badge?: string
  onFilter: (pipeline: string, cls: string) => void
}) {
  const totals = failureTotals(summary)
  const classes = [...new Set(totals.map(({ cls }) => cls))].sort()
  const count = (pipeline: string, cls: string) =>
    totals.find((t) => t.pipeline === pipeline && t.cls === cls)?.count ?? 0
  return (
    <div className="space-y-3">
      <RunBadge label={badge} />
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-sm text-text-primary">
          <caption className="sr-only">{CAPTIONS.failures}</caption>
          <thead>
            <tr className="border-b border-hairline text-left text-text-secondary">
              <th scope="col" className="py-2 pr-4 font-semibold">
                {TABLE_HEADS.failureKind}
              </th>
              {PIPELINES.map(({ id, label }) => (
                <th
                  key={id}
                  scope="col"
                  className="px-3 py-2 text-right font-semibold"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((cls) => (
              <tr key={cls} className="border-b border-hairline">
                <th
                  scope="row"
                  className="py-2 pr-4 text-left font-normal first-letter:uppercase"
                >
                  {failureWords(cls)}
                </th>
                {PIPELINES.map(({ id }) => {
                  const n = count(id, cls)
                  return (
                    <td key={id} className={CELL}>
                      {n === 0 ? (
                        0
                      ) : (
                        <button
                          type="button"
                          aria-label={`${id}, ${failureWords(cls)}, ${n}`}
                          onClick={() => onFilter(id, cls)}
                          className="rounded-chip border border-border px-2 py-0.5 hover:bg-surface-raised"
                        >
                          {n.toLocaleString('en-GB')}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="border-b border-hairline">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {MEASURES.unscored}
              </th>
              {PIPELINES.map(({ id }) => (
                <td key={id} className={CELL}>
                  {(summary.failures.generation[id] ?? 0).toLocaleString(
                    'en-GB',
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
