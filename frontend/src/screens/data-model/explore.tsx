/**
 * The way-finding of the Data Model screen (D-114): the steps a reader can
 * take on each tab, a trail that says where they are once they have clicked
 * through, and a cue above each map that its boxes open. Each tab's steps are
 * in `STEPS` (`explore-steps.ts`), so the four read alike.
 */

import { ChevronRight, MousePointerClick } from 'lucide-react'
import type { ReactNode } from 'react'

export function ExploreSteps({ steps }: { steps: readonly string[] }) {
  return (
    <section
      aria-labelledby="explore-title"
      className="rounded-card border border-hairline bg-surface p-4"
    >
      <h2
        id="explore-title"
        className="text-base font-semibold text-text-primary"
      >
        How to explore
      </h2>
      <ol className="mt-3 grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-sm font-semibold text-surface"
            >
              {index + 1}
            </span>
            <span className="pt-0.5 text-base text-text-primary">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Where the reader is: each step back is a link, the last is the page itself. */
export function Trail({
  steps,
  hint,
}: {
  steps: readonly { label: string; href?: string }[]
  /** What the reader can do on this page, in one sentence. */
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <nav aria-label="You are here">
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          {steps.map(({ label, href }, index) => (
            <li key={label} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-text-muted"
                />
              )}
              {href ? (
                <a href={href} className="text-text-secondary underline">
                  {label}
                </a>
              ) : (
                <span
                  aria-current="page"
                  className="font-semibold text-text-primary"
                >
                  {label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {hint && <ClickHint>{hint}</ClickHint>}
    </div>
  )
}

/** A cue that the boxes or rows below open when chosen. */
export function ClickHint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
      <MousePointerClick aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </p>
  )
}
