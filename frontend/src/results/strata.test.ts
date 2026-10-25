import { describe, expect, it } from 'vitest'

import type { Schemas } from '../api/client'
import { OFFICIAL, PILOT, SMOKE } from './results.fixtures'
import {
  agreement,
  comparisonRows,
  efficiencyRows,
  failureTotals,
  judgeRows,
  splitRows,
  MIN_GROUPS_FOR_INTERVAL,
  STRATUM_LABELS,
  STRATUM_ORDER,
  printsIntervalBelowFloor,
  strataBars,
  tiles,
} from './strata'

type Summary = Schemas['SummaryOut']
type Comparison = Schemas['ComparisonCell']

const cell = (over: Partial<Comparison>): Comparison => ({
  stratum: 'H1',
  metric: 'evidence_f1',
  comparison: 'B_vs_A',
  n: 36,
  clusters: 12,
  mean: 0.1,
  low: 0.05,
  high: 0.15,
  p: 0.01,
  p_holm: 0.02,
  in_family: true,
  reason: 'tested',
  ...over,
})

const withComparisons = (...comparisons: Comparison[]): Summary => ({
  ...OFFICIAL,
  comparisons,
})

describe('strata', () => {
  it('names every stratum in order', () => {
    expect(STRATUM_ORDER).toEqual([
      'H1',
      'H2',
      'H2_name',
      'H3',
      'H5',
      'overall',
    ])
    expect(Object.keys(STRATUM_LABELS).sort()).toEqual(
      [...STRATUM_ORDER].sort(),
    )
  })
})

describe('strataBars', () => {
  it('has one group per stratum in order, one value per pipeline', () => {
    const { groups } = strataBars(PILOT, 'evidence_f1')
    expect(groups.map((g) => g.key)).toEqual([...STRATUM_ORDER])
    expect(Object.keys(groups[0].values)).toEqual(['A', 'B', 'C'])
    expect(groups[0].values.A).toBe(PILOT.metrics.H1.evidence_f1.A.mean)
  })
  it('too few pairs gives no delta', () => {
    const { delta } = strataBars(PILOT, 'evidence_f1')
    expect(delta?.between).toEqual(['B', 'A'])
    expect(delta?.values.H1).toBeNull()
  })
  it('takes the delta from the B against A cell, as given', () => {
    const summary = withComparisons(
      cell({ mean: 0.25 }),
      cell({ comparison: 'C_vs_B', mean: 0.9 }),
      cell({
        stratum: 'H3',
        reason: 'not_in_family',
        in_family: false,
        mean: -0.05,
      }),
    )
    const { delta } = strataBars(summary, 'evidence_f1')
    expect(delta?.values).toEqual({ H1: 0.25, H3: -0.05 })
  })
  it('reads the answer metric from the answer comparisons', () => {
    const summary = withComparisons(cell({ metric: 'answer', mean: 0.4 }))
    expect(strataBars(summary, 'answer').delta?.values.H1).toBe(0.4)
    expect(strataBars(summary, 'evidence_f1').delta?.values.H1).toBeUndefined()
  })
  it('keeps a mean that is null as a gap, never zero', () => {
    const summary: Summary = {
      ...OFFICIAL,
      metrics: {
        overall: {
          evidence_f1: {
            A: { mean: null, n: 0, repeats: 0 },
            B: { mean: 0.5, n: 3, repeats: 3 },
          },
        },
      },
    }
    expect(strataBars(summary, 'evidence_f1').groups).toEqual([
      expect.objectContaining({ key: 'overall', values: { A: null, B: 0.5 } }),
    ])
  })
})

describe('comparisonRows', () => {
  it('has one row per stratum and comparison for the metric', () => {
    const rows = comparisonRows(PILOT, 'evidence_f1')
    expect(rows).toHaveLength(
      PILOT.comparisons.filter((c) => c.metric === 'evidence_f1').length,
    )
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
  it('a too few cell makes no claim even though the harness wrote an interval', () => {
    const source = PILOT.comparisons.find(
      (c) =>
        c.metric === 'evidence_f1' && c.reason === 'too_few' && c.mean !== null,
    )
    expect(source?.low).not.toBeNull()
    const row = comparisonRows(PILOT, 'evidence_f1').find(
      (r) => r.key === `${source?.stratum}:${source?.comparison}`,
    )
    expect(row).toMatchObject({
      mean: null,
      low: null,
      high: null,
      note: 'Too few pairs',
      inFamily: false,
    })
  })
  it('a tested cell carries its interval in points, its counts and its pipeline', () => {
    const [row] = comparisonRows(withComparisons(cell({})), 'evidence_f1')
    expect(row).toMatchObject({
      mean: 10,
      low: 5,
      high: 15,
      n: 36,
      groups: 12,
      inFamily: true,
      pipeline: 'B',
    })
    expect(row.note).toBeUndefined()
  })
  it('a cell outside the family still shows its interval, with a note', () => {
    const [row] = comparisonRows(
      withComparisons(cell({ reason: 'not_in_family', in_family: false })),
      'evidence_f1',
    )
    expect(row.mean).toBe(10)
    expect(row.note).toBe('Not tested')
  })
  it('a reason it does not know is no claim', () => {
    const [row] = comparisonRows(
      withComparisons(cell({ reason: 'surprise' })),
      'evidence_f1',
    )
    expect(row).toMatchObject({ mean: null, low: null, high: null })
    expect(row.note).toBe('No claim')
  })
  it('names the pipeline of a C against B row', () => {
    const [row] = comparisonRows(
      withComparisons(cell({ comparison: 'C_vs_B' })),
      'evidence_f1',
    )
    expect(row.pipeline).toBe('C')
    expect(row.label).toContain('Graph + Ontology')
  })
})

describe('splitRows', () => {
  it('split rows are null for a run without a split', () =>
    expect(splitRows(PILOT, 'evidence_f1')).toBeNull())
  it('has the cells of the metric for both groups', () => {
    const rows = splitRows(OFFICIAL, 'answer')
    expect(rows).toHaveLength(4)
    expect(rows?.map((r) => r.key)).toEqual([
      'ontology_dependent:B_vs_A',
      'ontology_dependent:C_vs_B',
      'other:B_vs_A',
      'other:C_vs_B',
    ])
    expect(rows?.every((r) => !r.inFamily)).toBe(true)
  })
  it('a too few split cell makes no claim', () => {
    const summary: Summary = {
      ...OFFICIAL,
      ontology_split: [
        {
          group: 'other',
          metric: 'answer',
          comparison: 'B_vs_A',
          n: 3,
          clusters: 2,
          mean: 0.2,
          low: 0.1,
          high: 0.3,
          p: null,
          p_holm: null,
          in_family: false,
          reason: 'too_few',
        },
      ],
    }
    expect(splitRows(summary, 'answer')?.[0]).toMatchObject({
      mean: null,
      low: null,
      high: null,
      note: 'Too few pairs',
    })
  })
})

describe('tiles', () => {
  it('has one tile per pipeline from the overall cells', () => {
    const rows = tiles(PILOT)
    expect(rows.map((t) => t.pipeline)).toEqual(['A', 'B', 'C'])
    expect(rows[1].evidence).toEqual(PILOT.metrics.overall.evidence_f1.B)
    expect(rows[1].answer).toEqual(PILOT.metrics.overall.answer.B)
  })
})

describe('efficiencyRows', () => {
  it('has a row per stratum and pipeline with latency, tokens and efficiency', () => {
    const rows = efficiencyRows(OFFICIAL)
    expect(rows).toHaveLength(STRATUM_ORDER.length * 3)
    expect(rows[0].key).toBe('H1-A')
    expect(rows[0].label).toBe('Multi-hop questions - A · Text search')
    expect(rows[0].cells).toHaveLength(3)
  })
  it('shows a gap for a value that does not exist', () => {
    const summary: Summary = {
      ...OFFICIAL,
      metrics: {
        H1: {
          latency_ms: { A: { mean: 1234.4, n: 2, repeats: 2 } },
          context_tokens: { A: { mean: null, n: 0, repeats: 0 } },
        },
      },
    }
    expect(efficiencyRows(summary)[0].cells).toEqual([
      '1,234',
      'no value',
      'no value',
    ])
  })
})

describe('judgeRows and agreement', () => {
  it('has a row per stratum and pipeline with the five judge metrics', () => {
    const rows = judgeRows(PILOT)
    expect(rows).toHaveLength(Object.keys(PILOT.metrics).length * 3)
    expect(rows[0].key).toBe('H1-A')
    expect(rows[0].label).toBe('Multi-hop questions - A · Text search')
    expect(rows[0].cells).toEqual(
      [
        'judge_correctness',
        'judge_completeness',
        'judge_faithfulness',
        'judge_citation_accuracy',
        'judge_abstention',
      ].map((m) => {
        const mean = PILOT.metrics.H1[m]?.A?.mean
        return typeof mean === 'number' ? mean.toFixed(2) : 'no value'
      }),
    )
  })
  it('agreement has overall and per pipeline rows', () => {
    expect(agreement(PILOT)?.map((r) => r.label)).toEqual([
      'All questions',
      'A · Text search',
      'B · Graph',
      'C · Graph + Ontology',
    ])
  })
  it('agreement is null without a judge', () =>
    expect(agreement({ ...OFFICIAL, judge_agreement: null })).toBeNull())
})

describe('failureTotals', () => {
  it('lists each pipeline and class with its count', () => {
    expect(failureTotals(PILOT)).toContainEqual({
      pipeline: 'B',
      cls: 'entity_resolution_failure',
      count: 6,
    })
    expect(failureTotals(PILOT)).toHaveLength(8)
  })
  it('is empty for a run without failures', () =>
    expect(
      failureTotals({
        ...SMOKE,
        failures: { ...SMOKE.failures, classes: {} },
      }),
    ).toEqual([]))
})

describe('units', () => {
  it('interval rows are x100, bar delta is raw', () => {
    const summary = withComparisons(cell({ mean: 0.1, low: 0.05, high: 0.15 }))
    expect(comparisonRows(summary, 'evidence_f1')[0].mean).toBeCloseTo(10)
    expect(strataBars(summary, 'evidence_f1').delta?.values.H1).toBe(0.1)
  })
})

describe('the group floor for an untested sub-group', () => {
  const few = cell({
    stratum: 'H2_name',
    reason: 'not_in_family',
    in_family: false,
    clusters: MIN_GROUPS_FOR_INTERVAL - 1,
    p: null,
    p_holm: null,
  })
  it('draws the mean alone, with a note, below the floor', () => {
    const [row] = comparisonRows(withComparisons(few), 'evidence_f1')
    expect(row).toMatchObject({ mean: 10, low: null, high: null })
    expect(row.note).toBe('Too few groups for an interval')
  })
  it('keeps the interval at the floor', () => {
    const [row] = comparisonRows(
      withComparisons({ ...few, clusters: MIN_GROUPS_FOR_INTERVAL }),
      'evidence_f1',
    )
    expect(row).toMatchObject({ low: 5, high: 15, note: 'Not tested' })
  })
  it('gives the bars no delta below the floor, and one at it', () => {
    expect(
      strataBars(withComparisons(few), 'evidence_f1').delta?.values.H2_name,
    ).toBeNull()
    expect(
      strataBars(
        withComparisons({ ...few, clusters: MIN_GROUPS_FOR_INTERVAL }),
        'evidence_f1',
      ).delta?.values.H2_name,
    ).toBe(0.1)
  })
  it('is told of a run whose recorded interval sits below the floor', () => {
    expect(printsIntervalBelowFloor(withComparisons(few))).toBe(true)
    expect(
      printsIntervalBelowFloor(
        withComparisons({ ...few, clusters: MIN_GROUPS_FOR_INTERVAL }),
      ),
    ).toBe(false)
    expect(
      printsIntervalBelowFloor(
        withComparisons({ ...few, low: null, high: null }),
      ),
    ).toBe(false)
    expect(printsIntervalBelowFloor(withComparisons(cell({})))).toBe(false)
  })
  it('applies to the split too', () => {
    const [row] =
      splitRows(
        {
          ...OFFICIAL,
          ontology_split: [
            {
              group: 'other',
              metric: 'answer',
              comparison: 'B_vs_A',
              n: 3,
              clusters: 2,
              mean: 0.2,
              low: 0.1,
              high: 0.3,
              p: null,
              p_holm: null,
              in_family: false,
              reason: 'not_in_family',
            },
          ],
        },
        'answer',
      ) ?? []
    expect(row).toMatchObject({ low: null, high: null })
    expect(row.note).toBe('Too few groups for an interval')
  })
})

describe('gap notes', () => {
  it('notes single facts once when evidence has no bars', () => {
    expect(strataBars(OFFICIAL, 'evidence_f1').gapNotes).toEqual({})
    const noH3: Summary = {
      ...OFFICIAL,
      metrics: {
        ...OFFICIAL.metrics,
        H3: { ...OFFICIAL.metrics.H3, evidence_f1: {} },
      },
    }
    expect(strataBars(noH3, 'evidence_f1').gapNotes).toEqual({
      H3: 'No evidence score by design',
    })
    expect(strataBars(noH3, 'answer').gapNotes).toEqual({})
  })
})

describe('a cell with no pairs', () => {
  it('says No pairs and draws nothing, whatever its reason', () => {
    const [row] = comparisonRows(
      withComparisons(
        cell({ n: 0, clusters: 0, reason: 'not_in_family', in_family: false }),
      ),
      'evidence_f1',
    )
    expect(row).toMatchObject({ mean: null, low: null, high: null })
    expect(row.note).toBe('No pairs')
  })
})
