/** A single headline number with its interval and counts in muted text. */

import { formatNumber, pairsInGroups, plural } from './scale'

export function StatTile({
  label,
  value,
  unit,
  interval,
  n,
  groups,
  decimals = 1,
}: {
  label: string
  /** null is drawn as "no value", never as zero. */
  value: number | null
  unit: string
  /** Given low and high, drawn as given. */
  interval?: readonly [number, number]
  n?: number
  groups?: number
  decimals?: number
}) {
  const fmt = (v: number) => formatNumber(v, { decimals })
  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm text-text-secondary">{label}</div>
      <div className="flex items-baseline gap-2">
        {value === null ? (
          <span className="text-lg text-text-muted">no value</span>
        ) : (
          <span className="text-2xl font-semibold text-text-primary">
            {fmt(value)}
          </span>
        )}
        <span className="text-sm text-text-secondary">{unit}</span>
      </div>
      {interval ? (
        <div className="tabular text-sm text-text-muted">
          {`interval ${fmt(interval[0])} to ${fmt(interval[1])}`}
        </div>
      ) : null}
      {n !== undefined ? (
        <div className="tabular text-sm text-text-muted">
          {groups !== undefined ? pairsInGroups(n, groups) : plural(n, 'pair')}
        </div>
      ) : null}
    </div>
  )
}
