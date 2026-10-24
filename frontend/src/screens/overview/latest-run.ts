/**
 * What Overview may say about the newest published run. Only a run of the
 * whole bank with kind "official" fills the tiles; every other run, and no
 * run at all, is named in words and carries no number.
 */

import { getLatestBenchmark, type Schemas } from '../../api/client'
import { ApiError } from '../../api/http'
import type { PipelineId } from '../../design/pipelines'

export interface TileFigures {
  pipeline: PipelineId
  /** Evidence F1 overall, or null when the run scored nothing for this pipeline. */
  mean: number | null
  /** Questions scored. */
  n: number
  /** Scored runs behind the mean. */
  repeats: number
}

export type Verdict =
  | { kind: 'official'; tiles: TileFigures[]; headlines: string[] }
  | { kind: 'none'; otherRun: string | null }

const PIPELINE_IDS: readonly PipelineId[] = ['A', 'B', 'C']

export const KIND_WORDS: Record<string, string> = {
  smoke: 'quick check',
  sweep: 'depth sweep',
  official: 'official run',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function figures(summary: Record<string, unknown>, id: PipelineId) {
  const metrics = summary.metrics
  const overall = isRecord(metrics) ? metrics.overall : undefined
  const f1 = isRecord(overall) ? overall.evidence_f1 : undefined
  const cell = isRecord(f1) ? f1[id] : undefined
  const read = (key: string) =>
    isRecord(cell) && typeof cell[key] === 'number' ? cell[key] : null
  return {
    pipeline: id,
    mean: read('mean'),
    n: read('n') ?? 0,
    repeats: read('repeats') ?? 0,
  }
}

/** Whether the summary is an official run of the whole bank: no strata, no limit. */
export function isFullOfficial(latest: Schemas['BenchmarkSummary']): boolean {
  const { selection } = latest.summary
  return (
    latest.run_kind === 'official' &&
    isRecord(selection) &&
    selection.strata === null &&
    selection.limit === null
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
      otherRun: latest.label ?? KIND_WORDS[latest.run_kind] ?? latest.run_kind,
    }
  const { headlines } = latest.summary
  return {
    kind: 'official',
    tiles: PIPELINE_IDS.map((id) => figures(latest.summary, id)),
    headlines: Array.isArray(headlines)
      ? headlines.filter((line): line is string => typeof line === 'string')
      : [],
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
