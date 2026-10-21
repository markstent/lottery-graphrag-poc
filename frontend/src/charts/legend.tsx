/** The key to the pipeline colours; present whenever a chart has two or more series. */

import { pipeline, type PipelineId } from '../design/pipelines'

export function Legend({ series }: { series: readonly PipelineId[] }) {
  if (series.length < 2) return null
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
    </ul>
  )
}
