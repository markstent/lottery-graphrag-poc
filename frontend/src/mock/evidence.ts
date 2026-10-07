/**
 * Mock evidence registry backing the Evidence Explorer (UX-EVIDENCE-001).
 * Provenance fields mirror what retrieval telemetry records; the truth
 * ledger is never surfaced (ADR-008).
 */

export interface EvidenceRecord {
  id: string
  label: string
  kind: 'document' | 'metric' | 'record' | 'graph-node'
  sourceSystem: string
  sourceRecordId: string
  validity: string
  derivation: string
  confidence: number
  excerpt: string
}

const EVIDENCE: Record<string, EvidenceRecord> = {
  INC_S007_GR: {
    id: 'INC_S007_GR',
    label: 'Incident · Greece',
    kind: 'graph-node',
    sourceSystem: 'warehouse',
    sourceRecordId: 'warehouse.ops.incidents',
    validity: '2026-05-21 → 2026-05-26',
    derivation:
      'Direct record; graph node INCIDENT with market provenance MKT_GR',
    confidence: 0.98,
    excerpt:
      'Checkout regression after platform update; session completion dropped 9.4% over 5 days.',
  },
  INC_S007_AT: {
    id: 'INC_S007_AT',
    label: 'Incident · Austria',
    kind: 'graph-node',
    sourceSystem: 'warehouse',
    sourceRecordId: 'warehouse.ops.incidents',
    validity: '2026-05-22 → 2026-05-25',
    derivation: 'Direct record; same platform version via RELATED_TO_VERSION',
    confidence: 0.93,
    excerpt:
      'Intermittent payment failures (medium severity) after Payments v3 rollout.',
  },
  PLV_PAYMENTS_3: {
    id: 'PLV_PAYMENTS_3',
    label: 'Payments v3',
    kind: 'graph-node',
    sourceSystem: 'warehouse',
    sourceRecordId: 'warehouse.ops.platform_versions',
    validity: 'released 2026-05-20',
    derivation: 'Direct record; graph node PLATFORM_VERSION',
    confidence: 0.99,
    excerpt:
      'Platform version deployed to GR and AT on 20 May; UK rollout deferred.',
  },
  DOC_S007_GR: {
    id: 'DOC_S007_GR',
    label: 'Incident Report (el)',
    kind: 'document',
    sourceSystem: 'document_store',
    sourceRecordId: 'documents/2026/INC_S007_GR',
    validity: 'published 2026-05-27',
    derivation:
      'Chunk retrieved by embedding similarity (0.82) and referenced from INC_S007_GR',
    confidence: 0.9,
    excerpt:
      'Greek incident report describing checkout failures following the platform change.',
  },
  DOC_S007_UK: {
    id: 'DOC_S007_UK',
    label: 'Release Note: UK deferral',
    kind: 'document',
    sourceSystem: 'document_store',
    sourceRecordId: 'documents/2026/REL-0092',
    validity: 'published 2026-05-19',
    derivation: 'Reached from PLV_PAYMENTS_3 via REFERENCES during traversal',
    confidence: 0.88,
    excerpt:
      'UK deferred the PLV_PAYMENTS_3 update to the next release window; no exposure.',
  },
  'kpi:MKT_GR:session_completion': {
    id: 'kpi:MKT_GR:session_completion',
    label: 'kpi_daily · session_completion · MKT_GR',
    kind: 'metric',
    sourceSystem: 'warehouse',
    sourceRecordId: 'warehouse.kpi.kpi_daily',
    validity: '2026-05-18 → 2026-05-27',
    derivation:
      'Authoritative aggregate; used directly from the structured layer',
    confidence: 1.0,
    excerpt:
      'session_completion fell from 0.81 to 0.72 between 21 and 25 May, then recovered.',
  },
}

export function getEvidence(id: string): EvidenceRecord {
  return (
    EVIDENCE[id] ?? {
      id,
      label: id,
      kind: 'record',
      sourceSystem: 'warehouse',
      sourceRecordId: id,
      validity: 'current',
      derivation: 'Direct record',
      confidence: 0.9,
      excerpt: 'No mock excerpt for this record.',
    }
  )
}

/** Evidence path order for the Sources tab (the SCN-007 planted path). */
export const EVIDENCE_PATH_IDS = [
  'INC_S007_GR',
  'PLV_PAYMENTS_3',
  'INC_S007_AT',
  'DOC_S007_GR',
  'DOC_S007_UK',
  'kpi:MKT_GR:session_completion',
]
