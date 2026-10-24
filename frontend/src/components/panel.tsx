/**
 * One look for every state of a panel: ready, loading, empty, error and
 * disabled. The loading state draws a skeleton of the content to come (the
 * caller's `skeleton`, or three bars), with no motion under reduced motion.
 */

import { Inbox, Lock, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { ApiError } from '../api/http'

export type PanelState = 'ready' | 'loading' | 'empty' | 'error' | 'disabled'

interface PanelProps {
  state: PanelState
  title: string
  /** One sentence on what the panel is for. */
  purpose?: string
  /** Why the panel is empty or disabled. */
  message?: string
  error?: Error
  onRetry?: () => void
  /** A further button in the error state, such as reloading the page. */
  action?: { label: string; onClick: () => void }
  skeleton?: ReactNode
  /** A control in the heading row, whatever the state. */
  headerAction?: ReactNode
  /** Content between the heading and the state's own content, whatever the state. */
  above?: ReactNode
  children?: ReactNode
}

export function SkeletonBar({ className = 'w-full' }: { className?: string }) {
  return <div className={`skeleton-bar h-4 rounded-chip ${className}`} />
}

const DEFAULT_SKELETON = (
  <div className="space-y-3">
    <SkeletonBar className="w-2/3" />
    <SkeletonBar />
    <SkeletonBar className="w-5/6" />
  </div>
)

export function Notice({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-sm text-text-secondary">
      <span aria-hidden className="mt-0.5 shrink-0">
        {icon}
      </span>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

export function Panel({
  state,
  title,
  purpose,
  message,
  error,
  onRetry,
  action,
  skeleton = DEFAULT_SKELETON,
  headerAction,
  above,
  children,
}: PanelProps) {
  const retryable = error instanceof ApiError && error.retryable && onRetry

  return (
    <section
      aria-label={title}
      aria-busy={state === 'loading' ? true : undefined}
      className="rounded-card border border-hairline bg-surface p-4"
    >
      {headerAction ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          {headerAction}
        </div>
      ) : (
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      )}
      {purpose && <p className="mt-1 text-sm text-text-secondary">{purpose}</p>}
      {above && <div className="mt-3">{above}</div>}
      <div className="mt-3">
        {state === 'ready' && children}
        {state === 'loading' && (
          <div role="status">
            <span className="sr-only">Loading {title}</span>
            {skeleton}
          </div>
        )}
        {state === 'empty' && (
          <Notice icon={<Inbox size={16} />}>
            <p>{message ?? 'Nothing to show yet.'}</p>
          </Notice>
        )}
        {state === 'disabled' && (
          <Notice icon={<Lock size={16} />}>
            <p>{message ?? 'Not available.'}</p>
          </Notice>
        )}
        {state === 'error' && (
          <div role="alert">
            <Notice icon={<TriangleAlert size={16} className="text-error" />}>
              <p className="text-text-primary">
                {error?.message ?? 'Something went wrong.'}
              </p>
              {retryable && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-chip border border-border px-3 py-1 text-text-primary hover:bg-surface-raised"
                >
                  Retry
                </button>
              )}
              {action && (
                <button
                  type="button"
                  onClick={action.onClick}
                  className="rounded-chip border border-border px-3 py-1 text-text-primary hover:bg-surface-raised"
                >
                  {action.label}
                </button>
              )}
            </Notice>
          </div>
        )}
      </div>
    </section>
  )
}
