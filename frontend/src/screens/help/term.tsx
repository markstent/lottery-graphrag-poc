/**
 * First-use help on a term: the first time a chapter uses one of its glossary
 * terms, the word is underlined with dots and its plain meaning shows on hover
 * and on keyboard focus. The pointer can move onto the meaning, and Escape
 * hides it from anywhere. The meaning is always in the page and linked to the
 * word with aria-describedby, hidden from sight until shown.
 */

import { useEffect, useId, useState, type ReactNode } from 'react'

import { glossaryEntry } from '../../copy/glossary'

/** A word that has a glossary meaning; without one it is drawn as plain text. */
export function Term({
  term,
  children,
}: {
  term: string
  children: ReactNode
}) {
  const id = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const entry = glossaryEntry(term)
  const open = (hovered || focused) && !dismissed
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
  if (!entry) return children
  return (
    <span
      className="relative"
      onMouseEnter={() => {
        setDismissed(false)
        setHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={id}
        onFocus={() => {
          setDismissed(false)
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        className="cursor-help border-b border-dotted border-text-primary"
      >
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute left-0 top-full z-10 w-64 max-w-[min(16rem,80vw)] rounded-chip border border-border bg-surface px-3 py-2 text-sm font-normal text-text-primary shadow-overlay"
      >
        {entry.meaning}
      </span>
    </span>
  )
}
