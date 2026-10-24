/** Markets by pipelines: which markets the evidence each pipeline used came from. */

import { Check, Minus } from 'lucide-react'

import type { Schemas } from '../../api/client'
import { PIPELINES } from '../../design/pipelines'
import { coverage, MARKETS } from '../../run/coverage'

export function CoverageMatrix({
  results,
}: {
  results: Schemas['QueryResults']
}) {
  const reached = coverage(results)
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold text-text-primary">
        Market coverage
      </h3>
      <p className="text-sm text-text-secondary">
        A market is reached when used evidence comes from it.
      </p>
      <div className="overflow-hidden rounded-card border border-hairline bg-surface">
        <table
          aria-label="Market coverage"
          className="w-full table-fixed text-left"
        >
          <thead>
            <tr>
              <td className="w-48" />
              {PIPELINES.map(({ id, label, tint, strong }) => (
                <th
                  key={id}
                  scope="col"
                  className="px-4 py-2 text-sm font-semibold"
                  style={{ backgroundColor: tint, color: strong }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {MARKETS.map(({ id: market, name }) => (
              <tr key={market}>
                <th scope="row" className="px-4 py-2 text-sm font-medium">
                  {name}
                </th>
                {PIPELINES.map(({ id }) => {
                  const found = reached[id]
                  const Icon = found?.includes(market) ? Check : Minus
                  return (
                    <td key={id} className="px-4 py-2 text-sm">
                      {found === undefined ? (
                        <span className="text-text-muted">No result</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-text-primary">
                          <Icon aria-hidden size={16} />
                          {found.includes(market) ? 'Reached' : 'Not reached'}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
