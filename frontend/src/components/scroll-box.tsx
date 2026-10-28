/**
 * A box for a table wider than the page, as on a phone: the table scrolls
 * sideways inside it and the page keeps its width. While its content is wider
 * than the box, the box is a named group that takes keyboard focus (with the
 * shared focus ring), so the arrow keys scroll it; when everything fits, as on
 * a desktop, it is a plain box with no name, so a screen reader does not
 * announce the table twice, and not a tab stop. It watches its content as it
 * is replaced, such as a table arriving after a loading line. `relative`
 * keeps visually hidden text inside the box.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

export function ScrollBox({
  label,
  className = '',
  children,
}: {
  /** Names the box for a screen reader while it scrolls, such as "Market coverage table". */
  label: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useEffect(() => {
    const box = ref.current
    if (box === null) return
    const check = () => setScrolls(box.scrollWidth > box.clientWidth)
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
  }, [])
  return (
    <div
      ref={ref}
      role={scrolls ? 'group' : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={`relative overflow-x-auto ${className}`}
    >
      {children}
    </div>
  )
}
