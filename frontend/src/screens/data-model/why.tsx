/**
 * How each layer of the data model is built, in plain words above each tab's
 * map (D-101, D-113): what is in it, where it comes from and how a search
 * uses it. The counts and limits come from the API, so the text follows the
 * model it describes. Each panel folds away (D-114), so the map below can be
 * reached without scrolling past it; the choice is kept for the reader.
 */

import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
  SCENARIOS_ABOUT,
  WAREHOUSE_ABOUT,
  graphAbout,
  ontologyAbout,
  type AboutCopy,
  type AboutGroup,
} from './about-copy'

const FOLDED_KEY = (title: string) => `data-model-folded:${title}`

function readFolded(title: string): boolean {
  try {
    return window.localStorage.getItem(FOLDED_KEY(title)) === '1'
  } catch {
    return false
  }
}

function keepFolded(title: string, folded: boolean) {
  try {
    if (folded) window.localStorage.setItem(FOLDED_KEY(title), '1')
    else window.localStorage.removeItem(FOLDED_KEY(title))
  } catch {
    // Storage can be blocked; the panel then opens each visit.
  }
}

/** A panel that folds to its title, open until the reader folds it. */
function About({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => !readFolded(title))
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open
        setOpen(next)
        keepFolded(title, !next)
      }}
      className="group rounded-card border border-hairline bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        <span className="flex items-center gap-1 text-sm text-text-secondary">
          {open ? 'Hide' : 'Show'}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}

function Why({ copy }: { copy: AboutCopy }) {
  return (
    <About title={copy.title}>
      <Groups groups={copy.groups} />
    </About>
  )
}

function Groups({ groups }: { groups: readonly AboutGroup[] }) {
  return (
    <div className="grid gap-x-10 gap-y-4 lg:grid-cols-3">
      {groups.map(({ heading, points }) => (
        <section key={heading} aria-label={heading} className="space-y-2">
          <h3 className="text-base font-semibold text-text-primary">
            {heading}
          </h3>
          <ul className="list-disc space-y-2 pl-5 text-base text-text-primary">
            {points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function WarehouseWhy() {
  return <Why copy={WAREHOUSE_ABOUT} />
}

export function GraphWhy({ caps }: { caps: Record<string, number> }) {
  return <Why copy={graphAbout(caps)} />
}

export function OntologyWhy(counts: { concepts: number; bindings: number }) {
  return <Why copy={ontologyAbout(counts)} />
}

export function ScenariosWhy() {
  return <Why copy={SCENARIOS_ABOUT} />
}
