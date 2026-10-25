/**
 * The Ontology tab: the concepts as a keyboard-navigable tree on the left, the
 * chosen concept in the centre, and the local terms of each market that are
 * bound to it on the right, so "Αριθμολαχείο equals Zahlenziehung equals
 * National Draw" can be read off one screen. The concept and the market
 * filter are in the route (`?concept=`, `?market=`).
 */

import { getConceptMembers, getOntology, type Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { MARKETS } from '../../run/coverage'
import { ConceptCard } from './concept-card'
import { ConceptTree } from './concept-tree'

type Concept = Schemas['ConceptOut']
type Member = Schemas['MemberOut']

const goTo = (concept: string, market?: string) => {
  window.location.hash = hrefFor('data-model', {
    tab: 'ontology',
    concept,
    ...(market ? { market } : {}),
  })
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
  const shared = concept.binding_counts.shared ?? 0
  const load = useLoad(async (signal) => {
    if (chosen === null)
      return getConceptMembers(concept.concept_id, undefined, signal)
    // The API leaves shared codes out of a market's terms; they stay visible.
    const [ofMarket, everything] = await Promise.all([
      getConceptMembers(concept.concept_id, chosen, signal),
      shared > 0
        ? getConceptMembers(concept.concept_id, undefined, signal)
        : Promise.resolve([]),
    ])
    return [...ofMarket, ...everything.filter((m) => m.market_id === null)]
  }, `${concept.concept_id}|${chosen}`)
  const choices = [
    { id: null, name: 'All markets' },
    ...bound.map((id) => ({ id, name: marketName(id) })),
  ]
  const none =
    chosen === null
      ? 'No local terms are bound directly.'
      : 'No local terms from this market.'
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
                <span className="ml-2 font-normal text-text-muted">
                  {group.members.length}
                </span>
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
        <ConceptTree
          concepts={concepts}
          selected={concept.concept_id}
          onSelect={(id) => goTo(id)}
        />
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
