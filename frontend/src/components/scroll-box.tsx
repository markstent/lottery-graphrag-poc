/**
 * A box whose content may not fit and scrolls inside it: by default a table
 * wider than the page, as on a phone, which scrolls sideways while the page
 * keeps its width; with `axis="y"` text taller than a capped height, such as
 * a long answer. While its content does not fit, the box is a named group
 * that takes keyboard focus (with the shared focus ring), so the arrow keys
 * scroll it; when everything fits it is a plain box with no name, so a screen
 * reader does not announce the content twice, and not a tab stop. It watches
 * its content as it is replaced, such as a table arriving after a loading
 * line. `relative` keeps visually hidden text inside the box.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

export function ScrollBox({
  label,
  axis = 'x',
  className = '',
  children,
}: {
  /** Names the box for a screen reader while it scrolls, such as "Market coverage table". */
  label: string
  /** The direction the content may overflow in; a `y` box needs a height cap in `className`. */
  axis?: 'x' | 'y'
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useEffect(() => {
    const box = ref.current
    if (box === null) return
    const check = () =>
      setScrolls(
        axis === 'x'
          ? box.scrollWidth > box.clientWidth
          : box.scrollHeight > box.clientHeight,
      )
    check()
    const watch = new ResizeObserver(check)
    const observeAll = () => {
      watch.disconnect()
      watch.observe(box)
      for (const child of box.children) watch.observe(child)
    }
    observeAll()
    const replaced = new MutationObserver(() => {
      observeAll()
      check()
    })
    replaced.observe(box, { childList: true })
    return () => {
      replaced.disconnect()
      watch.disconnect()
    }
  }, [axis])
  return (
    <div
      ref={ref}
      role={scrolls ? 'group' : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={`relative ${axis === 'x' ? 'overflow-x-auto' : 'overflow-y-auto'} ${className}`}
    >
      {children}
    </div>
  )
}
