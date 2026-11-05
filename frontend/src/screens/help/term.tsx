/**
 * First-use help on a term: the first time a chapter uses one of its glossary
 * terms, the word is underlined with dots and its plain meaning shows on hover
 * and on keyboard focus. Escape hides it again without moving focus. The
 * meaning is in the page only while shown, so the chapter's own text is unchanged.
 */

import { useId, useState, type ReactNode } from 'react'

import { GLOSSARY_TERMS } from '../../copy/glossary'

/** A word that has a glossary meaning; without one it is drawn as plain text. */
export function Term({
  term,
  children,
}: {
  term: string
  children: ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const entry = GLOSSARY_TERMS.find(
    (candidate) => candidate.term.toLowerCase() === term.toLowerCase(),
  )
  if (!entry) return children
  return (
    <span className="relative">
      <span
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        className="cursor-help border-b border-dotted border-text-primary"
      >
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-10 mt-1 w-64 rounded-chip border border-border bg-surface px-3 py-2 text-sm font-normal text-text-primary shadow-overlay"
        >
          {entry.meaning}
        </span>
      )}
    </span>
  )
}
