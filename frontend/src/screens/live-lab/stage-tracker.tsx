/** One pipeline's steps in order, each with its status in words and icon, and its time. */

import {
  Ban,
  Circle,
  CircleCheck,
  CircleDot,
  CircleX,
  Minus,
  type LucideIcon,
} from 'lucide-react'

import { formatDuration } from './format'
import type { StageRow, StageRowStatus } from './columns'

const STATUS: Record<
  StageRowStatus,
  { word: string; icon: LucideIcon; tone: string }
> = {
  waiting: { word: 'Waiting', icon: Circle, tone: 'text-text-muted' },
  running: { word: 'Running', icon: CircleDot, tone: 'text-text-primary' },
  done: { word: 'Done', icon: CircleCheck, tone: 'text-success' },
  failed: { word: 'Failed', icon: CircleX, tone: 'text-error' },
  cancelled: { word: 'Cancelled', icon: Ban, tone: 'text-warning' },
  'not-run': { word: 'Not run', icon: Minus, tone: 'text-text-muted' },
  'not-reached': { word: 'Not reached', icon: Minus, tone: 'text-text-muted' },
}

export function StageTracker({ rows }: { rows: StageRow[] }) {
  return (
    <ol aria-label="Steps" className="space-y-1.5">
      {rows.map((row) => {
        const { word, icon: Icon, tone } = STATUS[row.status]
        return (
          <li
            key={row.stage}
            className="flex items-center gap-2 text-sm text-text-primary"
          >
            <Icon aria-hidden size={16} className={`shrink-0 ${tone}`} />
            <span className="font-medium">{row.label}</span>
            <span className="tabular ml-auto text-text-secondary">
              {word}
              {row.durationMs !== null && row.durationMs > 0
                ? ` · ${formatDuration(row.durationMs)}`
                : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
