/**
 * The frame every chart shares: a figure with its caption, the "Show as
 * table" twin, and the loading, empty, error and disabled states.
 * A loading chart keeps its previous render, dimmed, rather than collapsing.
 */

import { useState, type ReactNode, type Ref } from 'react'

export type ChartStatus = 'ready' | 'loading' | 'error'

export interface ChartStateProps {
  status?: ChartStatus
  /** Shown in place of the chart when status is "error". */
  error?: string
  disabled?: boolean
}

export function ChartFigure({
  title,
  description,
  status = 'ready',
  error,
  disabled = false,
  empty,
  legend,
  plotRef,
  overlay,
  table,
  children,
}: ChartStateProps & {
  title: string
  description?: string
  empty: boolean
  legend: ReactNode
  plotRef: Ref<HTMLDivElement>
  overlay: ReactNode
  table: ReactNode
  children: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  const failed = status === 'error'
  const body = failed ? (
    <p role="alert" className="py-8 text-base text-error">
      {error ?? 'The results could not be shown.'}
    </p>
  ) : empty ? (
    <p className="py-8 text-base text-text-secondary">
      {status === 'loading' ? 'Loading results.' : 'No results to show.'}
    </p>
  ) : asTable ? (
    table
  ) : (
    <div className="flex flex-col gap-3">
      {legend}
      <div ref={plotRef} className="relative">
        {children}
        {overlay}
      </div>
    </div>
  )
  return (
    <figure
      aria-busy={status === 'loading'}
      className={`m-0 flex flex-col gap-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <figcaption className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2 text-base font-semibold text-text-primary">
            {title}
            {status === 'loading' && !empty ? (
              <span className="text-sm font-normal text-text-secondary">
                Updating
              </span>
            ) : null}
          </div>
          {description ? (
            <div className="text-sm text-text-secondary">{description}</div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={disabled || failed || empty}
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="shrink-0 rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-text-muted"
        >
          {asTable ? 'Show as chart' : 'Show as table'}
        </button>
      </figcaption>
      <div
        className={
          status === 'loading' && !empty ? 'chart-updating' : undefined
        }
      >
        {body}
      </div>
    </figure>
  )
}
