/** The label that stands beside numbers from a run that is not a whole-bank result. */

export function RunBadge({ label }: { label?: string }) {
  if (!label) return null
  return (
    <span className="mb-3 inline-block rounded-chip border border-border px-2 py-0.5 text-sm font-medium text-text-primary">
      {label}
    </span>
  )
}
