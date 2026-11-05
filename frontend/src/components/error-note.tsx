/**
 * An error inside part of a screen, in the panel look: the message and a
 * Retry button. For a part that has no panel of its own to show its error.
 */

import { TriangleAlert } from 'lucide-react'

import { Notice } from './panel'

export function ErrorNote({
  error,
  retry,
}: {
  error: Error
  retry: () => void
}) {
  return (
    <div role="alert">
      <Notice icon={<TriangleAlert size={16} className="text-error" />}>
        <p className="text-text-primary">{error.message}</p>
        <button
          type="button"
          onClick={retry}
          className="rounded-chip border border-border px-3 py-1 text-text-primary hover:bg-surface-raised"
        >
          Retry
        </button>
      </Notice>
    </div>
  )
}
