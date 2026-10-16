/**
 * Shared primitives for the in-app documentation screens (Help and Data
 * Dictionary): anchored sections, token-styled tables and command blocks.
 * Presentation-only; no state, no fetching.
 */

export function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={`help-${id}`} className="scroll-mt-28">
      <h2 id={`help-${id}`} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-secondary">
        {children}
      </div>
    </section>
  )
}

export function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((cell) => (
              <th key={cell} scope="col" className="pb-1 pr-4 font-normal">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-border align-top">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={
                    index === 0 ? 'py-1.5 pr-4 text-primary' : 'py-1.5 pr-4'
                  }
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

export function CommandBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="overflow-x-auto rounded-card border border-border bg-surface p-3 font-mono text-xs text-primary">
      {lines.join('\n')}
    </pre>
  )
}
