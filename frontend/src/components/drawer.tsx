/**
 * A modal drawer from the right edge, shared by Settings and the evidence
 * drawer. Focus moves into it on open, stays inside while it is open, and
 * returns to whatever opened it on close. Escape closes it.
 */

import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { focusableIn } from '../dom/focusable'

interface DrawerProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * Back to what opened the drawer. If that has gone (the screen redrew while
 * the drawer was open), the graph canvas's current node, else the main area.
 */
function returnFocus(opener: Element | null) {
  const target =
    (opener instanceof HTMLElement || opener instanceof SVGElement) &&
    opener.isConnected
      ? opener
      : (document.querySelector<HTMLElement>('[data-node-id][tabindex="0"]') ??
        document.getElementById('main'))
  target?.focus()
}

export function Drawer({ open, title, onClose, children }: DrawerProps) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const focusable = () => (dialog.current ? focusableIn(dialog.current) : [])
    focusable()[0]?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      const inside = dialog.current?.contains(document.activeElement) ?? false
      if (!inside || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus(opener)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-30 bg-grey-900/30"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel-reveal fixed inset-y-0 right-0 z-40 flex w-[32rem] max-w-full flex-col border-l border-border bg-surface shadow-overlay"
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-chip border border-border px-2 py-1 text-sm text-text-secondary hover:text-text-primary"
          >
            <X aria-hidden size={14} />
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}
