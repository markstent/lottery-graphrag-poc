/**
 * The method a run was made under, in words, with the run's own declaration
 * of the method change beside it when it has one. Text, never colour alone.
 */

import { methodBadge } from '../app/method'

export function MethodBadge({
  method,
  note,
}: {
  /** The method the run was made under, as the API reports it. */
  method: string
  /** The summary's `method_note`, shown verbatim; null for a v0.2 run. */
  note: string | null | undefined
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="inline-block rounded-chip border border-border px-2 py-0.5 text-sm font-medium text-text-primary">
        {methodBadge(method)}
      </span>
      {note && (
        <span className="max-w-prose text-sm text-text-secondary">{note}</span>
      )}
    </div>
  )
}
