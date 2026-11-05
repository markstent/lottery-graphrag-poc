/**
 * One function per route, typed from the generated contract (`schema.d.ts`):
 * parameters, bodies and results are never written by hand. The event stream
 * is not here; it is not a request/response call.
 */

import { request } from './http'
import type { components, paths } from './schema'

/** Starting a run or a benchmark takes the graph and the models, so it gets longer. */
export const START_TIMEOUT_MS = 15_000

type Method = 'get' | 'post'
type Operation<P extends keyof paths, M extends Method> =
  paths[P] extends Record<M, infer O> ? O : never
type PathParams<O> = O extends { parameters: { path: infer P } } ? P : never
type QueryParams<O> = O extends { parameters: { query?: infer Q } }
  ? NonNullable<Q>
  : never
type Body<O> = O extends {
  requestBody: { content: { 'application/json': infer B } }
}
  ? B
  : never
type Success<O> = O extends { responses: infer R }
  ? R extends { 200: { content: { 'application/json': infer J } } }
    ? J
    : R extends { 202: { content: { 'application/json': infer J } } }
      ? J
      : never
  : never

interface Call<O> {
  path?: PathParams<O>
  query?: QueryParams<O>
  body?: Body<O>
  signal?: AbortSignal
  timeoutMs?: number
  accept?: readonly number[]
}

function call<P extends keyof paths, M extends Method>(
  method: M,
  template: P,
  { path, ...rest }: Call<Operation<P, M>> = {},
): Promise<Success<Operation<P, M>>> {
  const url = Object.entries((path ?? {}) as Record<string, string>).reduce(
    (text, [name, value]) =>
      text.replace(`{${name}}`, encodeURIComponent(value)),
    template as string,
  )
  return request(method === 'get' ? 'GET' : 'POST', url, rest)
}

export type Schemas = components['schemas']

// Runs
export const startQuery = (
  body: Schemas['QueryRequest'],
  signal?: AbortSignal,
) =>
  call('post', '/api/v1/queries', { body, signal, timeoutMs: START_TIMEOUT_MS })
export const listRuns = (
  query: QueryParams<Operation<'/api/v1/queries', 'get'>> = {},
  signal?: AbortSignal,
) => call('get', '/api/v1/queries', { query, signal })
export const getRun = (id: string, signal?: AbortSignal) =>
  call('get', '/api/v1/queries/{run_id}', { path: { run_id: id }, signal })
export const cancelRun = (id: string, signal?: AbortSignal) =>
  call('post', '/api/v1/queries/{run_id}/cancel', {
    path: { run_id: id },
    signal,
  })
export const getRunEvents = (id: string, signal?: AbortSignal) =>
  call('get', '/api/v1/queries/{run_id}/events', {
    path: { run_id: id },
    signal,
  })
export const getDemoQuestions = (signal?: AbortSignal) =>
  call('get', '/api/v1/demo/questions', { signal })

// Health and reference
export const getHealth = (signal?: AbortSignal) =>
  call('get', '/api/v1/health', { signal })
/** A failed check answers 503 with the readiness body, which is the result, not an error. */
export const getReadiness = (signal?: AbortSignal) =>
  call('get', '/api/v1/health/ready', { signal, accept: [503] })
export const getModels = (signal?: AbortSignal) =>
  call('get', '/api/v1/models', { signal })
export const getOntology = (signal?: AbortSignal) =>
  call('get', '/api/v1/ontology', { signal })
export const getConceptMembers = (
  id: string,
  market?: string,
  signal?: AbortSignal,
) =>
  call('get', '/api/v1/ontology/concepts/{concept_id}/members', {
    path: { concept_id: id },
    query: { market },
    signal,
  })
export const getScenarios = (signal?: AbortSignal) =>
  call('get', '/api/v1/scenarios', { signal })

// Data model
export const listDatasets = (signal?: AbortSignal) =>
  call('get', '/api/v1/datasets', { signal })
export const getDataModelExample = (signal?: AbortSignal) =>
  call('get', '/api/v1/data-model/example', { signal })
export const getDataset = (id: string, signal?: AbortSignal) =>
  call('get', '/api/v1/datasets/{dataset_id}', {
    path: { dataset_id: id },
    signal,
  })
export const getDictionary = (id: string, signal?: AbortSignal) =>
  call('get', '/api/v1/datasets/{dataset_id}/dictionary', {
    path: { dataset_id: id },
    signal,
  })
export const getRows = (
  id: string,
  table: string,
  query: QueryParams<
    Operation<'/api/v1/datasets/{dataset_id}/tables/{table}/rows', 'get'>
  > = {},
  signal?: AbortSignal,
) =>
  call('get', '/api/v1/datasets/{dataset_id}/tables/{table}/rows', {
    path: { dataset_id: id, table },
    query,
    signal,
  })
export const getRecord = (
  id: string,
  table: string,
  rowId: string,
  signal?: AbortSignal,
) =>
  call('get', '/api/v1/datasets/{dataset_id}/tables/{table}/rows/{row_id}', {
    path: { dataset_id: id, table, row_id: rowId },
    signal,
  })

// Graph
export const getGraphSchema = (signal?: AbortSignal) =>
  call('get', '/api/v1/graph/schema', { signal })
export const getGraphStats = (signal?: AbortSignal) =>
  call('get', '/api/v1/graph/stats', { signal })
export const getNode = (id: string, signal?: AbortSignal) =>
  call('get', '/api/v1/graph/nodes/{node_id}', {
    path: { node_id: id },
    signal,
  })
export const getNeighbours = (
  id: string,
  query: QueryParams<
    Operation<'/api/v1/graph/nodes/{node_id}/neighbours', 'get'>
  > = {},
  signal?: AbortSignal,
) =>
  call('get', '/api/v1/graph/nodes/{node_id}/neighbours', {
    path: { node_id: id },
    query,
    signal,
  })

// Benchmarks
export const listBenchmarks = (signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks', { signal })
export const getSettings = (signal?: AbortSignal) =>
  call('get', '/api/v1/settings', { signal })
export const getLatestBenchmark = (signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks/latest', { signal })
export const getBenchmark = (id: string, signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks/{run_id}', { path: { run_id: id }, signal })
export const getBenchmarkInstances = (runId: string, signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks/{run_id}/instances', {
    path: { run_id: runId },
    signal,
  })
export const getSecondJudge = (runId: string, signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks/{run_id}/second-judge', {
    path: { run_id: runId },
    signal,
  })
export const getBenchmarkQuestions = (runId?: string, signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks/questions', {
    query: { run_id: runId },
    signal,
  })
export const startBenchmark = (
  body: Schemas['BenchmarkStart'],
  signal?: AbortSignal,
) =>
  call('post', '/api/v1/benchmarks', {
    body,
    signal,
    timeoutMs: START_TIMEOUT_MS,
  })
export const listJobs = (signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks/jobs', { signal })
export const getJob = (id: string, signal?: AbortSignal) =>
  call('get', '/api/v1/benchmarks/jobs/{job_id}', {
    path: { job_id: id },
    signal,
  })
export const cancelJob = (id: string, signal?: AbortSignal) =>
  call('post', '/api/v1/benchmarks/jobs/{job_id}/cancel', {
    path: { job_id: id },
    signal,
  })
