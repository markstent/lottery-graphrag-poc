/**
 * Backend run source (docs/07 sections 3-6): executes a question through
 * the real A/B/C pipelines and maps the recorded events and results onto
 * the MockRun shape the playback state and projectors already consume.
 *
 * Honesty rules: only recorded backend events drive the streams; timing
 * offsets come from the recorded t_ms; evaluation metrics come from the
 * published benchmark summary for the matched question (or null), never
 * from per-run guesses. The ledger is never read anywhere in this path.
 */

import type {
  BenchmarkResults,
  ComplexityRow,
  FailureRow,
} from '../mock/content'
import type {
  GraphEdge,
  GraphEvent,
  GraphNode,
  MockAnswer,
  MockChunk,
  MockRun,
  RagEvent,
  ScoreStrip,
} from '../mock/telemetry'

const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) ??
  'http://localhost:8000'

export interface BackendQuestion {
  id: string
  question: string
  category: string
  profile?: 'fraud' | null
  configurations?: string[]
  benchmarkQuestionId?: string | null
}

interface RecordedEvent {
  sequence: number
  event_type: string
  pipeline: string
  t_ms: number
  payload: Record<string, unknown>
}

interface AnswerDto {
  text: string
  latency_ms: number
  context_tokens: number
  citations: {
    chunk_id: string
    title: string
    source_system: string
    source_record_id: string
  }[]
}

interface EvidenceDto {
  chunk_id: string
  document_id: string
  title: string
  similarity: number
  selected: boolean
  source_system: string
  source_record_id?: string
}

interface NodeEvidenceDto {
  node_id: string
  node_label: string
  hops: number
  rel_type: string
  selected: boolean
}

interface ResultsDto {
  run_id: string
  status: 'running' | 'completed' | 'failed'
  results: Record<
    string,
    {
      answer: AnswerDto
      evidence?: EvidenceDto[]
      node_evidence?: NodeEvidenceDto[]
    }
  >
  error: { error_code: string; message: string } | null
}

interface BenchmarkQuestionResult {
  question_id: string
  scores: Record<string, Record<string, number | string | null>>
}

const timeout = (ms: number): Promise<never> =>
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('run timed out')), ms),
  )

async function postQuery(
  question: BackendQuestion,
  marketScope: readonly string[],
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/v1/queries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: question.question,
      configurations: question.configurations ?? ['A', 'B', 'C'],
      profile: question.profile ?? null,
      market_scope: marketScope,
    }),
  })
  if (!response.ok) throw new Error(`query rejected (${response.status})`)
  const body = (await response.json()) as { run_id: string }
  return body.run_id
}

async function awaitResults(runId: string): Promise<ResultsDto> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await fetch(`${API_BASE}/api/v1/queries/${runId}`)
    if (!response.ok)
      throw new Error(`results unavailable (${response.status})`)
    const body = (await response.json()) as ResultsDto
    if (body.status !== 'running') return body
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('run did not finish')
}

async function fetchEvents(runId: string): Promise<RecordedEvent[]> {
  const response = await fetch(`${API_BASE}/api/v1/queries/${runId}/events`)
  if (!response.ok) throw new Error(`events unavailable (${response.status})`)
  const body = (await response.json()) as { events: RecordedEvent[] }
  return body.events
}

/** Per-question scores of the published run, and whether that run is v2. */
interface QuestionBenchmark {
  questions: Map<string, BenchmarkQuestionResult>
  v2Published: boolean
}

async function fetchBenchmark(
  questionId: string | null | undefined,
): Promise<QuestionBenchmark> {
  const none = { questions: new Map(), v2Published: false }
  if (!questionId) return none
  try {
    const response = await fetch(`${API_BASE}/api/v1/benchmarks/latest`)
    if (!response.ok) return none
    const body = (await response.json()) as {
      questions?: BenchmarkQuestionResult[]
      summary?: { schema_version?: string } | null
    }
    // A v2 summary has no per-question scores; the Live Lab says so.
    if (isV2Summary(body.summary)) return { ...none, v2Published: true }
    return {
      questions: new Map(
        (body.questions ?? []).map((entry) => [entry.question_id, entry]),
      ),
      v2Published: false,
    }
  } catch {
    // API offline: the run still plays, without published scores.
    return none
  }
}

function isV2Summary(summary: object | null | undefined): boolean {
  return (
    !!summary &&
    'schema_version' in summary &&
    summary.schema_version === BENCHMARK_V2_SCHEMA
  )
}

function chunkSource(sourceSystem: string): MockChunk['sourceType'] {
  if (sourceSystem.includes('kpi') || sourceSystem.includes('metric'))
    return 'metric'
  if (sourceSystem.includes('warehouse') || sourceSystem.includes('support'))
    return 'record'
  return 'document'
}

function toAnswer(answer: AnswerDto): MockAnswer {
  return {
    text: answer.text,
    latencyMs: Math.round(answer.latency_ms),
    contextTokens: answer.context_tokens,
    citations: answer.citations.map((citation) => ({
      id: citation.chunk_id,
      label: citation.title,
      sourceSystem: citation.source_system,
      sourceRecordId: citation.source_record_id,
      kind: chunkSource(citation.source_system),
    })),
  }
}

function ragEvents(
  events: RecordedEvent[],
  evidence: EvidenceDto[] | undefined,
): RagEvent[] {
  const byId = new Map((evidence ?? []).map((chunk) => [chunk.chunk_id, chunk]))
  const mapped: RagEvent[] = []
  for (const event of events) {
    const t = event.t_ms
    switch (event.event_type) {
      case 'rag.query.received':
        mapped.push({ kind: 'query_received', t })
        break
      case 'rag.embedding.started':
        mapped.push({ kind: 'embedding_started', t })
        break
      case 'rag.embedding.completed':
        mapped.push({
          kind: 'embedding_completed',
          t,
          dimensions: Number(event.payload.dimensions),
        })
        break
      case 'rag.candidate.retrieved': {
        const chunkId = String(event.payload.chunk_id)
        const known = byId.get(chunkId)
        const previous = mapped.find(
          (entry) => entry.kind === 'candidates_retrieved',
        ) as Extract<RagEvent, { kind: 'candidates_retrieved' }> | undefined
        const chunk: MockChunk = {
          id: chunkId,
          sourceType: chunkSource(known?.source_system ?? 'document_store'),
          title: known?.title ?? chunkId,
          similarity: Number(event.payload.similarity),
          selected: known?.selected ?? false,
        }
        if (previous) previous.chunks.push(chunk)
        else mapped.push({ kind: 'candidates_retrieved', t, chunks: [chunk] })
        break
      }
      case 'rag.candidate.reranked':
        mapped.push({ kind: 'similarity_scored', t })
        break
      case 'rag.evidence.selected': {
        const previous = mapped.find(
          (entry) => entry.kind === 'context_selected',
        ) as Extract<RagEvent, { kind: 'context_selected' }> | undefined
        if (previous) previous.chunkIds.push(String(event.payload.chunk_id))
        else
          mapped.push({
            kind: 'context_selected',
            t,
            chunkIds: [String(event.payload.chunk_id)],
          })
        break
      }
      case 'rag.context.assembled':
        mapped.push({
          kind: 'context_assembled',
          t,
          tokenCount: Number(event.payload.context_tokens),
        })
        break
      case 'rag.generation.started':
        mapped.push({ kind: 'answer_streaming', t })
        break
      default:
        break
    }
  }
  return mapped
}

function graphEvents(
  events: RecordedEvent[],
  nodeEvidence: NodeEvidenceDto[] | undefined,
): GraphEvent[] {
  const labels = new Map(
    (nodeEvidence ?? []).map((node) => [node.node_id, node.node_label]),
  )
  const nodeOf = (
    id: string,
    label?: string,
    kind: GraphNode['kind'] = 'document',
  ): GraphNode => ({
    id,
    label: label ?? labels.get(id) ?? id,
    kind,
  })
  const mapped: GraphEvent[] = []
  for (const event of events) {
    const t = event.t_ms
    switch (event.event_type) {
      case 'graph.query.received':
      case 'rag.query.received':
        mapped.push({ kind: 'query_received', t })
        break
      case 'graph.seed.selected': {
        const previous = mapped.find(
          (entry) => entry.kind === 'seed_resolution',
        )
        if (!previous)
          mapped.push({
            kind: 'seed_resolution',
            t,
            nodes: [nodeOf(String(event.payload.node_id))],
          })
        break
      }
      case 'graph.entity.resolved': {
        const label = String(event.payload.node_label ?? '')
        const kind =
          label === 'BusinessConcept' ? 'concept' : kindForLabel(label)
        const seeds = mapped.find((entry) => entry.kind === 'seed_resolution')
        if (seeds && seeds.kind === 'seed_resolution') {
          if (
            !seeds.nodes.some(
              (node) => node.id === String(event.payload.entity_id),
            )
          )
            seeds.nodes.push(
              nodeOf(String(event.payload.entity_id), undefined, kind),
            )
        } else {
          mapped.push({
            kind: 'seed_resolution',
            t,
            nodes: [nodeOf(String(event.payload.entity_id), undefined, kind)],
          })
        }
        break
      }
      case 'graph.traversal.started':
        mapped.push({ kind: 'traversal_started', t })
        break
      case 'graph.relationship.traversed': {
        const edge: GraphEdge = {
          id: `${String(event.payload.from_id)}-${String(event.payload.relationship_type)}-${String(event.payload.to_id)}`,
          from: String(event.payload.from_id),
          to: String(event.payload.to_id),
          label: String(event.payload.relationship_type),
        }
        mapped.push({
          kind: 'relationship_traversed',
          t,
          edge,
          to: nodeOf(
            String(event.payload.to_id),
            String(event.payload.to_label ?? ''),
          ),
          state: 'candidate',
        })
        break
      }
      case 'graph.ontology.expanded':
        mapped.push({
          kind: 'ontology_mapping_applied',
          t,
          concept: nodeOf(
            String(event.payload.concept_id),
            undefined,
            'concept',
          ),
          connects: (
            (event.payload.bound_entities as string[] | undefined) ?? []
          ).map(String),
        })
        break
      case 'graph.candidate.discarded':
        mapped.push({
          kind: 'candidate_rejected',
          t,
          nodeId: String(event.payload.node_id),
        })
        break
      case 'graph.candidate.selected': {
        const nodeId = String(event.payload.node_id)
        const selected = mapped.find(
          (entry) => entry.kind === 'evidence_selected',
        )
        if (selected && selected.kind === 'evidence_selected') {
          if (!selected.nodeIds.includes(nodeId)) selected.nodeIds.push(nodeId)
        } else {
          mapped.push({
            kind: 'evidence_selected',
            t,
            nodeIds: [nodeId],
            path: [],
          })
        }
        break
      }
      case 'graph.context.assembled':
        mapped.push({
          kind: 'context_assembled',
          t,
          tokenCount: Number(event.payload.context_tokens),
        })
        break
      case 'graph.generation.started':
        mapped.push({ kind: 'answer_streaming', t })
        break
      default:
        break
    }
  }
  return mapped
}

function kindForLabel(label: string): GraphNode['kind'] {
  const normalized = label.toLowerCase()
  if (normalized.includes('market')) return 'market'
  if (normalized.includes('game')) return 'game'
  if (normalized.includes('platformversion')) return 'platform_version'
  if (normalized.includes('platform')) return 'platform'
  if (normalized.includes('incident')) return 'incident'
  if (normalized.includes('concept')) return 'concept'
  return 'document'
}

/**
 * Quality metrics come only from the published benchmark for the matched
 * question; grounding and the extended discovery metrics have no per-run
 * measurement and stay at the published values (zero when absent). There
 * is no per-run fabrication: if no benchmark result matches, the caller
 * omits the evaluation event and the strip keeps its waiting state.
 */
function scoreStrip(
  results: ResultsDto,
  benchmark: Map<string, BenchmarkQuestionResult>,
  benchmarkQuestionId: string | null | undefined,
): ScoreStrip {
  const baseline = results.results.A
  const graph = results.results.C ?? results.results.B
  const published = benchmarkQuestionId
    ? benchmark.get(benchmarkQuestionId)
    : undefined
  const scoreFor = (pipeline: string, metric: string): number => {
    const value = published?.scores?.[pipeline]?.[metric]
    return typeof value === 'number' ? value : 0
  }
  return {
    latencyMs: {
      baseline: Math.round(baseline?.answer.latency_ms ?? 0),
      graph: Math.round(graph?.answer.latency_ms ?? 0),
    },
    contextTokens: {
      baseline: baseline?.answer.context_tokens ?? 0,
      graph: graph?.answer.context_tokens ?? 0,
    },
    correctness: {
      baseline: scoreFor('A', 'answer_score'),
      graph: scoreFor('C', 'answer_score') || scoreFor('B', 'answer_score'),
    },
    evidenceRecall: {
      baseline: scoreFor('A', 'evidence_recall'),
      graph:
        scoreFor('C', 'evidence_recall') || scoreFor('B', 'evidence_recall'),
    },
    grounding: {
      baseline: scoreFor('A', 'evidence_precision'),
      graph:
        scoreFor('C', 'evidence_precision') ||
        scoreFor('B', 'evidence_precision'),
    },
    extended: {
      relationshipDiscovery: {
        baseline: 0,
        graph:
          graph?.node_evidence?.filter((node) => node.selected).length ?? 0,
      },
      crossMarketDiscovery: { baseline: 0, graph: 0 },
      ontologyContribution: { baseline: 0, graph: 0 },
    },
  }
}

/** Published harness aggregate (summary.json written by the runner CLI). */
interface PipelineStats {
  n: number
  answer: number
  recall: number
  precision: number
  latency_ms: number
  context_tokens: number
}

interface BenchmarkSummaryPayload {
  run_id: string
  summary: {
    total: number
    scored: number
    pipelines: Record<string, PipelineStats>
    categories: {
      category: string
      difficulty: number
      n: number
      answer: Record<string, number>
      recall: Record<string, number>
    }[]
    failures: {
      question_id: string
      category: string
      pipeline: string
      failure_class: string
    }[]
    unscored: {
      question_id: string
      category: string
      status: string
      note: string
    }[]
  } | null
}

/**
 * The latest published benchmark run mapped onto the Results Dashboard
 * shape. Quality values are the harness's own means over scored questions;
 * "grounding" renders evidence precision, the scorer's grounding metric.
 * The per-market breakdown has no bank dimension and is returned empty;
 * the view hides that section when it has no rows.
 */
export function mapBenchmarkResults(
  payload: BenchmarkSummaryPayload,
): BenchmarkResults {
  if (!payload.summary)
    throw new Error('benchmark run has no published summary')
  const stats = payload.summary.pipelines
  const pipelineValue = (
    metric: keyof PipelineStats,
  ): [number, number, number] => [
    stats.A?.[metric] ?? 0,
    stats.B?.[metric] ?? 0,
    stats.C?.[metric] ?? 0,
  ]
  const byComplexity: ComplexityRow[] = payload.summary.categories.map(
    (category) => ({
      level: `D${category.difficulty}`,
      label: category.category.toLowerCase().replace(/_/g, ' '),
      baseline: category.answer.A ?? 0,
      graphRelationships: category.answer.B ?? 0,
      graphOntology: category.answer.C ?? 0,
    }),
  )
  const failures: FailureRow[] = [
    ...payload.summary.failures.map((failure): FailureRow => ({
      questionId: failure.question_id,
      complexity: failure.category.toLowerCase().replace(/_/g, ' '),
      pipeline: failure.pipeline as FailureRow['pipeline'],
      note: failure.failure_class,
    })),
    ...payload.summary.unscored.map((entry): FailureRow => ({
      questionId: entry.question_id,
      complexity: entry.category.toLowerCase().replace(/_/g, ' '),
      note: entry.note || entry.status,
    })),
  ]
  return {
    benchmarkRunId: payload.run_id,
    questions: payload.summary.total,
    overview: {
      correctness: pipelineValue('answer'),
      evidenceRecall: pipelineValue('recall'),
      grounding: pipelineValue('precision'),
    },
    byComplexity,
    byMarket: [],
    efficiency: {
      latencyMs: pipelineValue('latency_ms'),
      contextTokens: pipelineValue('context_tokens'),
    },
    failures,
  }
}

/** summary.json schema of benchmark v2, which the results screen cannot render yet. */
const BENCHMARK_V2_SCHEMA = '2'

/** What the Results screen can say about a published v2 run until it renders one. */
export interface BenchmarkV2Notice {
  runId: string
  runKind: string
  label: string | null
  headlines: string[]
}

export type PublishedBenchmark =
  | { schema: 'v1'; results: BenchmarkResults }
  | { schema: 'v2'; notice: BenchmarkV2Notice }

interface BenchmarkV2Payload {
  run_id: string
  run_kind: string
  label: string | null
  summary: { schema_version: string; headlines: string[] }
}

/**
 * The latest published benchmark run, or null when the API has none (the
 * caller falls back to the committed validation run and labels it). A v2
 * run comes back as a notice: its kind, label and headlines as written.
 */
export async function fetchBenchmarkResults(): Promise<PublishedBenchmark | null> {
  const response = await fetch(`${API_BASE}/api/v1/benchmarks/latest`)
  if (response.status === 404) return null
  if (!response.ok)
    throw new Error(`benchmark unavailable (${response.status})`)
  const body = (await response.json()) as
    BenchmarkSummaryPayload | BenchmarkV2Payload
  if (isV2Summary(body.summary)) {
    const v2 = body as BenchmarkV2Payload
    return {
      schema: 'v2',
      notice: {
        runId: v2.run_id,
        runKind: v2.run_kind,
        label: v2.label,
        headlines: v2.summary.headlines,
      },
    }
  }
  return {
    schema: 'v1',
    results: mapBenchmarkResults(body as BenchmarkSummaryPayload),
  }
}

/** Saved presentation questions from the fixed demo configuration. */
export async function fetchDemoQuestions(): Promise<BackendQuestion[]> {
  const response = await fetch(`${API_BASE}/api/v1/demo/questions`)
  if (!response.ok)
    throw new Error(`demo questions unavailable (${response.status})`)
  const body = (await response.json()) as {
    id: string
    question: string
    category: string
    profile?: 'fraud' | null
    configurations?: string[]
    benchmark_question_id?: string | null
  }[]
  return body.map((entry) => ({
    id: entry.id,
    question: entry.question,
    category: entry.category,
    profile: entry.profile ?? null,
    configurations: entry.configurations,
    benchmarkQuestionId: entry.benchmark_question_id ?? null,
  }))
}

/** Execute one question through the backend and map it to a MockRun. */
export async function runBackendQuestion(
  question: BackendQuestion,
  marketScope: readonly string[] = [],
): Promise<MockRun> {
  const runId = await Promise.race([
    postQuery(question, marketScope),
    timeout(10_000),
  ])
  const [results, events, benchmark] = await Promise.all([
    awaitResults(runId),
    fetchEvents(runId),
    fetchBenchmark(question.benchmarkQuestionId),
  ])
  if (results.status === 'failed') {
    throw new Error(results.error?.message ?? 'backend run failed')
  }
  const pipelineA = events.filter((event) => event.pipeline === 'A')
  const graphTag = events.some((event) => event.pipeline === 'C') ? 'C' : 'B'
  const graphStream = events.filter((event) => event.pipeline === graphTag)
  const answerTag = graphTag in results.results ? graphTag : 'A'
  const answerResult = results.results[answerTag]
  if (!answerResult) throw new Error('run produced no answer')
  const answer: MockAnswer = {
    ...toAnswer(answerResult.answer),
  }
  const rag = ragEvents(pipelineA, results.results.A?.evidence)
  rag.push({ kind: 'answer_completed', t: answer.latencyMs, answer })
  const graph = graphEvents(
    graphStream,
    results.results[graphTag]?.node_evidence,
  )
  graph.push({ kind: 'answer_completed', t: answer.latencyMs, answer })
  const matched = question.benchmarkQuestionId
    ? benchmark.questions.get(question.benchmarkQuestionId)
    : undefined
  return {
    runId,
    question: question.question,
    rag,
    graph,
    benchmarkV2Published: benchmark.v2Published,
    evaluation: matched
      ? [
          {
            kind: 'evaluation_completed',
            t: answer.latencyMs + 200,
            scores: scoreStrip(
              results,
              benchmark.questions,
              question.benchmarkQuestionId,
            ),
          },
        ]
      : [],
  }
}
