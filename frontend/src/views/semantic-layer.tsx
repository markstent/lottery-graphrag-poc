/**
 * Semantic Layer explainer (docs/06 section 14): sources → entity mapping →
 * ontology → knowledge graph → agent. Selection highlights the mapping; the
 * caption carries the key architectural message.
 *
 * 2026-10-18 SaaS redesign: added an explicit header explaining what this
 * layer is and a side-by-side "Source data → Canonical ontology → Graph
 * traversal" flow with concrete example rows for each source and concept.
 */

import { useState } from 'react'

import { hrefFor } from '../app/router'
import { SEMANTIC_CONCEPTS, SEMANTIC_SOURCES } from '../mock/content'

const SOURCE_EXAMPLES: Record<
  string,
  {
    table: string
    sampleRow: string
    mappedNodes: string[]
  }
> = {
  warehouse: {
    table: 'incidents.parquet · games.parquet · kpi_daily.parquet',
    sampleRow:
      'INC_S007_GR | MKT_GR | PLV_PAYMENTS_3 | INC_PAYMENTS | severity: HIGH | root_cause: RC_77',
    mappedNodes: [
      'Incident',
      'PlatformVersion',
      'Game',
      'Market',
      'PaymentMethod',
    ],
  },
  documents: {
    table: 'documents.parquet · document_chunks.parquet (Qdrant)',
    sampleRow:
      'DOC_S007_GR (el) | "Incident INC_S007_GR was raised for payment checkout failures on PLV_PAYMENTS_3…"',
    mappedNodes: ['Document', 'DocumentChunk', 'REFERENCES → Incident / Game'],
  },
  telemetry: {
    table: 'sessions.parquet · devices.parquet · player_device.parquet',
    sampleRow:
      'SES_0049182 | PLAYER_GR_001283 | DEV_GR_0912 | APPV_GR_520 | outcome: CHECKOUT_DROP',
    mappedNodes: ['Player', 'Device', 'AppVersion', 'USES → Device'],
  },
  support: {
    table: 'support_cases.parquet',
    sampleRow:
      'SUP_GR_04812 | MKT_GR | GAME_GR_01 | linked_incident: INC_S007_GR | topic: PAYMENT_DECLINED',
    mappedNodes: [
      'SupportCase',
      'RELATED_TO → Incident',
      'CONCERNS → Game',
      'FROM_MARKET → Market',
    ],
  },
}

const CONCEPT_DETAILS: Record<
  string,
  {
    conceptId: string
    whyItMatters: string
  }
> = {
  incident: {
    conceptId: 'CONCEPT_PLATFORM_INCIDENT',
    whyItMatters:
      'Binds INC_S007_GR (Greece), INC_S007_AT (Austria) and INC_S007_CZ (Czechia) into one concept so a question about Greece automatically discovers the same platform bug in Austria and Czechia.',
  },
  instrument: {
    conceptId: 'USES_PAYMENT (Player → PaymentMethod)',
    whyItMatters:
      'Connects accounts that share the same tokenised payment instrument across transactions, exposing multi-account rings in 2 hops.',
  },
  superseded: {
    conceptId: 'Document validity (valid_from → valid_to)',
    whyItMatters:
      'Links DOC_S015_UK (expired rules leaflet quoting GBP 1.50) to GAME_UK_01 (authoritative warehouse price GBP 2.50) so the agent cites the current price and explains the discrepancy.',
  },
}

export function SemanticLayer() {
  const [source, setSource] = useState<string>('warehouse')
  const [concept, setConcept] = useState<string>('incident')

  const activeSource = SOURCE_EXAMPLES[source] ?? SOURCE_EXAMPLES.warehouse
  const activeConcept =
    SEMANTIC_CONCEPTS.find((entry) => entry.id === concept) ??
    SEMANTIC_CONCEPTS[0]
  const activeConceptDetail =
    CONCEPT_DETAILS[activeConcept.id] ?? CONCEPT_DETAILS.incident

  return (
    <div className="space-y-4">
      <section
        aria-label="Semantic layer header"
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ontology">
              Architecture Explainer
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-primary">
              How raw tables & documents become connected graph concepts
            </h2>
            <p className="mt-1 text-xs text-secondary">
              The knowledge graph sits above existing tables and documents as a
              semantic index; it never replaces the warehouse. Click a data
              source or concept below to trace the mapping.
            </p>
          </div>
          <a
            href={hrefFor('dictionary')}
            className="rounded-chip border border-border bg-surface-raised px-3 py-1.5 text-xs text-secondary transition-colors duration-micro hover:border-graph/50 hover:text-primary"
          >
            Inspect full schema & sample rows →
          </a>
        </div>
      </section>

      <section
        aria-label="Layered architecture"
        className="rounded-card border border-border bg-surface p-5"
      >
        <ol className="space-y-4">
          <li>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Step 1 · Click an existing enterprise data source
            </p>
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
                      ? 'border-graph bg-surface-raised text-primary'
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
            className="rounded-card border border-border bg-surface-raised p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Step 2 · Example source record & extracted graph nodes
              </p>
              <span className="font-mono text-xs text-muted">
                {activeSource.table}
              </span>
            </div>
            <p className="mt-2 rounded-chip border border-border bg-background px-3 py-2 font-mono text-xs text-primary">
              {activeSource.sampleRow}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Maps to Neo4j labels:</span>
              <ul className="flex flex-wrap gap-1.5">
                {activeSource.mappedNodes.map((entity) => (
                  <li
                    key={entity}
                    className="rounded-chip border border-graph/40 bg-background px-2.5 py-0.5 font-mono text-xs text-graph"
                  >
                    {entity}
                  </li>
                ))}
              </ul>
            </div>
          </li>

          <li
            aria-label="Enterprise ontology"
            className="rounded-card border border-ontology/40 bg-surface-raised p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-ontology">
              Step 3 · Click a canonical ontology concept (Pipeline C)
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {SEMANTIC_CONCEPTS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setConcept(item.id)}
                    aria-pressed={concept === item.id}
                    className={`rounded-chip border px-3 py-1 text-xs font-medium transition-colors duration-micro ${
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
            <div className="mt-3 rounded-card border border-border bg-background p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-ontology">
                  {activeConceptDetail.conceptId}
                </span>
                <span className="text-xs text-muted">
                  binds: {activeConcept.entities.join(' · ')}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-secondary">
                {activeConceptDetail.whyItMatters}
              </p>
            </div>
          </li>

          <li
            aria-label="Knowledge graph"
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="rounded-card border border-graph/40 bg-surface-raised p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-graph">
                Step 4 · Knowledge graph overlay (Neo4j)
              </p>
              <p className="mt-1 text-xs text-secondary">
                26 node labels · 26 relationship types · every node keeps{' '}
                <code className="text-primary">source_system</code> and{' '}
                <code className="text-primary">source_record_id</code> pointers
                to the warehouse.
              </p>
            </div>
            <div
              aria-label="AI agent"
              className="rounded-card border border-border bg-surface-raised p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Step 5 · Grounded AI answer
              </p>
              <p className="mt-1 text-xs text-secondary">
                Combines Qdrant document chunks with 2-hop Neo4j paths and cites
                exact record IDs.
              </p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  )
}
