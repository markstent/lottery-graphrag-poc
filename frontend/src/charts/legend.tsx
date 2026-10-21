/**
 * The key to the pipeline colours; present whenever a chart has two or more
 * series, or has a row that was not tested (a hollow grey dot).
 */

import { pipeline, type PipelineId } from '../design/pipelines'
import { TOKENS } from '../design/tokens'

export function Legend({
  series,
  notTested = false,
}: {
  series: readonly PipelineId[]
  notTested?: boolean
}) {
  if (series.length < 2 && !notTested) return null
  return (
    <ul
      aria-label="Key to the pipelines"
      className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-primary"
    >
      {series.map((id) => (
        <li key={id} className="flex items-center gap-2">
          <svg aria-hidden="true" width={12} height={12}>
            <rect width={12} height={12} rx={2} fill={pipeline(id).hue} />
          </svg>
          {pipeline(id).label}
        </li>
      ))}
      {notTested ? (
        <li className="flex items-center gap-2">
          <svg aria-hidden="true" width={12} height={12}>
            <circle
              cx={6}
              cy={6}
              r={4}
              fill={TOKENS['color-surface']}
              stroke={TOKENS['color-grey-500']}
              strokeWidth={2}
            />
          </svg>
          not tested
        </li>
      ) : null}
    </ul>
  )
}
