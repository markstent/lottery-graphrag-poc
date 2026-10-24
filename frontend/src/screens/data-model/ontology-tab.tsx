/**
 * The Ontology tab: the concepts as a keyboard-navigable tree on the left, the
 * chosen concept in the centre, and the local terms of each market that are
 * bound to it on the right, so "Αριθμολαχείο equals Zahlenziehung equals
 * National Draw" can be read off one screen. The concept and the market
 * filter are in the route (`?concept=`, `?market=`).
 */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'

import { getConceptMembers, getOntology, type Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { MARKETS } from '../../run/coverage'
import { ConceptCard } from './concept-card'
import { labelOf } from './model'

type Concept = Schemas['ConceptOut']
type Member = Schemas['MemberOut']

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

const goTo = (concept: string, market?: string) => {
  window.location.hash = hrefFor('data-model', {
    tab: 'ontology',
    concept,
    ...(market ? { market } : {}),
  })
}

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

/** The rows a person sees, depth first, skipping what a collapsed concept hides. */
function visibleRows(
  children: Map<string | null, Concept[]>,
  expanded: Set<string>,
): Row[] {
  const rows: Row[] = []
  const walk = (parent: string | null, level: number) => {
    const siblings = children.get(parent) ?? []
    siblings.forEach((concept, index) => {
      const below = children.get(concept.concept_id) ?? []
      const open = expanded.has(concept.concept_id)
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

/** WAI-ARIA tree: arrows move, Right and Left open and close, Enter or Space selects. */
function ConceptTree({
  concepts,
  selected,
}: {
  concepts: Concept[]
  selected: string
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

  const rows = visibleRows(children, expanded)
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
        goTo(id)
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div
      role="tree"
      aria-label="Concepts"
      onKeyDown={onKeyDown}
      className="max-h-[calc(100vh-20rem)] overflow-y-auto"
    >
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
            onClick={() => goTo(id)}
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

const marketName = (id: string) => MARKETS.find((m) => m.id === id)?.name ?? id

/** The terms grouped by market, in the markets' order, shared codes last. */
function groupMembers(members: Member[]) {
  const ids = [
    ...MARKETS.map((m) => m.id as string),
    ...members.flatMap((m) => (m.market_id ? [m.market_id] : [])),
  ]
  const groups = [...new Set(ids)].map((id) => ({
    name: marketName(id),
    members: members.filter((m) => m.market_id === id),
  }))
  groups.push({
    name: 'Shared by every market',
    members: members.filter((m) => m.market_id === null),
  })
  return groups.filter((g) => g.members.length > 0)
}

function BoundTerms({
  concept,
  market,
}: {
  concept: Concept
  market: string | null
}) {
  const bound = Object.keys(concept.binding_counts).filter(
    (m) => m !== 'shared',
  )
  const chosen = market && bound.includes(market) ? market : null
  const load = useLoad(
    (signal) =>
      getConceptMembers(concept.concept_id, chosen ?? undefined, signal),
    `${concept.concept_id}|${chosen}`,
  )
  const choices = [
    { id: null, name: 'All markets' },
    ...bound.map((id) => ({ id, name: marketName(id) })),
  ]
  const none =
    chosen === null
      ? 'No local terms are bound directly to this concept.'
      : 'No local terms from this market are bound to this concept.'
  return (
    <div className="space-y-3">
      {bound.length > 0 && (
        <div
          role="group"
          aria-label="Show terms from"
          className="flex flex-wrap gap-2"
        >
          {choices.map(({ id, name }) => (
            <button
              key={name}
              type="button"
              aria-pressed={id === chosen}
              onClick={() => goTo(concept.concept_id, id ?? undefined)}
              className="rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised aria-pressed:bg-surface-raised aria-pressed:font-semibold"
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <Panel
        title="Local terms bound to it"
        purpose="What each market calls this concept in its own data."
        state={
          load.status === 'ready'
            ? load.data.length === 0
              ? 'empty'
              : 'ready'
            : load.status
        }
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
        message={none}
      >
        {load.status === 'ready' &&
          groupMembers(load.data).map((group) => (
            <div
              key={group.name}
              role="group"
              aria-label={group.name}
              className="mb-4 last:mb-0"
            >
              <h3 className="text-sm font-semibold text-text-primary">
                {group.name}
              </h3>
              <ul className="mt-1 space-y-1">
                {group.members.map((member) => (
                  <li key={member.code} className="text-sm text-text-primary">
                    <span className="font-medium">
                      {member.name ?? member.code}
                    </span>
                    <span className="block text-text-muted">
                      {plainName(member.kind)}
                      {member.name && ` · ${member.code}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </Panel>
    </div>
  )
}

export function OntologyTab({ params }: { params: URLSearchParams }) {
  const load = useLoad(getOntology, 'ontology')
  if (load.status !== 'ready')
    return (
      <Panel
        title="Concepts"
        state={load.status}
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      />
    )
  const { concepts } = load.data
  if (concepts.length === 0)
    return (
      <Panel
        title="Concepts"
        state="empty"
        message="The ontology has no concepts yet."
      />
    )
  const concept =
    concepts.find((c) => c.concept_id === params.get('concept')) ?? concepts[0]
  const kinds = concepts.filter((c) => c.parent_id === concept.concept_id)
  return (
    <div className="grid grid-cols-[18rem_minmax(0,1fr)_minmax(0,22rem)] items-start gap-4">
      <Panel title="Concepts" state="ready">
        <ConceptTree concepts={concepts} selected={concept.concept_id} />
      </Panel>
      <ConceptCard
        concept={concept}
        parent={concepts.find((c) => c.concept_id === concept.parent_id)}
        kinds={kinds}
      />
      <BoundTerms concept={concept} market={params.get('market')} />
    </div>
  )
}
