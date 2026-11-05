/**
 * The concepts as a WAI-ARIA tree, flat with `aria-level`: one tab stop that
 * rests on the selected concept, arrows move, Right and Left open and close,
 * Enter or Space selects. Choosing a concept is the caller's (`onSelect`).
 * A `filter` keeps the concepts it matches, in any language, under all the
 * concepts above them, opened, so a match shows in place.
 */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'

import type { Schemas } from '../../api/client'
import { labelOf } from './model'

type Concept = Schemas['ConceptOut']

interface Row {
  concept: Concept
  level: number
  position: number
  siblings: number
  expandable: boolean
  expanded: boolean
}

const ROW =
  'flex cursor-pointer items-center gap-1 rounded-chip py-1 pr-2 text-sm text-text-primary hover:bg-surface-raised aria-selected:bg-surface-raised aria-selected:font-semibold aria-selected:underline aria-selected:decoration-2 aria-selected:underline-offset-4'

function childrenByParent(concepts: Concept[]) {
  const children = new Map<string | null, Concept[]>()
  for (const concept of concepts)
    children.set(concept.parent_id, [
      ...(children.get(concept.parent_id) ?? []),
      concept,
    ])
  return children
}

/** The concepts above `id`, nearest first. */
function ancestorsOf(id: string, byId: Map<string, Concept>): string[] {
  const found: string[] = []
  for (
    let parent = byId.get(id)?.parent_id;
    parent;
    parent = byId.get(parent)?.parent_id
  )
    found.push(parent)
  return found
}

/** The concepts a filter matches in any language, with every concept above them; null when there is no filter. */
function keptByFilter(
  concepts: Concept[],
  byId: Map<string, Concept>,
  filter: string,
): Set<string> | null {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return null
  const kept = new Set<string>()
  for (const concept of concepts)
    if (
      Object.values(concept.labels).some((label) =>
        label.toLowerCase().includes(needle),
      )
    ) {
      kept.add(concept.concept_id)
      ancestorsOf(concept.concept_id, byId).forEach((id) => kept.add(id))
    }
  return kept
}

/** The rows a person sees, depth first, skipping what a collapsed concept hides. */
function visibleRows(
  children: Map<string | null, Concept[]>,
  expanded: Set<string>,
  kept: Set<string> | null,
): Row[] {
  const rows: Row[] = []
  const walk = (parent: string | null, level: number) => {
    const siblings = (children.get(parent) ?? []).filter(
      (c) => kept === null || kept.has(c.concept_id),
    )
    siblings.forEach((concept, index) => {
      const below = (children.get(concept.concept_id) ?? []).filter(
        (c) => kept === null || kept.has(c.concept_id),
      )
      const open = kept !== null || expanded.has(concept.concept_id)
      rows.push({
        concept,
        level,
        position: index + 1,
        siblings: siblings.length,
        expandable: below.length > 0,
        expanded: open,
      })
      if (open) walk(concept.concept_id, level + 1)
    })
  }
  walk(null, 1)
  return rows
}

export function ConceptTree({
  concepts,
  selected,
  onSelect,
  filter = '',
}: {
  concepts: Concept[]
  selected: string
  onSelect: (id: string) => void
  filter?: string
}) {
  const byId = new Map(concepts.map((c) => [c.concept_id, c]))
  const children = childrenByParent(concepts)
  const [expanded, setExpanded] = useState(
    () =>
      new Set([
        ...(children.get(null) ?? []).map((c) => c.concept_id),
        ...ancestorsOf(selected, byId),
      ]),
  )
  const [seen, setSeen] = useState(selected)
  const [focused, setFocused] = useState<string | null>(null)
  const items = useRef(new Map<string, HTMLElement>())

  // A concept chosen elsewhere (a link, the address) opens the way to itself.
  if (seen !== selected) {
    setSeen(selected)
    setExpanded(new Set([...expanded, ...ancestorsOf(selected, byId)]))
  }

  const rows = visibleRows(
    children,
    expanded,
    keptByFilter(concepts, byId, filter),
  )
  const ids = rows.map((r) => r.concept.concept_id)
  const stop =
    focused && ids.includes(focused)
      ? focused
      : ids.includes(selected)
        ? selected
        : ids[0]

  const toggle = (id: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  const move = (id: string | undefined) => {
    if (id) items.current.get(id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ids.indexOf(stop)
    const row = rows[index]
    if (!row) return
    const id = row.concept.concept_id
    switch (event.key) {
      case 'ArrowDown':
        move(ids[index + 1])
        break
      case 'ArrowUp':
        move(ids[index - 1])
        break
      case 'Home':
        move(ids[0])
        break
      case 'End':
        move(ids[ids.length - 1])
        break
      case 'ArrowRight':
        if (row.expandable && !row.expanded) toggle(id, true)
        else if (row.expandable) move(ids[index + 1])
        break
      case 'ArrowLeft':
        if (row.expandable && row.expanded) toggle(id, false)
        else move(row.concept.parent_id ?? undefined)
        break
      case 'Enter':
      case ' ':
        onSelect(id)
        break
      default:
        return
    }
    event.preventDefault()
  }

  if (rows.length === 0)
    return <p className="px-2 text-sm text-text-secondary">No match</p>

  return (
    <div role="tree" aria-label="Concepts" onKeyDown={onKeyDown}>
      {rows.map(({ concept, level, position, siblings, ...state }) => {
        const id = concept.concept_id
        return (
          <div
            key={id}
            ref={(element) => {
              if (element) items.current.set(id, element)
              else items.current.delete(id)
            }}
            role="treeitem"
            aria-level={level}
            aria-posinset={position}
            aria-setsize={siblings}
            aria-expanded={state.expandable ? state.expanded : undefined}
            aria-selected={id === selected}
            tabIndex={id === stop ? 0 : -1}
            onFocus={() => setFocused(id)}
            onClick={() => onSelect(id)}
            className={ROW}
            style={{ paddingLeft: `${(level - 1) * 1.25 + 0.25}rem` }}
          >
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center"
              onClick={(event) => {
                if (!state.expandable) return
                event.stopPropagation()
                toggle(id, !state.expanded)
              }}
            >
              {state.expandable &&
                (state.expanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                ))}
            </span>
            {labelOf(concept)}
          </div>
        )
      })}
    </div>
  )
}
