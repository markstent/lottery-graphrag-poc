/**
 * The pieces Help's small pictures share: the frame that makes one picture
 * one image with a text alternative, a box with one or more centred lines,
 * and a connector that ends in an arrow. The sizes and tones are in
 * `style.ts`.
 */

import { useId, type ReactNode } from 'react'

import { BASE_PX, BOX_H, FONT, SHARED, type Tone } from './style'

const LINE_STEP = 19

/**
 * One picture: drawn in a box `width` by `height`, hidden from assistive
 * technology, and read out as `label`. `children` gets the arrow marker's URL.
 */
export function Picture({
  label,
  width,
  height,
  children,
}: {
  label: string
  width: number
  height: number
  children: (arrow: string) => ReactNode
}) {
  const marker = `${useId().replace(/[^\w-]/g, '')}-arrow`
  return (
    <figure className="text-sm">
      <div role="img" aria-label={label}>
        <svg
          aria-hidden
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `${width / BASE_PX}em`, maxWidth: '100%' }}
          className="h-auto"
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerUnits="userSpaceOnUse"
              markerWidth={8}
              markerHeight={8}
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" fill={SHARED.stroke} />
            </marker>
          </defs>
          {children(`url(#${marker})`)}
        </svg>
      </div>
    </figure>
  )
}

/** A rounded box with its lines centred; with two or more lines the first is bold. */
export function Box({
  x,
  y,
  w,
  h = BOX_H,
  lines,
  tone = SHARED,
}: {
  x: number
  y: number
  w: number
  h?: number
  lines: readonly string[]
  tone?: Tone
}) {
  const first = y + h / 2 - ((lines.length - 1) * LINE_STEP) / 2
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={tone.fill}
        stroke={tone.stroke}
        strokeWidth={2}
      />
      {lines.map((line, index) => (
        <text
          key={line}
          x={x + w / 2}
          y={first + index * LINE_STEP}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={FONT}
          fontWeight={index === 0 && lines.length > 1 ? 600 : 400}
          fill={tone.text}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

/** A connector; `arrow` is the marker's URL when it ends on a box. */
export function Line({ d, arrow }: { d: string; arrow?: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={SHARED.stroke}
      strokeWidth={2}
      markerEnd={arrow}
    />
  )
}
