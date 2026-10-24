/**
 * One ontology concept: its name in each language, the other names it goes
 * by, and how it relates to the rest, written in plain words. The API gives
 * no definition, so none is shown.
 */

import type { Schemas } from '../../api/client'
import { hrefFor } from '../../app/router'
import { Panel } from '../../components/panel'
import { relationshipPhrase } from '../../design/relationships'
import { labelOf } from './model'

type Concept = Schemas['ConceptOut']

const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'el', name: 'Greek' },
  { id: 'de', name: 'German' },
  { id: 'cs', name: 'Czech' },
] as const

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
  const sentences = concept.relationships.flatMap((type) => {
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
    return [
      <>
        A local term {phrase} {labelOf(concept)}
      </>,
    ]
  })
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
    <Panel
      state="ready"
      title="Concept"
      purpose="One shared idea, and the name each market uses for it."
    >
      <h3 className="text-lg font-semibold text-text-primary">
        {labelOf(concept)}
      </h3>
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
