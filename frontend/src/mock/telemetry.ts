/**
 * Mock retrieval telemetry for the Phase 7 prototype (docs/07 sections 7-11).
 *
 * The event shapes follow the API event contract; the stream replays the
 * planted SCN-007 story from the development world (data/truth/ledger.json
 * ids: PLV_PAYMENTS_3, INC_S007_GR/AT/CZ, DOC_S007_GR/UK). Playback drives
 * the UI purely from event prefixes, so rewind and replay are exact.
 */

export type RagEvent =
  | { kind: 'query_received'; t: number }
  | { kind: 'embedding_started'; t: number }
  | { kind: 'embedding_completed'; t: number; dimensions: number }
  | { kind: 'candidates_retrieved'; t: number; chunks: MockChunk[] }
  | { kind: 'similarity_scored'; t: number }
  | { kind: 'reranking_completed'; t: number; order: string[] }
  | { kind: 'context_selected'; t: number; chunkIds: string[] }
  | { kind: 'context_assembled'; t: number; tokenCount: number }
  | { kind: 'answer_streaming'; t: number }
  | { kind: 'answer_completed'; t: number; answer: MockAnswer }

export interface MockChunk {
  id: string
  sourceType: 'document' | 'metric' | 'record'
  title: string
  similarity: number
  selected: boolean
}

export interface MockAnswer {
  text: string
  citations: MockCitation[]
  latencyMs: number
  contextTokens: number
}

export interface MockCitation {
  id: string
  label: string
  sourceSystem: string
  sourceRecordId: string
  kind: 'document' | 'metric' | 'record' | 'graph-node'
}

export type GraphNodeState =
  | 'seed'
  | 'active'
  | 'candidate'
  | 'traversed'
  | 'selected'
  | 'discarded'
  | 'ontology'
  | 'source_record'

export type GraphEdgeState =
  'candidate' | 'active' | 'traversed' | 'evidence_path'

export interface GraphNode {
  id: string
  label: string
  kind:
    | 'market'
    | 'game'
    | 'platform'
    | 'platform_version'
    | 'incident'
    | 'document'
    | 'concept'
  market?: string
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  label: string
}

export type GraphEvent =
  | { kind: 'query_received'; t: number }
  | { kind: 'seed_resolution'; t: number; nodes: GraphNode[] }
  | { kind: 'traversal_started'; t: number }
  | {
      kind: 'relationship_traversed'
      t: number
      edge: GraphEdge
      to: GraphNode
      state: 'active' | 'candidate'
    }
  | {
      kind: 'ontology_mapping_applied'
      t: number
      concept: GraphNode
      connects: string[]
    }
  | { kind: 'candidate_rejected'; t: number; nodeId: string }
  | { kind: 'evidence_selected'; t: number; nodeIds: string[]; path: string[] }
  | { kind: 'context_assembled'; t: number; tokenCount: number }
  | { kind: 'answer_streaming'; t: number }
  | { kind: 'answer_completed'; t: number; answer: MockAnswer }

export type EvaluationEvent = {
  kind: 'evaluation_completed'
  t: number
  scores: ScoreStrip
}

export interface ScoreStrip {
  correctness: { baseline: number; graph: number }
  evidenceRecall: { baseline: number; graph: number }
  grounding: { baseline: number; graph: number }
  latencyMs: { baseline: number; graph: number }
  contextTokens: { baseline: number; graph: number }
  extended: {
    relationshipDiscovery: { baseline: number; graph: number }
    crossMarketDiscovery: { baseline: number; graph: number }
    ontologyContribution: { baseline: number; graph: number }
  }
}

export interface MockRun {
  runId: string
  question: string
  rag: RagEvent[]
  graph: GraphEvent[]
  evaluation: EvaluationEvent[]
  /** Whether the question has an answer key: a bank question has, ad hoc text has none. */
  answerKey?: 'none' | 'available'
  /** Where the run stands with its answer key (backend score_status). */
  scoreStatus?: ScoreStatus
  /** A completed bank question's scores against its answer key; null when not scored. */
  liveScore?: LiveScore | null
}

/** Ad hoc, cancelled and failed runs are not scored; a completed bank question is pending, then scored or failed. */
export type ScoreStatus = 'not_applicable' | 'pending' | 'scored' | 'failed'

/** One pipeline's deterministic scores on a live bank question (backend LivePipelineScore). */
export interface LivePipelineScore {
  answer: number | null
  evidence_f1: number | null
  anchor_resolution: number | null
  failure_class: string | null
}

/** A live bank question scored against its answer key (backend LiveScore). */
export interface LiveScore {
  instance_id: string
  label: 'scored against the answer key'
  per_pipeline: Record<string, LivePipelineScore>
}

const node = (
  id: string,
  label: string,
  kind: GraphNode['kind'],
  market?: string,
): GraphNode => ({ id, label, kind, market })

// ---------------------------------------------------------------- the story

const SEEDS: GraphNode[] = [
  node('MKT_GR', 'Greece', 'market'),
  node('GAME_GR_01', 'Aegean Gold', 'game', 'MKT_GR'),
]

const KPI_CHUNKS: MockChunk[] = [
  {
    id: 'CHNK_S007_GR_00',
    sourceType: 'document',
    title: 'Incident Report: INC_S007_GR',
    similarity: 0.82,
    selected: true,
  },
  {
    id: 'CHNK_0112_00',
    sourceType: 'metric',
    title: 'kpi_daily · MKT_GR · session_completion',
    similarity: 0.74,
    selected: true,
  },
  {
    id: 'CHNK_0045_01',
    sourceType: 'document',
    title: 'Marketing Brief: CMP_004',
    similarity: 0.58,
    selected: false,
  },
  {
    id: 'CHNK_0198_00',
    sourceType: 'record',
    title: 'support_cases · payment failures',
    similarity: 0.51,
    selected: false,
  },
]

export const MOCK_RUN: MockRun = {
  runId: 'RUN-2026-10-07-01',
  question:
    'Why did digital conversion fall in Greece, and have we seen the same issue elsewhere?',
  rag: [
    { kind: 'query_received', t: 0 },
    { kind: 'embedding_started', t: 160 },
    { kind: 'embedding_completed', t: 620, dimensions: 1024 },
    { kind: 'candidates_retrieved', t: 940, chunks: KPI_CHUNKS },
    { kind: 'similarity_scored', t: 1180 },
    {
      kind: 'reranking_completed',
      t: 1520,
      order: ['CHNK_S007_GR_00', 'CHNK_0112_00', 'CHNK_0045_01'],
    },
    {
      kind: 'context_selected',
      t: 1760,
      chunkIds: ['CHNK_S007_GR_00', 'CHNK_0112_00'],
    },
    { kind: 'context_assembled', t: 1980, tokenCount: 1840 },
    { kind: 'answer_streaming', t: 2200 },
    {
      kind: 'answer_completed',
      t: 4200,
      answer: {
        text:
          'Digital conversion in Greece fell after the payment checkout regression on 21 May. ' +
          'The incident report describes checkout failures following a platform change. ' +
          'No comparable pattern is described for other markets in the retrieved context.',
        citations: [
          {
            id: 'DOC_S007_GR',
            label: 'Incident Report: INC_S007_GR',
            sourceSystem: 'document_store',
            sourceRecordId: 'DOC_S007_GR',
            kind: 'document',
          },
          {
            id: 'kpi:MKT_GR:session_completion',
            label: 'kpi_daily · session_completion · MKT_GR',
            sourceSystem: 'warehouse',
            sourceRecordId: 'kpi_daily',
            kind: 'metric',
          },
        ],
        latencyMs: 4200,
        contextTokens: 1840,
      },
    },
  ],
  graph: [
    { kind: 'query_received', t: 0 },
    {
      kind: 'seed_resolution',
      t: 260,
      nodes: [
        ...SEEDS,
        node('CONCEPT_PLATFORM_INCIDENT', 'Platform Incident', 'concept'),
      ],
    },
    { kind: 'traversal_started', t: 520 },
    {
      kind: 'relationship_traversed',
      t: 760,
      edge: {
        id: 'e1',
        from: 'MKT_GR',
        to: 'GAME_GR_01',
        label: 'AVAILABLE_IN',
      },
      to: SEEDS[1],
      state: 'active',
    },
    {
      kind: 'relationship_traversed',
      t: 1020,
      edge: {
        id: 'e2',
        from: 'GAME_GR_01',
        to: 'PLT_PAYMENTS',
        label: 'RUNS_ON',
      },
      to: node('PLT_PAYMENTS', 'Payments Platform', 'platform'),
      state: 'active',
    },
    {
      kind: 'relationship_traversed',
      t: 1300,
      edge: {
        id: 'e3',
        from: 'PLT_PAYMENTS',
        to: 'PLV_PAYMENTS_3',
        label: 'VERSION_OF',
      },
      to: node('PLV_PAYMENTS_3', 'Payments v3', 'platform_version'),
      state: 'active',
    },
    {
      kind: 'relationship_traversed',
      t: 1580,
      edge: {
        id: 'e4',
        from: 'PLV_PAYMENTS_3',
        to: 'INC_S007_GR',
        label: 'RELATED_TO_VERSION',
      },
      to: node('INC_S007_GR', 'Incident · Greece', 'incident', 'MKT_GR'),
      state: 'active',
    },
    {
      kind: 'relationship_traversed',
      t: 1860,
      edge: {
        id: 'e5',
        from: 'PLV_PAYMENTS_3',
        to: 'INC_S007_AT',
        label: 'RELATED_TO_VERSION',
      },
      to: node('INC_S007_AT', 'Incident · Austria', 'incident', 'MKT_AT'),
      state: 'candidate',
    },
    {
      kind: 'relationship_traversed',
      t: 2060,
      edge: {
        id: 'e6',
        from: 'PLV_PAYMENTS_3',
        to: 'INC_S007_CZ',
        label: 'RELATED_TO_VERSION',
      },
      to: node('INC_S007_CZ', 'Incident · Czechia', 'incident', 'MKT_CZ'),
      state: 'candidate',
    },
    {
      kind: 'ontology_mapping_applied',
      t: 2340,
      concept: node(
        'CONCEPT_PLATFORM_INCIDENT',
        'Platform Incident',
        'concept',
      ),
      connects: ['INC_S007_GR', 'INC_S007_AT', 'INC_S007_CZ'],
    },
    { kind: 'candidate_rejected', t: 2520, nodeId: 'INC_S007_CZ' },
    {
      kind: 'evidence_selected',
      t: 2740,
      nodeIds: ['INC_S007_GR', 'INC_S007_AT', 'PLV_PAYMENTS_3'],
      path: ['INC_S007_GR', 'PLV_PAYMENTS_3', 'INC_S007_AT'],
    },
    {
      kind: 'relationship_traversed',
      t: 2980,
      edge: {
        id: 'e7',
        from: 'INC_S007_GR',
        to: 'DOC_S007_GR',
        label: 'REFERENCES',
      },
      to: node('DOC_S007_GR', 'Incident Report (el)', 'document', 'MKT_GR'),
      state: 'active',
    },
    {
      kind: 'relationship_traversed',
      t: 3160,
      edge: {
        id: 'e8',
        from: 'PLV_PAYMENTS_3',
        to: 'DOC_S007_UK',
        label: 'REFERENCES',
      },
      to: node(
        'DOC_S007_UK',
        'Release Note: UK deferral (en)',
        'document',
        'MKT_UK',
      ),
      state: 'active',
    },
    { kind: 'context_assembled', t: 3420, tokenCount: 2210 },
    { kind: 'answer_streaming', t: 3600 },
    {
      kind: 'answer_completed',
      t: 5400,
      answer: {
        text:
          'Greek digital conversion fell because platform version PLV_PAYMENTS_3 introduced a ' +
          'checkout regression (INC_S007_GR). The same platform version caused similar incidents ' +
          'in Austria (INC_S007_AT, medium) and Czechia (INC_S007_CZ, low). The UK was unaffected: ' +
          'its rollout of the same version was deferred (DOC_S007_UK).',
        citations: [
          {
            id: 'INC_S007_GR',
            label: 'Incident · Greece',
            sourceSystem: 'warehouse',
            sourceRecordId: 'INC_S007_GR',
            kind: 'graph-node',
          },
          {
            id: 'PLV_PAYMENTS_3',
            label: 'Payments v3',
            sourceSystem: 'warehouse',
            sourceRecordId: 'PLV_PAYMENTS_3',
            kind: 'graph-node',
          },
          {
            id: 'INC_S007_AT',
            label: 'Incident · Austria',
            sourceSystem: 'warehouse',
            sourceRecordId: 'INC_S007_AT',
            kind: 'graph-node',
          },
          {
            id: 'DOC_S007_UK',
            label: 'Release Note: UK deferral',
            sourceSystem: 'document_store',
            sourceRecordId: 'DOC_S007_UK',
            kind: 'document',
          },
        ],
        latencyMs: 5400,
        contextTokens: 2210,
      },
    },
  ],
  evaluation: [
    {
      kind: 'evaluation_completed',
      t: 5800,
      scores: {
        correctness: { baseline: 0.55, graph: 0.92 },
        evidenceRecall: { baseline: 0.4, graph: 0.86 },
        grounding: { baseline: 0.78, graph: 0.94 },
        latencyMs: { baseline: 4200, graph: 5400 },
        contextTokens: { baseline: 1840, graph: 2210 },
        extended: {
          relationshipDiscovery: { baseline: 0.1, graph: 0.9 },
          crossMarketDiscovery: { baseline: 0.0, graph: 1.0 },
          ontologyContribution: { baseline: 0.0, graph: 0.8 },
        },
      },
    },
  ],
}

// --------------------------------------------------------------- projection

export interface RagPaneState {
  stage:
    | 'idle'
    | 'embedding'
    | 'retrieving'
    | 'reranking'
    | 'assembling'
    | 'answering'
    | 'done'
  chunks: MockChunk[]
  selectedIds: string[]
  tokenCount: number | null
  answer: MockAnswer | null
}

export function projectRag(events: RagEvent[]): RagPaneState {
  const state: RagPaneState = {
    stage: 'idle',
    chunks: [],
    selectedIds: [],
    tokenCount: null,
    answer: null,
  }
  for (const event of events) {
    switch (event.kind) {
      case 'embedding_started':
        state.stage = 'embedding'
        break
      case 'candidates_retrieved':
        state.stage = 'retrieving'
        state.chunks = event.chunks
        break
      case 'reranking_completed':
        state.stage = 'reranking'
        state.chunks = state.chunks.map((chunk) => ({
          ...chunk,
          similarity: Math.min(0.99, chunk.similarity + 0.02),
        }))
        break
      case 'context_selected':
        state.selectedIds = event.chunkIds
        break
      case 'context_assembled':
        state.stage = 'assembling'
        state.tokenCount = event.tokenCount
        break
      case 'answer_streaming':
        state.stage = 'answering'
        break
      case 'answer_completed':
        state.stage = 'done'
        state.answer = event.answer
        break
      default:
        break
    }
  }
  return state
}

export interface GraphPaneState {
  stage: 'idle' | 'seeding' | 'traversing' | 'selecting' | 'answering' | 'done'
  nodes: Map<string, GraphNode & { state: GraphNodeState }>
  edges: Map<string, GraphEdge & { state: GraphEdgeState }>
  evidencePath: string[]
  tokenCount: number | null
  answer: MockAnswer | null
}

/**
 * Fold an event prefix into pane state. Node/edge states progress from
 * candidate → traversed/active → selected/discarded exactly as the events
 * arrive (docs/06 section 5); nothing is pre-rendered.
 */
export function projectGraph(events: GraphEvent[]): GraphPaneState {
  const state: GraphPaneState = {
    stage: 'idle',
    nodes: new Map(),
    edges: new Map(),
    evidencePath: [],
    tokenCount: null,
    answer: null,
  }
  const apply = (id: string, nodeState: GraphNodeState) => {
    const existing = state.nodes.get(id)
    if (existing) existing.state = nodeState
  }
  for (const event of events) {
    switch (event.kind) {
      case 'seed_resolution':
        state.stage = 'seeding'
        for (const seed of event.nodes)
          state.nodes.set(seed.id, { ...seed, state: 'seed' })
        break
      case 'traversal_started':
        state.stage = 'traversing'
        break
      case 'relationship_traversed':
        // Seeds never regress: a traversal back to an existing node (e.g.
        // MKT_GR -> GAME_GR_01) must not overwrite the seed state.
        if (!state.nodes.has(event.to.id)) {
          state.nodes.set(event.to.id, {
            ...event.to,
            state: event.state === 'candidate' ? 'candidate' : 'traversed',
          })
        }
        state.edges.set(event.edge.id, {
          ...event.edge,
          state: event.state === 'candidate' ? 'candidate' : 'active',
        })
        break
      case 'ontology_mapping_applied':
        state.nodes.set(event.concept.id, {
          ...event.concept,
          state: 'ontology',
        })
        for (const id of event.connects) apply(id, 'traversed')
        break
      case 'candidate_rejected':
        apply(event.nodeId, 'discarded')
        break
      case 'evidence_selected':
        state.stage = 'selecting'
        state.evidencePath = event.path
        for (const id of event.nodeIds) apply(id, 'selected')
        for (const [, edge] of state.edges) {
          if (
            event.nodeIds.includes(edge.from) &&
            event.nodeIds.includes(edge.to)
          ) {
            edge.state = 'evidence_path'
          } else if (edge.state === 'active') {
            edge.state = 'traversed'
          }
        }
        break
      case 'context_assembled':
        state.tokenCount = event.tokenCount
        break
      case 'answer_streaming':
        state.stage = 'answering'
        break
      case 'answer_completed':
        state.stage = 'done'
        state.answer = event.answer
        break
      default:
        break
    }
  }
  return state
}
