/**
 * The one layout every Data Model explorer tab is built on (D-115): choose on
 * the left, look in the middle, details and where next on the right. Each
 * column is headed by its numbered step, so the layout explains itself, and
 * "About this" opens the layer's explanation in the drawer. The columns stack,
 * list first, below the `lg` width.
 */

import { Info, Search } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { Drawer } from '../../components/drawer'

/** The look of a link that takes the reader on to the next step: filled, with an arrow. */
export const NEXT_STEP =
  'inline-flex items-center gap-1.5 rounded-chip bg-text-primary px-4 py-2 text-sm font-semibold text-surface hover:opacity-90'

function Column({
  step,
  heading,
  action,
  children,
}: {
  step: number
  heading: string
  /** A control at the end of the heading row. */
  action?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-card border border-hairline bg-surface p-5"
    >
      <div className="mb-4 flex min-h-8 items-center justify-between gap-2">
        <h2
          id={id}
          className="flex items-center gap-2 text-base font-semibold text-text-primary"
        >
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-sm tabular-nums">
            {step}
          </span>{' '}
          {heading}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Explorer({
  steps,
  about,
  list,
  main,
  detail,
}: {
  steps: readonly [string, string, string]
  about: ReactNode
  list: ReactNode
  main: ReactNode
  detail: ReactNode
}) {
  const [aboutOpen, setAboutOpen] = useState(false)
  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2.6fr)_minmax(18rem,1.2fr)]">
        <Column step={1} heading={steps[0]}>
          {list}
        </Column>
        <Column step={2} heading={steps[1]}>
          {main}
        </Column>
        <Column
          step={3}
          heading={steps[2]}
          action={
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-chip border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary"
            >
              <Info aria-hidden size={16} />
              About this
            </button>
          }
        >
          {detail}
        </Column>
      </div>
      <Drawer
        open={aboutOpen}
        title="About this"
        onClose={() => setAboutOpen(false)}
      >
        {about}
      </Drawer>
    </div>
  )
}

/** The search box at the top of a list, which narrows it as the reader types. */
export function ListSearch({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
      />
      <input
        type="search"
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-chip border border-border bg-surface py-2 pr-3 pl-9 text-sm text-text-primary placeholder:text-text-muted"
      />
    </label>
  )
}

export interface PickItem {
  id: string
  title: string
  /** A short figure beside the title, such as a row count. */
  detail?: string
}

export interface PickGroup {
  name?: string
  items: PickItem[]
}

const matches = (item: PickItem, query: string) =>
  `${item.id} ${item.title}`.toLowerCase().includes(query)

/**
 * A list to choose from, in named groups, with a search box above it unless
 * `searchable` is false. Each item is a button: it highlights under the
 * pointer and on focus, and the chosen one is pressed.
 */
export function PickList({
  label,
  groups,
  chosen,
  onChoose,
  searchable = true,
}: {
  label: string
  groups: readonly PickGroup[]
  chosen: string | undefined
  onChoose: (id: string) => void
  searchable?: boolean
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matches(item, needle)),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="space-y-3">
      {searchable && (
        <ListSearch label={label} value={query} onChange={setQuery} />
      )}
      {shown.length === 0 && needle !== '' && (
        <p className="px-2 text-sm text-text-secondary">No match</p>
      )}
      {shown.map((group, index) => (
        <div key={group.name ?? index} className="space-y-1">
          {group.name && (
            <h3 className="px-2 pt-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
              {group.name}
            </h3>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === chosen}
                  onClick={() => onChoose(item.id)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-chip px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-raised focus-visible:bg-surface-raised aria-pressed:bg-surface-raised aria-pressed:font-semibold"
                >
                  <span className="min-w-0 break-words">{item.title}</span>
                  {item.detail && (
                    <span className="shrink-0 text-text-muted tabular-nums">
                      {item.detail}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
