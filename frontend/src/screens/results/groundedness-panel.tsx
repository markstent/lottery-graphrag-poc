/** How far each approach's answers are held by the blocks they cite: descriptive, never tested (D-088). */

import { DataTable, type DataTableRow } from '../../charts/data-table'
import { CAPTIONS, TABLE_HEADS } from '../../results/labels'
import { RunBadge } from './run-badge'

export const GROUNDEDNESS_NOTE =
  'Descriptive, not tested: of the ids, dates and numbers an answer states, the share its cited blocks hold, and the share no shown block holds.'

export function GroundednessPanel({
  rows,
  badge,
}: {
  /** From `groundednessRows`; the panel is shown only for a run that has them. */
  rows: readonly DataTableRow[]
  badge?: string
}) {
  return (
    <div className="space-y-2">
      <RunBadge label={badge} />
      <p className="max-w-prose text-sm text-text-secondary">
        {GROUNDEDNESS_NOTE}
      </p>
      <DataTable
        caption={CAPTIONS.groundedness}
        rowHeader={TABLE_HEADS.kindApproach}
        columns={[
          TABLE_HEADS.supported,
          TABLE_HEADS.unsupported,
          TABLE_HEADS.questions,
        ]}
        rows={rows}
      />
    </div>
  )
}
