/**
 * Hover and focus details for chart marks. `useMarkTips` owns what every
 * chart repeats: one tooltip at a time, a roving tabindex across the marks,
 * arrow keys to move, Escape to close.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react'

import { pipeline, type PipelineId } from '../design/pipelines'

export interface TipRow {
  pipeline?: PipelineId
  value: string
  label: string
}

export interface TipContent {
  title: string
  rows: readonly TipRow[]
}

interface Placed {
  index: number
  content: TipContent
  x: number
  y: number
  side: Side
  /** The mark's bottom edge, where a tooltip with no room above it goes. */
  bottom: number
}

/** The space between a tooltip and its mark, in pixels. */
const GAP = 8

/**
 * Where the tooltip sits against its mark: above it, below it when the plot
 * has no room above (a box that scrolls on a phone clips anything over its
 * top), or beside it on the roomier side.
 */
type Side = 'above' | 'below' | 'right' | 'left'

const TRANSFORM: Record<Side, string> = {
  above: `translate(-50%, calc(-100% - ${GAP}px))`,
  below: `translate(-50%, ${GAP}px)`,
  right: 'none',
  left: 'none',
}

/** 'above' sits over the mark; 'beside' keeps clear of everything above a tall mark. */
type Place = 'above' | 'beside'

const EDGE = 100

function tipElement({
  id,
  ref,
  content,
  x,
  y,
  side,
}: {
  id: string
  ref: Ref<HTMLDivElement>
  content: TipContent
  x: number
  y: number
  side: Side
}) {
  return (
    <div
      id={id}
      ref={ref}
      role="tooltip"
      style={{
        // A tooltip beside a mark on the right half hangs from the right edge, so it keeps its width.
        ...(side === 'left' ? { right: x } : { left: x }),
        top: y,
        transform: TRANSFORM[side],
      }}
      className="pointer-events-none absolute z-10 min-w-36 max-w-64 rounded-chip border border-hairline bg-surface px-3 py-2 text-sm shadow-overlay"
    >
      <div className="text-text-secondary">{content.title}</div>
      {content.rows.map((row) => (
        <div key={row.label} className="mt-1 flex items-baseline gap-2">
          {row.pipeline ? (
            <svg
              aria-hidden="true"
              width={12}
              height={4}
              className="shrink-0 self-center"
            >
              <line
                x1={0}
                x2={12}
                y1={2}
                y2={2}
                stroke={pipeline(row.pipeline).hue}
                strokeWidth={3}
              />
            </svg>
          ) : null}
          <span className="tabular font-semibold text-text-primary">
            {row.value}
          </span>
          <span className="text-text-secondary">{row.label}</span>
        </div>
      ))}
    </div>
  )
}

export function useMarkTips(count: number, disabled: boolean) {
  const tipId = useId()
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const marks = useRef<(SVGElement | null)[]>([])
  const [current, setCurrent] = useState(0)
  const [placed, setPlaced] = useState<Placed | null>(null)
  // State-held, like the host, so its height is watched once it is drawn.
  const [tip, setTip] = useState<HTMLDivElement | null>(null)
  const [tipHeight, setTipHeight] = useState<number | null>(null)
  const active = Math.min(current, Math.max(count - 1, 0))

  // The host is a state-held element so the width follows it in and out of the table view.
  useEffect(() => {
    if (!host) return
    const watch = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    )
    watch.observe(host)
    return () => watch.disconnect()
  }, [host])

  useEffect(() => {
    if (!tip) return
    const watch = new ResizeObserver(() => setTipHeight(tip.offsetHeight))
    watch.observe(tip)
    return () => watch.disconnect()
  }, [tip])

  function show(el: Element, index: number, content: TipContent, place: Place) {
    if (!host) return
    const area = host.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const centre = box.left - area.left + box.width / 2
    const y = box.top - area.top
    const bottom = box.bottom - area.top
    if (place === 'beside') {
      const left = area.width > 0 && centre > area.width / 2
      setPlaced({
        index,
        content,
        y,
        bottom,
        side: left ? 'left' : 'right',
        x: left ? area.right - box.left + GAP : box.right - area.left + GAP,
      })
      return
    }
    const x =
      area.width > 0
        ? Math.min(Math.max(centre, EDGE), area.width - EDGE)
        : centre
    setPlaced({ index, content, x, y, bottom, side: 'above' })
  }

  function markProps(
    index: number,
    label: string,
    content: TipContent,
    place: Place = 'above',
  ) {
    if (disabled) return {}
    return {
      ref: (el: SVGElement | null) => {
        marks.current[index] = el
      },
      role: 'graphics-symbol',
      tabIndex: index === active ? 0 : -1,
      'aria-label': label,
      'aria-describedby': placed?.index === index ? tipId : undefined,
      onFocus: (e: FocusEvent<SVGElement>) => {
        setCurrent(index)
        show(e.currentTarget, index, content, place)
      },
      onBlur: () => setPlaced(null),
      onPointerEnter: (e: PointerEvent<SVGElement>) =>
        show(e.currentTarget, index, content, place),
      onPointerLeave: (e: PointerEvent<SVGElement>) => {
        if (document.activeElement !== e.currentTarget) setPlaced(null)
      },
      onKeyDown: (e: KeyboardEvent<SVGElement>) => {
        if (e.key === 'Escape') return setPlaced(null)
        const next =
          e.key === 'ArrowRight' || e.key === 'ArrowDown'
            ? Math.min(index + 1, count - 1)
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
              ? Math.max(index - 1, 0)
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? count - 1
                  : null
        if (next === null) return
        e.preventDefault()
        marks.current[next]?.focus()
      },
    }
  }

  // A tooltip above a mark too near the plot's top would stick out of it,
  // and a box that scrolls on a phone cuts it off, so it goes below the mark.
  const below =
    placed?.side === 'above' && tipHeight !== null && placed.y < tipHeight + GAP
  const tooltip: ReactNode = placed
    ? tipElement({
        id: tipId,
        ref: setTip,
        content: placed.content,
        x: placed.x,
        y: below ? placed.bottom : placed.y,
        side: below ? 'below' : placed.side,
      })
    : null
  /** `width` is the measured width of the plot area, null until it is measured. */
  return { hostRef: setHost, width, tooltip, markProps }
}
