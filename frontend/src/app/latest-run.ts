/**
 * What Overview may say about the newest published run. Only a run of the
 * whole bank with kind "official" fills the tiles; every other run, and no
 * run at all, is named in words and carries no number.
 */

import { getLatestBenchmark, type Schemas } from '../api/client'
import { ApiError } from '../api/http'
import type { PipelineId } from '../design/pipelines'
import { intervalTestDisagreements } from '../results/strata'
import { evidenceMetric, type EvidenceMetric } from './method'
import { kindWord } from './run-kinds'

export interface TileFigures {
  pipeline: PipelineId
  /** The run's evidence metric overall, or null when the run scored nothing for this pipeline. */
  mean: number | null
  /** Questions the metric is defined for: those with claims. */
  n: number
  /** Scored runs behind the mean. */
  repeats: number
}

export type Verdict =
  | {
      kind: 'official'
      /** The method the run was made under, as the API reports it. */
      method: string
      /** The evidence metric that method compares, which the tiles show. */
      metric: EvidenceMetric
      /** The run's declaration of the method change; null for a v0.2 run. */
      note: string | null
      tiles: TileFigures[]
      headlines: string[]
      /** Tested cells whose interval leaves out zero but whose test does not pass. */
      disagreements: number
    }
  | { kind: 'none'; otherRun: string | null }

const PIPELINE_IDS: readonly PipelineId[] = ['A', 'B', 'C']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function figures(
  summary: Record<string, unknown>,
  metric: EvidenceMetric,
  id: PipelineId,
) {
  const metrics = summary.metrics
  const overall = isRecord(metrics) ? metrics.overall : undefined
  const evidence = isRecord(overall) ? overall[metric] : undefined
  const cell = isRecord(evidence) ? evidence[id] : undefined
  const read = (key: string) =>
    isRecord(cell) && typeof cell[key] === 'number' ? cell[key] : null
  return {
    pipeline: id,
    mean: read('mean'),
    n: read('n') ?? 0,
    repeats: read('repeats') ?? 0,
  }
}

/**
 * Whether the summary is an official run of the whole bank: no strata, no
 * limit and no list of questions, the rule of `_full` in
 * backend/app/api/benchmarks.py (a run writes `questions` only when set).
 */
export function isFullOfficial(latest: Schemas['BenchmarkSummary']): boolean {
  const { selection } = latest.summary
  return (
    latest.run_kind === 'official' &&
    isRecord(selection) &&
    selection.strata === null &&
    selection.limit === null &&
    selection.questions == null
  )
}

/** The verdict for the run `GET /benchmarks/latest` returned, or null for a 404. */
export function verdictFrom(
  latest: Schemas['BenchmarkSummary'] | null,
): Verdict {
  if (latest === null) return { kind: 'none', otherRun: null }
  if (!isFullOfficial(latest))
    return {
      kind: 'none',
      otherRun: latest.label ?? kindWord(latest.run_kind),
    }
  const { headlines, comparisons } = latest.summary
  const metric = evidenceMetric(latest.method_version)
  return {
    kind: 'official',
    method: latest.method_version,
    metric,
    note: latest.summary.method_note ?? null,
    tiles: PIPELINE_IDS.map((id) => figures(latest.summary, metric, id)),
    headlines: Array.isArray(headlines)
      ? headlines.filter((line): line is string => typeof line === 'string')
      : [],
    disagreements: Array.isArray(comparisons)
      ? intervalTestDisagreements(comparisons)
      : 0,
  }
}

/** The newest run, or null when none is published (a 404 is not a failure). */
export async function loadLatest(signal: AbortSignal) {
  try {
    return await getLatestBenchmark(signal)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}
