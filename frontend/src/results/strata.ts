/**
 * A run's summary as chart and table rows. Nothing here is a statistic: every
 * mean, interval and count is the one the summary holds. The one conversion is
 * the interval rows, which are in points (0.01 on the 0 to 1 scale) as
 * statistics.md reports differences.
 */

import type { Schemas } from '../api/client'
import { PIPELINES, type PipelineId } from '../design/pipelines'
import { evidenceScore, percent } from '../app/score-words'
import type { BarGroup, GroupedBarsProps } from '../charts/grouped-bars'
import type { DataTableRow } from '../charts/data-table'
import type { IntervalRow } from '../charts/interval-plot'
import { formatNumber, formatOrGap } from '../charts/scale'

type Summary = Schemas['SummaryOut']
type MetricCell = Schemas['MetricCell']
type Comparison = Schemas['ComparisonCell']
type Split = Schemas['SplitCell']

export const STRATUM_ORDER = ['H1', 'H2', 'H2_name', 'H3', 'H5', 'overall']

/** The kinds of question in the words of docs/reference/evaluation/statistics.md. */
export const STRATUM_LABELS: Record<string, string> = {
  H1: 'Multi-hop questions',
  H2: 'Ontology-dependent questions, by id',
  H2_name: 'Ontology-dependent questions, by local-language name',
  H3: 'Single facts',
  H5: 'Planted patterns',
  overall: 'All questions',
}

/** The same groups in a word or two, for a table row. */
export const STRATUM_SHORT: Record<string, string> = {
  H1: 'Multi-hop',
  H2: 'Ontology, by id',
  H2_name: 'Ontology, by name',
  H3: 'Single facts',
  H5: 'Planted patterns',
  overall: 'All',
}

export const COMPARISON_LABELS: Record<string, string> = {
  B_vs_A: 'Graph against text search',
  C_vs_B: 'Graph + Ontology against Graph',
}

/** The pipeline each comparison is about: the first of the pair. */
const COMPARISON_PIPELINES: Record<string, PipelineId> = {
  B_vs_A: 'B',
  C_vs_B: 'C',
}

export const GROUP_LABELS: Record<string, string> = {
  ontology_dependent: 'Questions that need the ontology',
  other: 'All other questions',
}

/**
 * An untested sub-group with fewer groups than this has no interval and no
 * delta: docs/reference/evaluation/statistics.md (name-anchored sub-group) prints the
 * mean alone below six groups, because a bootstrap over so few says little.
 * Runs made before the harness applied the rule still carry the interval.
 */
export const MIN_GROUPS_FOR_INTERVAL = 6

const POINTS = 100
const TOO_FEW = 'Too few pairs'
const NO_PAIRS = 'No pairs'
const TOO_FEW_GROUPS = 'Too few groups for an interval'
const NO_EVIDENCE = 'No evidence score by design'
const NO_CLAIM = 'No claim'
const NOT_TESTED = 'Not tested'

const JUDGE_METRICS = [
  'judge_correctness',
  'judge_completeness',
  'judge_faithfulness',
  'judge_citation_accuracy',
  'judge_abstention',
] as const

export const JUDGE_LABELS: Record<(typeof JUDGE_METRICS)[number], string> = {
  judge_correctness: 'Correctness',
  judge_completeness: 'Completeness',
  judge_faithfulness: 'Faithfulness',
  judge_citation_accuracy: 'Citation accuracy',
  judge_abstention: 'Abstention',
}

const cellOf = (
  summary: Summary,
  stratum: string,
  metric: string,
  tag: string,
): MetricCell | undefined => summary.metrics[stratum]?.[metric]?.[tag]

const strataIn = (summary: Summary) =>
  STRATUM_ORDER.filter((stratum) => stratum in summary.metrics)

const hasBar = (values: BarGroup['values']) =>
  Object.values(values).some((value) => value != null)

/** A cell that makes no claim of an interval or a delta: too few pairs, or an untested one over too few groups. */
const lacksGroups = (cell: Comparison | Split) =>
  cell.reason === 'not_in_family' && cell.clusters < MIN_GROUPS_FOR_INTERVAL

/**
 * Whether a run written before the group floor carries an interval over fewer
 * groups than the floor: its recorded headlines and sub-group lines print it,
 * and the charts withdraw it.
 */
export function printsIntervalBelowFloor(summary: Summary): boolean {
  const cells: (Comparison | Split)[] = [
    ...summary.comparisons,
    ...(summary.ontology_split ?? []),
  ]
  return cells.some(
    (cell) => lacksGroups(cell) && cell.low != null && cell.high != null,
  )
}

/** Grouped bars of a metric per stratum, with B minus A as the delta; a cell with too few pairs or groups has none. */
export function strataBars(
  summary: Summary,
  metric: 'evidence_f1' | 'answer',
): {
  groups: BarGroup[]
  delta: GroupedBarsProps['delta']
  /** Said once, horizontally, for a group with no bar at all. */
  gapNotes: Record<string, string>
} {
  const groups = strataIn(summary).map((stratum) => ({
    key: stratum,
    label: STRATUM_LABELS[stratum],
    values: Object.fromEntries(
      PIPELINES.flatMap(({ id }) => {
        const cell = cellOf(summary, stratum, metric, id)
        return cell ? [[id, cell.mean]] : []
      }),
    ),
  }))
  const values = Object.fromEntries(
    summary.comparisons
      .filter((c) => c.metric === metric && c.comparison === 'B_vs_A')
      .map((c) => [
        c.stratum,
        c.reason === 'too_few' || lacksGroups(c) ? null : c.mean,
      ]),
  )
  // Single facts are scored on the answer alone, so they have no evidence bars.
  const gapNotes: Record<string, string> =
    metric === 'evidence_f1' &&
    groups.some(({ key, values }) => key === 'H3' && !hasBar(values))
      ? { H3: NO_EVIDENCE }
      : {}
  return { groups, delta: { between: ['B', 'A'], values }, gapNotes }
}

/** A cell's interval in points, or nothing and a note where the cell makes no claim. */
function interval(
  cell: Comparison | Split,
): Pick<IntervalRow, 'mean' | 'low' | 'high' | 'note'> {
  const points = (value: number | null) =>
    value === null ? null : value * POINTS
  if (cell.n === 0) return { mean: null, low: null, high: null, note: NO_PAIRS }
  switch (cell.reason) {
    case 'tested':
      return {
        mean: points(cell.mean),
        low: points(cell.low),
        high: points(cell.high),
      }
    case 'not_in_family':
      if (lacksGroups(cell))
        return {
          mean: points(cell.mean),
          low: null,
          high: null,
          note: TOO_FEW_GROUPS,
        }
      return {
        mean: points(cell.mean),
        low: points(cell.low),
        high: points(cell.high),
        note: NOT_TESTED,
      }
    case 'too_few':
      return { mean: null, low: null, high: null, note: TOO_FEW }
    default:
      return { mean: null, low: null, high: null, note: NO_CLAIM }
  }
}

const intervalRow = (
  cell: Comparison | Split,
  key: string,
  label: string,
): IntervalRow => ({
  key: `${key}:${cell.comparison}`,
  label: `${label}: ${COMPARISON_LABELS[cell.comparison] ?? cell.comparison}`,
  ...interval(cell),
  n: cell.n,
  groups: cell.clusters,
  inFamily: cell.in_family,
  ...(cell.in_family ? { pHolm: cell.p_holm } : {}),
  pipeline: COMPARISON_PIPELINES[cell.comparison],
})

/** One row per stratum and comparison for the metric, in points. */
export function comparisonRows(
  summary: Summary,
  metric: 'evidence_f1' | 'answer',
): IntervalRow[] {
  return summary.comparisons
    .filter((c) => c.metric === metric)
    .map((c) =>
      intervalRow(c, c.stratum, STRATUM_LABELS[c.stratum] ?? c.stratum),
    )
}

/** The ontology-dependent split of the metric, in points; null for a run that has none. */
export function splitRows(
  summary: Summary,
  metric: 'evidence_f1' | 'answer',
): IntervalRow[] | null {
  if (!summary.ontology_split) return null
  return summary.ontology_split
    .filter((c) => c.metric === metric)
    .map((c) => intervalRow(c, c.group, GROUP_LABELS[c.group] ?? c.group))
}

const EMPTY: MetricCell = { mean: null, n: 0, repeats: 0 }

/** The overall evidence and answer cells of each pipeline. */
export function tiles(
  summary: Summary,
): { pipeline: string; evidence: MetricCell; answer: MetricCell }[] {
  return PIPELINES.map(({ id }) => ({
    pipeline: id,
    evidence: cellOf(summary, 'overall', 'evidence_f1', id) ?? EMPTY,
    answer: cellOf(summary, 'overall', 'answer', id) ?? EMPTY,
  }))
}

const whole = (value: number) => formatNumber(value, { decimals: 0 })
const twoPlaces = (value: number) => formatNumber(value, { decimals: 2 })

/** Latency, context size and evidence per 1,000 tokens for each stratum and pipeline. */
export function efficiencyRows(summary: Summary): DataTableRow[] {
  return strataIn(summary).flatMap((stratum) =>
    PIPELINES.map(({ id, label }) => {
      const mean = (metric: string) =>
        cellOf(summary, stratum, metric, id)?.mean
      return {
        key: `${stratum}-${id}`,
        label: `${STRATUM_LABELS[stratum]} - ${label}`,
        cells: [
          formatOrGap(mean('latency_ms'), whole),
          formatOrGap(mean('context_tokens'), whole),
          formatOrGap(mean('efficiency_per_1k'), twoPlaces),
        ],
      }
    }),
  )
}

/** The five judge scores (0 to 2) for each stratum and pipeline, one column per judge metric. */
export function judgeRows(summary: Summary): DataTableRow[] {
  return strataIn(summary).flatMap((stratum) =>
    PIPELINES.map(({ id, label }) => ({
      key: `${stratum}-${id}`,
      label: `${STRATUM_LABELS[stratum]} - ${label}`,
      cells: JUDGE_METRICS.map((metric) =>
        formatOrGap(cellOf(summary, stratum, metric, id)?.mean, twoPlaces),
      ),
    })),
  )
}

const UNDEFINED = 'Undefined'

/** How often the judge and the answer score agree, overall and per pipeline; null without a judge. */
export function agreement(summary: Summary): DataTableRow[] | null {
  const judged = summary.judge_agreement
  if (!judged) return null
  const row = (key: string, label: string, cell: Schemas['AgreementOut']) => ({
    key,
    label,
    cells: [
      cell.n.toLocaleString('en-GB'),
      percent(cell.agreement),
      cell.kappa === null ? UNDEFINED : evidenceScore(cell.kappa),
    ],
  })
  return [
    row('overall', STRATUM_LABELS.overall, judged.overall),
    ...PIPELINES.flatMap(({ id, label }) =>
      id in judged.pipelines ? [row(id, label, judged.pipelines[id])] : [],
    ),
  ]
}

/** Every failure class of every pipeline with its count, pipelines in order. */
export function failureTotals(
  summary: Summary,
): { pipeline: string; cls: string; count: number }[] {
  return Object.entries(summary.failures.classes)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([pipeline, classes]) =>
      Object.entries(classes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cls, count]) => ({ pipeline, cls, count })),
    )
}
