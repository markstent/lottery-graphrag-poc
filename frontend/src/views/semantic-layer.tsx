/**
 * Semantic Layer explainer (docs/06 section 14): sources → entity mapping →
 * ontology → knowledge graph → agent. Selection highlights the mapping; the
 * caption carries the key architectural message.
 */

import { useState } from 'react'

import { hrefFor } from '../app/router'
import { SEMANTIC_CONCEPTS, SEMANTIC_SOURCES } from '../mock/content'

const ENTITY_MAPPINGS: Record<string, string[]> = {
  warehouse: [
    'Incidents',
    'KPI daily',
    'Platform versions',
    'Games',
    'Accounts',
  ],
  documents: ['Incident reports', 'Release notes', 'Rules documents'],
  telemetry: ['Sessions', 'Devices'],
  support: ['Support cases', 'Complaint topics'],
}

export function SemanticLayer() {
  const [source, setSource] = useState<string | null>('warehouse')
  const [concept, setConcept] = useState<string | null>(null)

  const mappedEntities = source ? ENTITY_MAPPINGS[source] : []
  const conceptEntities =
    SEMANTIC_CONCEPTS.find((entry) => entry.id === concept)?.entities ?? []

  return (
    <div className="space-y-4">
      <section
        aria-label="Layered architecture"
        className="rounded-card border border-border bg-surface p-6"
      >
        <ol className="space-y-3">
          <li>
            <div
              className="grid gap-2 sm:grid-cols-4"
              aria-label="Existing data sources"
            >
              {SEMANTIC_SOURCES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSource(item.id)}
                  aria-pressed={source === item.id}
                  className={`rounded-card border p-3 text-left transition-colors duration-micro ${
                    source === item.id
                      ? 'border-baseline bg-surface-raised text-primary'
                      : 'border-border bg-surface text-secondary hover:text-primary'
                  }`}
                >
                  <span className="block text-sm font-medium">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {item.detail}
                  </span>
                </button>
              ))}
            </div>
          </li>

          <li
            aria-label="Entity mapping"
            className="rounded-card border border-border bg-surface-raised p-3"
          >
            <p className="text-xs text-muted">Entity mapping</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {(mappedEntities.length > 0
                ? mappedEntities
                : ['Select a source to highlight its mapped entities']
              ).map((entity) => (
                <li
                  key={entity}
                  className="rounded-chip bg-background px-2 py-0.5 text-xs text-secondary"
                >
                  {entity}
                </li>
              ))}
            </ul>
          </li>

          <li
            aria-label="Enterprise ontology"
            className="rounded-card border border-ontology/40 bg-surface-raised p-3"
          >
            <p className="text-xs text-muted">
              Enterprise ontology · canonical concepts
            </p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {SEMANTIC_CONCEPTS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setConcept(concept === item.id ? null : item.id)
                    }
                    aria-pressed={concept === item.id}
                    className={`rounded-chip border px-2 py-0.5 text-xs transition-colors duration-micro ${
                      concept === item.id
                        ? 'border-ontology bg-ontology/15 text-ontology'
                        : 'border-border text-secondary hover:text-primary'
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            {conceptEntities.length > 0 && (
              <p className="mt-2 text-xs text-secondary">
                binds: {conceptEntities.join(', ')}
              </p>
            )}
          </li>

          <li
            aria-label="Knowledge graph"
            className="rounded-card border border-graph/40 bg-surface-raised p-3"
          >
            <p className="text-xs text-muted">
              Knowledge graph · semantic entities and relationships with
              provenance
            </p>
            <p className="mt-1 text-xs text-secondary">
              ~37k nodes · ~114k relationships (dev world) · every node
              references its source record
            </p>
          </li>

          <li
            aria-label="AI agent"
            className="rounded-card border border-border bg-surface-raised p-3"
          >
            <p className="text-xs text-muted">
              AI agent · retrieval, traversal and grounded answers
            </p>
          </li>
        </ol>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-secondary">
            The graph is an additional semantic layer above existing data. It
            does not replace the data layer.
          </p>
          <a
            href={hrefFor('dictionary')}
            className="rounded-chip border border-border px-3 py-1.5 text-xs text-secondary transition-colors duration-micro hover:border-graph/50 hover:text-primary"
          >
            Inspect full schema in Data Dictionary →
          </a>
        </div>
      </section>
    </div>
  )
}
