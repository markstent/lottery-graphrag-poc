/**
 * Shared primitives for the in-app documentation screens (Help, Data
 * Dictionary): page hero, anchored sections, callouts, journey steps,
 * reference tables and command blocks. Presentation-only; no state.
 *
 * Design language: docs/ux/visual-language.md (calm, data-first, token
 * colours only) and docs/ux/accessibility.md (headings hierarchical,
 * tables have scope, status never colour-only).
 */

export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string
  title: string
  lead: string
  children?: React.ReactNode
}) {
  return (
    <header className="rounded-card border border-border bg-surface p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-graph">
        {eyebrow}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-primary">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-secondary">
        {lead}
      </p>
      {children && <div className="mt-4">{children}</div>}
    </header>
  )
}

export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string
  title: string
  lead?: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={`help-${id}`} className="scroll-mt-28">
      <h2 id={`help-${id}`} className="text-xl font-semibold text-primary">
        {title}
      </h2>
      {lead && (
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-secondary">
          {lead}
        </p>
      )}
      <div className="mt-3 space-y-4 text-sm leading-relaxed text-secondary">
        {children}
      </div>
    </section>
  )
}

const CALLOUT_STYLES = {
  tip: {
    border: 'border-graph/50',
    label: 'Good to know',
    dot: 'bg-graph',
  },
  warn: {
    border: 'border-warning/50',
    label: 'Watch out',
    dot: 'bg-warning',
  },
} as const

export function Callout({
  tone = 'tip',
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT_STYLES
  title?: string
  children: React.ReactNode
}) {
  const styles = CALLOUT_STYLES[tone]
  return (
    <div className={`rounded-card border ${styles.border} bg-surface p-3.5`}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
        <span
          className={`h-1.5 w-1.5 rounded-full ${styles.dot}`}
          aria-hidden
        />
        {title ?? styles.label}
      </p>
      <div className="mt-1.5 text-sm leading-relaxed text-secondary">
        {children}
      </div>
    </div>
  )
}

export function Card({
  title,
  children,
  footer,
}: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-card border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      <div className="mt-1.5 flex-1 text-sm leading-relaxed text-secondary">
        {children}
      </div>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  )
}

export function Steps({
  items,
}: {
  items: { title: string; children: React.ReactNode }[]
}) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.title} className="flex gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-graph/60 text-xs font-semibold text-graph"
          >
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-medium text-primary">{item.title}</p>
            <div className="mt-0.5 text-sm leading-relaxed text-secondary">
              {item.children}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-raised text-left text-xs text-muted">
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-3 py-2 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row[0]}
              className={`border-t border-border align-top ${
                rowIndex % 2 === 1 ? 'bg-surface/60' : ''
              }`}
            >
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={`px-3 py-2 ${
                    index === 0 ? 'font-medium text-primary' : 'text-secondary'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Code({ children }: { children: string }) {
  return (
    <code className="rounded-chip bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-primary">
      {children}
    </code>
  )
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip border border-border bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-secondary">
      {children}
    </span>
  )
}

/**
 * A horizontal step rail: pills joined by arrow glyphs. Because it is
 * plain flex layout it wraps instead of overlapping, unlike positioned
 * SVG, and it reads as plain text to assistive tech.
 */
export function Rail({
  items,
}: {
  items: readonly { label: string; note?: string }[]
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {items.map((item, index) => (
        <li key={item.label} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden className="text-sm text-muted">
              →
            </span>
          )}
          <span className="rounded-chip border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-primary">
            {item.label}
            {item.note && (
              <span className="ml-1.5 font-normal text-muted">{item.note}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function CommandBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="overflow-x-auto rounded-card border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-primary">
      {lines.join('\n')}
    </pre>
  )
}
