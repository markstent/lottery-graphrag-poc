/**
 * The run reducer: one pure function from the state and the next recorded
 * event to the next state. The same events give the same state whether they
 * arrive live, resume after a reconnect or replay from the store, so the UI
 * never keeps retrieval state of its own. Payload types come from the
 * generated contract only (`RunEvent` is a union discriminated on
 * `event_type`).
 */

import type { components } from '../api/schema'
import type { RunEvent } from '../api/stream'

export type { RunEvent }
type Schemas = components['schemas']

export type PipelineId = NonNullable<
  Schemas['QueryRequest']['configurations']
>[number]
export type GraphPipelineId = Exclude<PipelineId, 'A'>
export type ErrorPayload = Schemas['ErrorPayload']
export type CandidateKind = Schemas['GraphCandidateReranked']['kind']
export type DiscardReason = Schemas['GraphNodeDiscarded']['reason']

export type RunStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type PipelineStatus = RunStatus | 'skipped'
export type Stage =
  | 'resolution'
  | 'embedding'
  | 'search'
  | 'traversal'
  | 'rerank'
  | 'context'
  | 'generation'

export interface StageState {
  /** `failed` and `cancelled` mark a stage the run ended while it was running. */
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  /** The event's `t_ms` when the stage began and ended (null while running). */
  startedMs: number
  endedMs: number | null
}

export interface Candidate {
  id: string
  kind: CandidateKind
  rank: number
  similarity: number | null
  rerankScore: number | null
}

export interface Selected {
  id: string
  kind: CandidateKind
  /** Null for a graph node: nodes are ordered by score, not by rank. */
  rank: number | null
  rerankScore: number | null
}

export interface Discarded {
  id: string
  reason: DiscardReason
  rerankScore: number | null
}

/** The generation event's telemetry; the answer text arrives with the run's results. */
export interface Answer {
  model: string
  latencyMs: number
  contextTokens: number
  verdict: string
  citedBlocks: number
}

export interface PipelineState {
  status: PipelineStatus
  stages: Partial<Record<Stage, StageState>>
  candidates: Candidate[]
  selected: Selected[]
  discarded: Discarded[]
  answer: Answer | null
  error: ErrorPayload | null
}

export interface ResolvedEntity {
  id: string
  label: string
  origin: Schemas['GraphEntityResolved']['origin']
  matchedText: string
  viaConcept: string | null
  confidence: number | null
  fusedScore: number | null
}

export interface GraphNode {
  id: string
  /** Null only for a node an outcome event names before any discovery. */
  label: string | null
  hop: number
  seed: boolean
  viaConcept: string | null
  /** `discovered` until the reranker has judged the node. */
  outcome: 'discovered' | 'candidate' | 'selected' | 'discarded'
  reason: DiscardReason | null
  score: number | null
  rerankScore: number | null
}

export interface GraphEdge {
  from: string
  type: string
  to: string
  toLabel: string
  hop: number
}

export interface GraphEvents {
  entities: ResolvedEntity[]
  nodes: GraphNode[]
  relationships: GraphEdge[]
  concepts: { id: string; boundEntities: number }[]
  /**
   * What `graph.evidence_path.completed` recorded: how many paths and the
   * longest in hops. The paths themselves are in the run's results.
   */
  evidencePath: { paths: number; maxHops: number } | null
}

/** An event the reducer has no rule for, kept as received. */
export interface UnknownEvent {
  sequence: number
  event_type: string
  pipeline: string
  payload: unknown
}

export interface RunState {
  status: RunStatus
  error: ErrorPayload | null
  pipelines: Record<PipelineId, PipelineState>
  graph: Record<GraphPipelineId, GraphEvents>
  unknown: { count: number; events: UnknownEvent[] }
  lastSequence: number
}

const PIPELINE_IDS: readonly PipelineId[] = ['A', 'B', 'C']

const emptyPipeline = (): PipelineState => ({
  status: 'pending',
  stages: {},
  candidates: [],
  selected: [],
  discarded: [],
  answer: null,
  error: null,
})

const emptyGraph = (): GraphEvents => ({
  entities: [],
  nodes: [],
  relationships: [],
  concepts: [],
  evidencePath: null,
})

export const initialRunState = (): RunState => ({
  status: 'pending',
  error: null,
  pipelines: { A: emptyPipeline(), B: emptyPipeline(), C: emptyPipeline() },
  graph: { B: emptyGraph(), C: emptyGraph() },
  unknown: { count: 0, events: [] },
  lastSequence: 0,
})

const isPipeline = (id: string): id is PipelineId =>
  (PIPELINE_IDS as readonly string[]).includes(id)

const isGraphPipeline = (id: string): id is GraphPipelineId =>
  id === 'B' || id === 'C'

function updatePipeline(
  state: RunState,
  id: PipelineId,
  change: (pipeline: PipelineState) => PipelineState,
): RunState {
  return {
    ...state,
    pipelines: { ...state.pipelines, [id]: change(state.pipelines[id]) },
  }
}

function updateGraph(
  state: RunState,
  id: GraphPipelineId,
  change: (graph: GraphEvents) => GraphEvents,
): RunState {
  return { ...state, graph: { ...state.graph, [id]: change(state.graph[id]) } }
}

/** Begin `stage` at `t`, ending the stages it follows that are still running. */
function enter(
  pipeline: PipelineState,
  stage: Stage,
  t: number,
  ends: Stage[] = [],
): PipelineState {
  const stages = { ...pipeline.stages }
  for (const earlier of ends) {
    const current = stages[earlier]
    if (current?.status === 'running')
      stages[earlier] = { ...current, status: 'completed', endedMs: t }
  }
  stages[stage] = { status: 'running', startedMs: t, endedMs: null }
  return { ...pipeline, stages }
}

function leave(
  pipeline: PipelineState,
  stage: Stage,
  t: number,
): PipelineState {
  const current = pipeline.stages[stage]
  if (current === undefined) return pipeline
  return {
    ...pipeline,
    stages: {
      ...pipeline.stages,
      [stage]: { ...current, status: 'completed', endedMs: t },
    },
  }
}

/** The context stage has no duration of its own: it is assembled at one instant. */
function assembled(
  pipeline: PipelineState,
  t: number,
  previous: Stage,
): PipelineState {
  const done = leave(pipeline, previous, t)
  return {
    ...done,
    stages: {
      ...done.stages,
      context: { status: 'completed', startedMs: t, endedMs: t },
    },
  }
}

/** End every stage still running at `t` with the status that ended it. */
function endStages(
  pipeline: PipelineState,
  t: number,
  status: 'completed' | 'failed' | 'cancelled',
): PipelineState {
  const stages = { ...pipeline.stages }
  for (const [name, stage] of Object.entries(stages) as [Stage, StageState][]) {
    if (stage.status === 'running')
      stages[name] = { ...stage, status, endedMs: t }
  }
  return { ...pipeline, stages }
}

/**
 * The run's end. Stages still running end with the terminal event. A pipeline
 * that never started is `skipped`, except in an interrupted run, where the
 * server marks it `failed` (the start-up repair in `end_unfinished_run`).
 */
function finishRun(
  state: RunState,
  status: 'completed' | 'failed' | 'cancelled',
  error: ErrorPayload | null,
  t: number,
): RunState {
  const interrupted = status === 'failed' && error?.error_code === 'INTERRUPTED'
  const pipelines = { ...state.pipelines }
  for (const id of PIPELINE_IDS) {
    const ended = endStages(pipelines[id], t, status)
    pipelines[id] =
      ended.status === 'pending'
        ? { ...ended, status: interrupted ? 'failed' : 'skipped' }
        : ended
  }
  return { ...state, status, error, pipelines }
}

const withAnswer = (
  pipeline: PipelineState,
  answer: Answer,
): PipelineState => ({ ...pipeline, answer })

function answerOf(payload: Schemas['GenerationCompleted']): Answer {
  return {
    model: payload.model,
    latencyMs: payload.latency_ms,
    contextTokens: payload.context_tokens,
    verdict: payload.verdict,
    citedBlocks: payload.cited_blocks,
  }
}

function reranked(
  pipeline: PipelineState,
  id: string,
  kind: CandidateKind,
  rank: number,
  rerankScore: number | null,
  similarity: number | null,
): PipelineState {
  const known = pipeline.candidates.find((candidate) => candidate.id === id)
  const candidate: Candidate = {
    id,
    kind: known?.kind ?? kind,
    rank,
    similarity: similarity ?? known?.similarity ?? null,
    rerankScore,
  }
  return {
    ...pipeline,
    candidates:
      known === undefined
        ? [...pipeline.candidates, candidate]
        : pipeline.candidates.map((existing) =>
            existing.id === id ? candidate : existing,
          ),
  }
}

const kindOf = (
  pipeline: PipelineState,
  id: string,
  fallback: CandidateKind,
): CandidateKind =>
  pipeline.candidates.find((candidate) => candidate.id === id)?.kind ?? fallback

const selectedIn = (
  pipeline: PipelineState,
  id: string,
  fallback: CandidateKind,
  rank: number | null,
  rerankScore: number | null,
): PipelineState => ({
  ...pipeline,
  selected: [
    ...pipeline.selected,
    { id, kind: kindOf(pipeline, id, fallback), rank, rerankScore },
  ],
})

const discardedIn = (
  pipeline: PipelineState,
  id: string,
  reason: DiscardReason,
  rerankScore: number | null,
): PipelineState => ({
  ...pipeline,
  discarded: [...pipeline.discarded, { id, reason, rerankScore }],
})

function discovered(
  graph: GraphEvents,
  id: string,
  label: string | null,
  hop: number,
  viaConcept: string | null,
): GraphEvents {
  if (graph.nodes.some((node) => node.id === id)) return graph
  const node: GraphNode = {
    id,
    label,
    hop,
    seed: false,
    viaConcept,
    outcome: 'discovered',
    reason: null,
    score: null,
    rerankScore: null,
  }
  return { ...graph, nodes: [...graph.nodes, node] }
}

function changeNode(
  graph: GraphEvents,
  id: string,
  change: Partial<GraphNode>,
): GraphEvents {
  if (!graph.nodes.some((node) => node.id === id)) {
    return changeNode(discovered(graph, id, null, 0, null), id, change)
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === id ? { ...node, ...change } : node,
    ),
  }
}

function seeded(graph: GraphEvents, id: string): GraphEvents {
  const label = graph.entities.find((entity) => entity.id === id)?.label ?? null
  return changeNode(discovered(graph, id, label, 0, null), id, {
    seed: true,
    hop: 0,
  })
}

function unknownEvent(
  state: RunState,
  event: {
    sequence: number
    event_type: string
    pipeline: string
    payload: unknown
  },
): RunState {
  const { sequence, event_type, pipeline, payload } = event
  return {
    ...state,
    unknown: {
      count: state.unknown.count + 1,
      events: [
        ...state.unknown.events,
        { sequence, event_type, pipeline, payload },
      ],
    },
  }
}

function apply(state: RunState, event: RunEvent): RunState {
  const id = event.pipeline
  const t = event.t_ms
  switch (event.event_type) {
    case 'run.started':
      return { ...state, status: 'running' }
    case 'run.completed':
      return finishRun(state, 'completed', null, t)
    case 'run.failed':
      return finishRun(state, 'failed', event.payload, t)
    case 'run.cancelled':
      return finishRun(state, 'cancelled', event.payload, t)
  }
  if (!isPipeline(id)) return unknownEvent(state, event)
  switch (event.event_type) {
    case 'pipeline.started':
      return updatePipeline(state, id, (p) => ({ ...p, status: 'running' }))
    case 'pipeline.completed':
      return updatePipeline(state, id, (p) => ({ ...p, status: 'completed' }))
    case 'pipeline.failed':
      return updatePipeline(state, id, (p) => ({
        ...endStages(p, t, 'failed'),
        status: 'failed',
        error: event.payload,
      }))
    case 'pipeline.cancelled':
      return updatePipeline(state, id, (p) => ({
        ...endStages(p, t, 'cancelled'),
        status: 'cancelled',
        error: event.payload,
      }))

    case 'rag.query.received':
      return state
    case 'rag.embedding.started':
      return updatePipeline(state, id, (p) => enter(p, 'embedding', t))
    case 'rag.embedding.completed':
      return updatePipeline(state, id, (p) => leave(p, 'embedding', t))
    case 'rag.vector_search.started':
      return updatePipeline(state, id, (p) => enter(p, 'search', t))
    case 'rag.candidate.retrieved': {
      const { chunk_id, rank, similarity } = event.payload
      return updatePipeline(state, id, (p) => ({
        ...p,
        candidates: [
          ...p.candidates,
          { id: chunk_id, kind: 'chunk', rank, similarity, rerankScore: null },
        ],
      }))
    }
    case 'rag.rerank.started':
      return updatePipeline(state, id, (p) => enter(p, 'rerank', t, ['search']))
    case 'rag.candidate.reranked': {
      const { chunk_id, rank, rerank_score, similarity } = event.payload
      return updatePipeline(state, id, (p) =>
        reranked(p, chunk_id, 'chunk', rank, rerank_score, similarity),
      )
    }
    case 'rag.evidence.selected': {
      const { chunk_id, rank } = event.payload
      return updatePipeline(state, id, (p) =>
        selectedIn(
          p,
          chunk_id,
          'chunk',
          rank,
          p.candidates.find((c) => c.id === chunk_id)?.rerankScore ?? null,
        ),
      )
    }
    case 'rag.evidence.discarded': {
      const { chunk_id, reason } = event.payload
      return updatePipeline(state, id, (p) =>
        discardedIn(
          p,
          chunk_id,
          reason,
          p.candidates.find((c) => c.id === chunk_id)?.rerankScore ?? null,
        ),
      )
    }
    case 'rag.context.assembled':
      return updatePipeline(state, id, (p) => assembled(p, t, 'rerank'))
    case 'rag.generation.started':
      return updatePipeline(state, id, (p) => enter(p, 'generation', t))
    case 'rag.generation.completed':
      return updatePipeline(state, id, (p) =>
        withAnswer(leave(p, 'generation', t), answerOf(event.payload)),
      )
  }
  if (!isGraphPipeline(id)) return unknownEvent(state, event)
  switch (event.event_type) {
    case 'graph.entity_resolution.started':
      return updatePipeline(state, id, (p) => enter(p, 'resolution', t))
    case 'graph.entity.resolved': {
      const p = event.payload
      const entity: ResolvedEntity = {
        id: p.entity_id,
        label: p.node_label,
        origin: p.origin,
        matchedText: p.matched_text,
        viaConcept: p.via_concept,
        confidence: p.confidence ?? null,
        fusedScore: p.fused_score ?? null,
      }
      return updateGraph(state, id, (g) => ({
        ...g,
        entities: [...g.entities, entity],
      }))
    }
    case 'graph.query.expanded':
      return state
    case 'graph.seed.selected':
      return updateGraph(state, id, (g) => seeded(g, event.payload.node_id))
    case 'graph.traversal.started':
      return updatePipeline(state, id, (p) =>
        enter(p, 'traversal', t, ['resolution']),
      )
    case 'graph.node.discovered': {
      const { node_id, node_label, hop, via_concept } = event.payload
      return updateGraph(state, id, (g) =>
        discovered(g, node_id, node_label, hop, via_concept ?? null),
      )
    }
    case 'graph.relationship.traversed': {
      const p = event.payload
      const edge: GraphEdge = {
        from: p.from_id,
        type: p.relationship_type,
        to: p.to_id,
        toLabel: p.to_label,
        hop: p.hop,
      }
      return updateGraph(state, id, (g) => ({
        ...g,
        relationships: [...g.relationships, edge],
      }))
    }
    case 'graph.ontology.expanded': {
      const { concept_id, bound_entities } = event.payload
      return updateGraph(state, id, (g) => ({
        ...g,
        concepts: [
          ...g.concepts,
          { id: concept_id, boundEntities: bound_entities },
        ],
      }))
    }
    case 'graph.rerank.started':
      return updatePipeline(state, id, (p) =>
        enter(p, 'rerank', t, ['resolution', 'traversal']),
      )
    case 'graph.candidate.reranked': {
      const { candidate_id, kind, rank, rerank_score } = event.payload
      const next = updatePipeline(state, id, (p) =>
        reranked(p, candidate_id, kind, rank, rerank_score, null),
      )
      const known = state.graph[id].nodes.find((n) => n.id === candidate_id)
      return kind === 'node' && known?.outcome === 'discovered'
        ? updateGraph(next, id, (g) =>
            changeNode(g, candidate_id, { outcome: 'candidate' }),
          )
        : next
    }
    case 'graph.candidate.selected': {
      const payload = event.payload
      if ('node_id' in payload) {
        const next = updateGraph(state, id, (g) =>
          changeNode(g, payload.node_id, {
            outcome: 'selected',
            score: payload.score,
            rerankScore: payload.rerank_score,
          }),
        )
        return updatePipeline(next, id, (p) =>
          selectedIn(p, payload.node_id, 'node', null, payload.rerank_score),
        )
      }
      return updatePipeline(state, id, (p) =>
        selectedIn(
          p,
          payload.chunk_id,
          'chunk',
          payload.rank,
          payload.rerank_score,
        ),
      )
    }
    case 'graph.candidate.discarded': {
      const payload = event.payload
      if ('node_id' in payload) {
        const next = updateGraph(state, id, (g) =>
          changeNode(g, payload.node_id, {
            outcome: 'discarded',
            reason: payload.reason,
            score: payload.score,
            rerankScore: payload.rerank_score,
          }),
        )
        return updatePipeline(next, id, (p) =>
          discardedIn(p, payload.node_id, payload.reason, payload.rerank_score),
        )
      }
      return updatePipeline(state, id, (p) =>
        discardedIn(p, payload.chunk_id, payload.reason, payload.rerank_score),
      )
    }
    case 'graph.evidence_path.completed': {
      const { paths, max_hops } = event.payload
      return updateGraph(state, id, (g) => ({
        ...g,
        evidencePath: { paths, maxHops: max_hops },
      }))
    }
    case 'graph.context.assembled':
      return updatePipeline(state, id, (p) => assembled(p, t, 'rerank'))
    case 'graph.generation.started':
      return updatePipeline(state, id, (p) => enter(p, 'generation', t))
    case 'graph.generation.completed':
      return updatePipeline(state, id, (p) =>
        withAnswer(leave(p, 'generation', t), answerOf(event.payload)),
      )
  }
  return unknownEvent(state, event)
}

/**
 * The state after `event`. An event at or below `lastSequence` is a replay
 * and returns the same state; an event type this contract does not know is
 * kept in `state.unknown`, never dropped.
 */
export function reduce(state: RunState, event: RunEvent): RunState {
  if (event.sequence <= state.lastSequence) return state
  return { ...apply(state, event), lastSequence: event.sequence }
}

export const reduceAll = (events: RunEvent[]): RunState =>
  events.reduce(reduce, initialRunState())
