/**
 * Evidence Explorer (docs/06 section 6): every citation is inspectable via
 * Sources / Graph / Provenance tabs. The URL round-trips run and evidence
 * ids so views stay shareable.
 */

import { useMemo, useState } from 'react'

import { GraphCanvas, GraphLegend } from '../components/graph-canvas'
import { hrefFor } from '../app/router'
import { EVIDENCE_PATH_IDS, getEvidence } from '../mock/evidence'
import { MOCK_RUN, projectGraph } from '../mock/telemetry'

export type Tab = 'sources' | 'graph' | 'provenance'

const KIND_BADGE: Record<string, string> = {
  document: '📄 document',
  metric: '📊 metric',
  record: '🗂 record',
  'graph-node': '🔗 graph node',
}

export function EvidenceInspector({
  evidenceId,
  onSelectEvidence,
}: {
  evidenceId: string | null
  onSelectEvidence?: (id: string) => void
}) {
  const [tab, setTab] = useState<Tab>('sources')
  const focusId = evidenceId ?? EVIDENCE_PATH_IDS[0]
  const focus = useMemo(() => getEvidence(focusId), [focusId])
  const finalGraph = useMemo(() => projectGraph(MOCK_RUN.graph), [])

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Evidence views" className="flex gap-1">
        {(
          [
            ['sources', 'Sources'],
            ['graph', 'Graph'],
            ['provenance', 'Provenance'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-chip px-3 py-1.5 text-sm transition-colors duration-micro ${
              tab === key
                ? 'border border-graph/60 bg-surface-raised text-primary'
                : 'border border-transparent text-secondary hover:text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sources' && (
        <ul className="grid gap-3 xl:grid-cols-2" aria-label="Evidence sources">
          {EVIDENCE_PATH_IDS.map((id) => {
            const record = getEvidence(id)
            const isFocus = id === focusId
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectEvidence?.(id)
                    setTab('provenance')
                  }}
                  aria-current={isFocus ? 'true' : undefined}
                  className={`h-full w-full rounded-card border p-4 text-left transition-colors duration-micro ${
                    isFocus
                      ? 'border-graph/60 bg-surface-raised'
                      : 'border-border bg-surface hover:border-graph/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-primary">
                      {record.label}
                    </span>
                    <span className="rounded-chip bg-surface-raised px-2 py-0.5 text-xs text-muted">
                      {KIND_BADGE[record.kind]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    {record.excerpt}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {record.sourceSystem} · {record.sourceRecordId}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {tab === 'graph' && (
        <section
          aria-label="Evidence graph"
          className="rounded-card border border-border bg-surface p-4"
        >
          <GraphCanvas state={finalGraph} compact />
          <div className="mt-2">
            <GraphLegend />
          </div>
          <p className="mt-2 text-xs text-muted">
            Nodes and edges shown are the events recorded for run{' '}
            {MOCK_RUN.runId}; the full enterprise graph is never rendered.
          </p>
        </section>
      )}

      {tab === 'provenance' && (
        <section
          aria-label={`Provenance for ${focus.label}`}
          className="rounded-card border border-border bg-surface p-4"
        >
          <h3 className="text-sm font-semibold text-primary">{focus.label}</h3>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            {(
              [
                ['Source system', focus.sourceSystem],
                ['Source record', focus.sourceRecordId],
                ['Validity', focus.validity],
                ['Derivation', focus.derivation],
                ['Confidence', focus.confidence.toFixed(2)],
              ] as const
            ).map(([term, detail]) => (
              <div key={term} className="contents">
                <dt className="text-muted">{term}</dt>
                <dd className="text-secondary">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">
            Provenance records how this evidence entered the context. Evaluation
            truth is never exposed here.
          </p>
        </section>
      )}
    </div>
  )
}

export function EvidenceExplorer({
  evidenceId,
}: {
  evidenceId: string | null
}) {
  const [selectedId, setSelectedId] = useState<string | null>(evidenceId)

  return (
    <div className="space-y-4">
      <section
        aria-label="Run context"
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg">Evidence Explorer</h2>
            <p className="text-xs text-muted">
              run {MOCK_RUN.runId} · “{MOCK_RUN.question}”
            </p>
          </div>
          <a
            href={hrefFor('lab', { run: MOCK_RUN.runId })}
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-secondary transition-colors duration-micro hover:text-primary"
          >
            ← Back to Live Lab
          </a>
        </div>
      </section>

      <EvidenceInspector
        evidenceId={selectedId ?? evidenceId}
        onSelectEvidence={setSelectedId}
      />
    </div>
  )
}
