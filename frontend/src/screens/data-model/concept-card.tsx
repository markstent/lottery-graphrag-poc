/**
 * One ontology concept: its name in each language, the other names it goes
 * by, its definition, and how it relates to the rest, written in plain words.
 */

import type { ReactNode } from 'react'

import type { Schemas } from '../../api/client'
import { hrefFor } from '../../app/router'
import { plural } from '../../charts/scale'
import { Panel } from '../../components/panel'
import { relationshipPhrase } from '../../design/relationships'
import { LANGUAGES, labelOf } from './model'

type Concept = Schemas['ConceptOut']

const conceptLink = (concept: Concept) => (
  <a
    href={hrefFor('data-model', {
      tab: 'ontology',
      concept: concept.concept_id,
    })}
    className="text-text-primary underline"
  >
    {labelOf(concept)}
  </a>
)

/** "Matched to 4 country terms across 4 markets and 1 shared by every market"; null when nothing is matched. */
function bindingLine(counts: Record<string, number>): string | null {
  const shared = counts.shared ?? 0
  const markets = Object.entries(counts).filter(([id]) => id !== 'shared')
  const terms = markets.reduce((sum, [, n]) => sum + n, 0)
  if (terms === 0 && shared === 0) return null
  if (terms === 0)
    return `Matched to ${plural(shared, 'country term')} shared by every market`
  const own = `Matched to ${plural(terms, 'country term')} across ${plural(markets.length, 'market')}`
  return shared > 0 ? `${own} and ${shared} shared by every market` : own
}

/** The relationships the concept takes part in, as sentences about it. */
function Relationships({
  concept,
  parent,
  kinds,
}: {
  concept: Concept
  parent: Concept | undefined
  kinds: Concept[]
}) {
  const sentences: ReactNode[] = concept.relationships.flatMap((type) => {
    const phrase = relationshipPhrase(type)
    if (type === 'IS_A')
      return [
        ...(parent
          ? [
              <>
                {labelOf(concept)} {phrase} {conceptLink(parent)}
              </>,
            ]
          : []),
        ...kinds.map((child) => (
          <>
            {conceptLink(child)} {phrase} {labelOf(concept)}
          </>
        )),
      ]
    return []
  })
  const binding = bindingLine(concept.binding_counts)
  if (binding) sentences.push(binding)
  return (
    <ul aria-label="Relationships" className="space-y-1 text-sm">
      {sentences.map((sentence, index) => (
        <li key={index} className="text-text-primary">
          {sentence}
        </li>
      ))}
    </ul>
  )
}

export function ConceptCard({
  concept,
  parent,
  kinds,
}: {
  concept: Concept
  parent: Concept | undefined
  kinds: Concept[]
}) {
  const synonyms = LANGUAGES.filter(
    ({ id }) => (concept.synonyms[id] ?? []).length > 0,
  )
  return (
    <Panel state="ready" title="Concept">
      <h3 className="text-lg font-semibold text-text-primary">
        {labelOf(concept)}
      </h3>
      <p className="mt-1 text-sm text-text-secondary">{concept.definition}</p>
      <ul aria-label="Names in each language" className="mt-3 space-y-1">
        {LANGUAGES.map(({ id, name }) => (
          <li
            key={id}
            className="grid grid-cols-[5rem_1fr] gap-x-3 text-sm text-text-primary"
          >
            <span className="text-text-muted">{name}</span>
            <span lang={id} className="font-medium">
              {concept.labels[id] ?? 'none'}
            </span>
          </li>
        ))}
      </ul>
      {synonyms.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-text-primary">
            Other names
          </h4>
          <ul aria-label="Other names" className="mt-1 space-y-1 text-sm">
            {synonyms.map(({ id, name }) => (
              <li key={id} lang={id} className="text-text-primary">
                {`${name}: ${concept.synonyms[id].join(', ')}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4">
        <h4 className="mb-1 text-sm font-semibold text-text-primary">
          Relationships
        </h4>
        <Relationships concept={concept} parent={parent} kinds={kinds} />
      </div>
    </Panel>
  )
}
