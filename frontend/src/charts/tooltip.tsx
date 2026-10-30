/**
 * Hover and focus details for chart marks. `useMarkTips` owns what every
 * chart repeats: one tooltip at a time, a roving tabindex across the marks,
 * arrow keys to move, Escape to close.
 */

import {
  useCallback,
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
  place: Place
  side: Side
  /** Above a mark, the mark's centre; beside it, the offset from the near edge. */
  x: number
  y: number
  /** The mark's bottom edge, where a tooltip with no room above it goes. */
  bottom: number
  /** The part of the plot in view, in plot coordinates: all of it unless a box around it scrolls sideways. */
  view: { left: number; right: number; plot: number }
  /** Whether any of the mark is in view; a tooltip for a mark scrolled out of view is hidden. */
  inView: boolean
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

/** The least distance from a tooltip's centre to the edge of the view, before its width is known. */
const EDGE = 100

/** The nearest box around `el` that scrolls sideways, as a chart box does on a phone; null on a desktop. */
export function scrollBoxOf(el: Element): HTMLElement | null {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowX } = getComputedStyle(box)
    // A box that scrolls only up and down computes overflow-x to auto too, so
    // only one whose content is wider than it, checked on each use, counts.
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      box.scrollWidth > box.clientWidth
    )
      return box
  }
  return null
}

/** Where a tooltip for the mark `el` goes, in the coordinates of the plot `host`. */
function placement(
  host: HTMLElement,
  el: Element,
  index: number,
  content: TipContent,
  place: Place,
): Placed {
  const area = host.getBoundingClientRect()
  const box = el.getBoundingClientRect()
  const centre = box.left - area.left + box.width / 2
  const y = box.top - area.top
  const bottom = box.bottom - area.top
  const scroller = scrollBoxOf(host)
  const frame = scroller?.getBoundingClientRect()
  const view = {
    left: (frame ? Math.max(frame.left, area.left) : area.left) - area.left,
    right:
      (frame && scroller
        ? Math.min(frame.left + scroller.clientWidth, area.right)
        : area.right) - area.left,
    plot: area.width,
  }
  const inView =
    !scroller ||
    (box.right - area.left > view.left && box.left - area.left < view.right)
  if (place === 'beside') {
    // The roomier side within the view, which is the whole plot on a desktop.
    const left = area.width > 0 && centre > (view.left + view.right) / 2
    return {
      index,
      content,
      place,
      y,
      bottom,
      view,
      inView,
      side: left ? 'left' : 'right',
      x: left ? area.right - box.left + GAP : box.right - area.left + GAP,
    }
  }
  return {
    index,
    content,
    place,
    x: centre,
    y,
    bottom,
    view,
    inView,
    side: 'above',
  }
}

/**
 * Where a tooltip `width` wide goes across, kept inside the view where it
 * fits: its centre above or below a mark, its left edge to the right of one,
 * or its distance from the plot's right edge to the left of one.
 */
function placedX(placed: Placed, width: number | undefined): number {
  const { view, x, side } = placed
  if (view.right - view.left <= 0) return x
  if (side === 'above') {
    const half = Math.max(EDGE, (width ?? 0) / 2)
    if (view.right - view.left < 2 * half) return (view.left + view.right) / 2
    return Math.min(Math.max(x, view.left + half), view.right - half)
  }
  if (width === undefined) return x
  if (side === 'right')
    return Math.max(view.left, Math.min(x, view.right - width))
  return Math.max(
    view.plot - view.right,
    Math.min(x, view.plot - view.left - width),
  )
}

function tipElement({
  id,
  index,
  ref,
  content,
  x,
  y,
  side,
}: {
  id: string
  /** A new mark draws a new tooltip, which is measured before it is shown. */
  index: number
  ref: Ref<HTMLDivElement>
  content: TipContent
  x: number
  y: number
  side: Side
}) {
  return (
    <div
      key={index}
      id={id}
      ref={ref}
      role="tooltip"
      style={{
        // A tooltip beside a mark on the right half hangs from the right edge, so it keeps its width.
        ...(side === 'left' ? { right: x } : { left: x }),
        top: y,
        transform: TRANSFORM[side],
      }}
      className="pointer-events-none absolute z-10 w-max min-w-36 max-w-64 rounded-chip border border-hairline bg-surface px-3 py-2 text-sm shadow-overlay"
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
  // State-held, like the host, so its size is watched once it is drawn.
  const [tip, setTip] = useState<HTMLDivElement | null>(null)
  const [tipSize, setTipSize] = useState<{
    width: number
    height: number
  } | null>(null)
  // Measured as it mounts, so its side and centre come from its own size
  // before it is painted, never from the tooltip shown before it.
  const measureTip = useCallback((el: HTMLDivElement | null) => {
    setTip(el)
    setTipSize(el ? { width: el.offsetWidth, height: el.offsetHeight } : null)
  }, [])
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
    const watch = new ResizeObserver(() =>
      setTipSize({ width: tip.offsetWidth, height: tip.offsetHeight }),
    )
    watch.observe(tip)
    return () => watch.disconnect()
  }, [tip])

  // A box that scrolls sideways moves the marks under the tooltip, so it
  // follows them; the box is looked for each time a tooltip opens, because
  // whether it scrolls depends on the width of the screen.
  const open = placed !== null
  useEffect(() => {
    const scroller = open && host && scrollBoxOf(host)
    if (!host || !scroller) return
    const follow = () =>
      setPlaced((was) => {
        const el = was && marks.current[was.index]
        return was && el
          ? placement(host, el, was.index, was.content, was.place)
          : null
      })
    scroller.addEventListener('scroll', follow, { passive: true })
    return () => scroller.removeEventListener('scroll', follow)
  }, [host, open])

  function show(el: Element, index: number, content: TipContent, place: Place) {
    if (host) setPlaced(placement(host, el, index, content, place))
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
      'aria-describedby':
        placed?.index === index && placed.inView ? tipId : undefined,
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
    placed?.side === 'above' &&
    tipSize !== null &&
    placed.y < tipSize.height + GAP
  const tooltip: ReactNode = placed?.inView
    ? tipElement({
        id: tipId,
        index: placed.index,
        ref: measureTip,
        content: placed.content,
        x: placedX(placed, tipSize?.width),
        y: below ? placed.bottom : placed.y,
        side: below ? 'below' : placed.side,
      })
    : null
  /** `width` is the measured width of the plot area, null until it is measured. */
  return { hostRef: setHost, width, tooltip, markProps }
}
