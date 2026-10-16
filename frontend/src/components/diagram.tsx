/**
 * Inline SVG diagram primitives shared by the documentation screens.
 * Token-styled (no hard-coded colours), sized by viewBox so they scale,
 * and always carrying <title>/<desc> text alternatives
 * (docs/ux/accessibility.md: textual alternatives for graph information).
 */

import { createContext, useContext, useId } from 'react'

const MarkerContext = createContext<string>('')

export function Box({
  x,
  y,
  w,
  h,
  title,
  lines,
  accent,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  lines?: string[]
  accent?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill="var(--color-surface-raised)"
        stroke={accent ? 'var(--color-graph)' : 'var(--color-border)'}
        strokeWidth={accent ? 1.5 : 1}
      />
      <text
        x={x + w / 2}
        y={y + 20}
        textAnchor="middle"
        fill="var(--color-text-primary)"
        fontSize={12}
        fontWeight={600}
      >
        {title}
      </text>
      {(lines ?? []).map((line, index) => (
        <text
          key={line}
          x={x + w / 2}
          y={y + 38 + index * 14}
          textAnchor="middle"
          fill="var(--color-text-secondary)"
          fontSize={10}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

export function Arrow({
  x1,
  y1,
  x2,
  y2,
  label,
  dashed,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
  dashed?: boolean
}) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-text-muted)"
        strokeWidth={1}
        strokeDasharray={dashed ? '4 3' : undefined}
        markerEnd={`url(#${useContext(MarkerContext)})`}
      />
      {label && (
        <text
          x={mx}
          y={my - 4}
          textAnchor="middle"
          fill="var(--color-text-muted)"
          fontSize={9}
        >
          {label}
        </text>
      )}
    </g>
  )
}

/** Stable per-diagram marker id so multiple SVGs never clash. */
function useMarkerId() {
  const id = useId()
  return `diagram-arrow-${id.replace(/[^a-zA-Z0-9-]/g, '')}`
}

export function Diagram({
  title,
  description,
  children,
  height,
  maxWidth = 820,
}: {
  title: string
  description: string
  children: React.ReactNode
  height: number
  maxWidth?: number
}) {
  const markerId = useMarkerId()
  return (
    <figure className="rounded-card border border-border bg-surface p-4">
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 760 ${height}`}
        style={{ maxWidth, width: '100%', height: 'auto', display: 'block' }}
      >
        <title>{title}</title>
        <desc>{description}</desc>
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-muted)" />
          </marker>
        </defs>
        <MarkerContext.Provider value={markerId}>
          {children}
        </MarkerContext.Provider>
      </svg>
      <figcaption className="mt-2 text-xs leading-relaxed text-muted">
        {description}
      </figcaption>
    </figure>
  )
}
