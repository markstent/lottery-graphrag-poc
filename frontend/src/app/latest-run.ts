/**
 * What Overview may say about the newest published run. Only a run of the
 * whole bank with kind "official" fills the tiles; every other run, and no
 * run at all, is named in words and carries no number.
 */

import { getLatestBenchmark, type Schemas } from '../api/client'
import { ApiError } from '../api/http'
import type { PipelineId } from '../design/pipelines'
import {
  HOLM_ALPHA,
  intervalTestDisagreements,
  MIN_GROUPS_FOR_INTERVAL,
} from '../results/strata'
import { EVIDENCE_METRIC } from './method'
import { kindWord } from './run-kinds'

export interface TileFigures {
  pipeline: PipelineId
  /** Evidence recall overall, or null when the run scored nothing for this pipeline. */
  mean: number | null
  /** Questions the metric is defined for: those with claims. */
  n: number
  /** Scored runs behind the mean. */
  repeats: number
  /** The run's answer score overall, or null when it has none for this pipeline. */
  answer: number | null
}

/** The two comparisons the pre-registered test covers. */
export type TestedPair = 'B_vs_A' | 'C_vs_B'

/**
 * One difference Overview states in words. "clear" passed the pre-registered
 * test; "hint" is an untested sub-group whose interval leaves out zero.
 */
export interface Finding {
  kind: 'clear' | 'hint'
  stratum: string
  comparison: TestedPair
  metric: string
  /** The first pipeline of the pair minus the second, on the 0 to 1 scale. */
  mean: number
}

export type Verdict =
  | {
      kind: 'official'
      tiles: TileFigures[]
      headlines: string[]
      /** Questions each pipeline answered. */
      questions: number
      findings: Finding[]
      /** Cells in the pre-registered test, of either metric. */
      tested: number
      /** Tested cells whose interval leaves out zero but whose test does not pass. */
      disagreements: number
      /** Each kind of question's mean per pipeline, for the chart, by metric. */
      kinds: Record<KindMetric, KindFigures[]>
    }
  | { kind: 'none'; otherRun: string | null }

const PIPELINE_IDS: readonly PipelineId[] = ['A', 'B', 'C']

/** The measures the Overview chart can show. */
export type KindMetric = 'evidence_recall' | 'answer'

/** One kind of question's mean per pipeline on one measure, as the summary records it. */
export interface KindFigures {
  stratum: string
  values: Partial<Record<PipelineId, number | null>>
}

/**
 * The kinds of question the chart shows, in order. Single facts have the
 * answer score only: three of their 72 instances kept a claim, too few for
 * an evidence bar beside the others.
 */
const KIND_ORDER: Record<KindMetric, readonly string[]> = {
  evidence_recall: ['H1', 'H2', 'H2_name', 'H5'],
  answer: ['H1', 'H2', 'H2_name', 'H3', 'H5'],
}

function kindFigures(
  summary: Record<string, unknown>,
  metric: KindMetric,
): KindFigures[] {
  const metrics = isRecord(summary.metrics) ? summary.metrics : {}
  return KIND_ORDER[metric].flatMap((stratum) => {
    const stratumMetrics = metrics[stratum]
    const scores = isRecord(stratumMetrics) ? stratumMetrics[metric] : undefined
    if (!isRecord(scores)) return []
    const values = Object.fromEntries(
      PIPELINE_IDS.map((id) => {
        const cell = scores[id]
        return [
          id,
          isRecord(cell) && typeof cell.mean === 'number' ? cell.mean : null,
        ]
      }),
    )
    return [{ stratum, values }]
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function figures(
  summary: Record<string, unknown>,
  id: PipelineId,
): TileFigures {
  const metrics = summary.metrics
  const overall = isRecord(metrics) ? metrics.overall : undefined
  const read = (name: string, key: string) => {
    const scores = isRecord(overall) ? overall[name] : undefined
    const cell = isRecord(scores) ? scores[id] : undefined
    return isRecord(cell) && typeof cell[key] === 'number' ? cell[key] : null
  }
  return {
    pipeline: id,
    mean: read(EVIDENCE_METRIC, 'mean'),
    n: read(EVIDENCE_METRIC, 'n') ?? 0,
    repeats: read(EVIDENCE_METRIC, 'repeats') ?? 0,
    answer: read('answer', 'mean'),
  }
}

type Comparison = Schemas['ComparisonCell']

const isTestedPair = (comparison: string): comparison is TestedPair =>
  comparison === 'B_vs_A' || comparison === 'C_vs_B'

const passes = (cell: Comparison) =>
  cell.in_family && cell.p_holm !== null && cell.p_holm < HOLM_ALPHA

/**
 * An untested sub-group of a tested pair, on evidence recall, over
 * enough groups for an interval, whose interval leaves out zero: what the
 * harness's headlines report for the name-anchored sub-group.
 */
const hints = (cell: Comparison) =>
  cell.reason === 'not_in_family' &&
  cell.stratum !== 'overall' &&
  cell.metric === EVIDENCE_METRIC &&
  cell.clusters >= MIN_GROUPS_FOR_INTERVAL &&
  cell.low !== null &&
  cell.high !== null &&
  (cell.low > 0 || cell.high < 0)

/** The differences to state in words: those that passed the test, then the hints. */
export function findingsFrom(comparisons: readonly Comparison[]): Finding[] {
  const pick = (kind: Finding['kind'], keep: (cell: Comparison) => boolean) =>
    comparisons.flatMap((cell): Finding[] =>
      isTestedPair(cell.comparison) && cell.mean !== null && keep(cell)
        ? [
            {
              kind,
              stratum: cell.stratum,
              comparison: cell.comparison,
              metric: cell.metric,
              mean: cell.mean,
            },
          ]
        : [],
    )
  return [...pick('clear', passes), ...pick('hint', hints)]
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
  const { headlines, comparisons, instances } = latest.summary
  const cells = Array.isArray(comparisons) ? comparisons : []
  return {
    kind: 'official',
    tiles: PIPELINE_IDS.map((id) => figures(latest.summary, id)),
    headlines: Array.isArray(headlines)
      ? headlines.filter((line): line is string => typeof line === 'string')
      : [],
    questions: isRecord(instances?.total) ? (instances.total.overall ?? 0) : 0,
    findings: findingsFrom(cells),
    tested: cells.filter((cell) => cell.in_family).length,
    disagreements: intervalTestDisagreements(cells),
    kinds: {
      evidence_recall: kindFigures(latest.summary, 'evidence_recall'),
      answer: kindFigures(latest.summary, 'answer'),
    },
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
