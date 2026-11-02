import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { PipelineId } from '../../design/pipelines'
import { Blocks } from './blocks'
import type { Block } from './chapters'
import { CHAPTER_COPY } from './copy'
import {
  KIND_FIGURES,
  KIND_TABLE,
  OUTCOME_TABLE,
  QUESTION_FIGURES,
  QUESTION_TABLE,
  twoDecimals,
  type KindId,
  type PerApproach,
} from './copy/lessons'
import { REGISTER } from './copy/limits'
import { HelpDataContext, type HelpData } from './help-data'

afterEach(cleanup)

/**
 * The official run v0.3.0, as data/evaluation/runs/official-2026-10-29/summary.json
 * publishes it (data/ is not in git): metrics.<kind>.evidence_recall and .answer,
 * mean and n, and failures.classes. Chapter 13 quotes these; this pins them.
 */
const SUMMARY: Record<
  KindId,
  {
    evidence: PerApproach<number>
    evidenceN: number
    answer: PerApproach<number>
    answerN: number
  }
> = {
  H1: {
    evidence: { A: 0.42569444, B: 0.6462963, C: 0.63888889 },
    evidenceN: 72,
    answer: { A: 0.47796602, B: 0.60231481, C: 0.62083333 },
    answerN: 72,
  },
  H2: {
    evidence: { A: 0.19351852, B: 0.19027778, C: 0.37962963 },
    evidenceN: 72,
    answer: { A: 0.19218474, B: 0.24005326, C: 0.45055115 },
    answerN: 72,
  },
  H2_name: {
    evidence: { A: 0.78240741, B: 0.61574074, C: 1 },
    evidenceN: 36,
    answer: { A: 0.55608466, B: 0.56825397, C: 0.71084656 },
    answerN: 36,
  },
  H3: {
    evidence: { A: 0.33333333, B: 0.33333333, C: 0.66666667 },
    evidenceN: 3,
    answer: { A: 1, B: 0.98611111, C: 0.94444444 },
    answerN: 72,
  },
  H5: {
    evidence: { A: 0.48541667, B: 0.41666667, C: 0.41666667 },
    evidenceN: 48,
    answer: { A: 0.70753968, B: 0.62791132, C: 0.62791132 },
    answerN: 48,
  },
  overall: {
    evidence: { A: 0.42012987, B: 0.44761905, C: 0.56854257 },
    evidenceN: 231,
    answer: { A: 0.58077269, B: 0.60749129, C: 0.66956634 },
    answerN: 300,
  },
}

/** summary.json failures.classes: [retrieval_failure, generation_failure]. */
const FAILURE_CLASSES: PerApproach<readonly [number, number]> = {
  A: [124, 24],
  B: [119, 17],
  C: [100, 19],
}

/** Verdicts that open with "unknown": the "abstained" judged repeats of the run's judge agreement, 263 in all. */
const UNKNOWN_VERDICTS: PerApproach<number> = { A: 91, B: 95, C: 77 }

const APPROACHES: readonly PipelineId[] = ['A', 'B', 'C']
const KINDS = Object.keys(SUMMARY) as KindId[]
const whole = (value: number) => `${Math.round(value * 100)}%`
const inWords = (value: number) => `${Math.round(value * 100)} percent`

/** Every string a list of blocks shows: paragraphs, list items, headings and table cells. */
const texts = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) => {
    if (typeof block === 'string') return [block]
    if (!('kind' in block)) return [...block]
    if (block.kind === 'heading') return [block.text]
    if (block.kind === 'table')
      return [block.caption, ...block.columns, ...block.rows.flat()]
    return []
  })

const { plain, technical, plainHint } = CHAPTER_COPY.lessons
const plainText = [...texts(plain), plainHint ?? ''].join('\n')
const allText = [plainText, ...texts(technical)].join('\n')

/** Spec 7.8's banned words, whole words with their inflections, as the copy scan reads them. */
const BANNED =
  /\b(?:honest|never|real|fake|prototypes?|telemetry|seeds?|chunk(?:s|ed|ing)?|rerank(?:s|ed|er|ing)?|MAPS_TO)\b/i
/** A dataset code such as INC_041 or MKT_GR, or a question or kind id such as L05 or H1. */
const CODE = /\b[A-Z]{2,}_[A-Z0-9_]+\b|\b[LH]\d{1,2}\b|SCN-\d/

function show(level: HelpData['level'], blocks: readonly Block[]) {
  const data: HelpData = {
    level,
    bank: { status: 'loading', retry: () => undefined },
    scores: 'none',
    evidence: 'evidence_recall',
    story: null,
    settings: { status: 'loading', retry: () => undefined },
    recorded: { status: 'loading', retry: () => undefined },
  }
  render(
    <HelpDataContext.Provider value={data}>
      <Blocks blocks={blocks} />
    </HelpDataContext.Provider>,
  )
}

describe('chapter 13, what the results teach', () => {
  it('holds the means summary.json publishes for the official run v0.3.0', () => {
    for (const kind of KINDS) {
      const figures = KIND_FIGURES[kind]
      expect(figures.evidenceN, kind).toBe(SUMMARY[kind].evidenceN)
      expect(figures.questions, kind).toBe(SUMMARY[kind].answerN)
      for (const id of APPROACHES) {
        expect(figures.evidence[id], `${kind} ${id}`).toBeCloseTo(
          SUMMARY[kind].evidence[id],
          4,
        )
        expect(figures.answer[id], `${kind} ${id}`).toBeCloseTo(
          SUMMARY[kind].answer[id],
          4,
        )
      }
    }
  })

  it('shows each kind of question at Plain as whole percentages of those means', () => {
    show('plain', [KIND_TABLE])
    const table = screen.getByRole('table', {
      name: 'Which approach did best, by kind of question',
    })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(KINDS.length)
    const order: KindId[] = ['H1', 'H2', 'H2_name', 'H3', 'H5', 'overall']
    order.forEach((kind, index) => {
      const cells = within(rows[index]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
      const { evidence, answer, answerN, evidenceN } = SUMMARY[kind]
      expect(cells[0], kind).toBe(String(answerN))
      expect(cells[1], kind).toBe(
        kind === 'H3'
          ? `Not measured: ${evidenceN} of ${answerN} had evidence to find`
          : APPROACHES.map((id) => whole(evidence[id])).join(',\u00a0'),
      )
      expect(cells[2], kind).toBe(
        APPROACHES.map((id) => whole(answer[id])).join(',\u00a0'),
      )
    })
    // The one tested result is named as passed, and only once.
    expect(table.textContent!.match(/passed/g)).toHaveLength(1)
  })

  it('has per-question figures that average to the kind figures, and counts that add up', () => {
    expect(QUESTION_FIGURES.map((q) => q.id)).toEqual(
      Array.from(
        { length: 22 },
        (_, i) => `L${String(i + 1).padStart(2, '0')}`,
      ),
    )
    expect(QUESTION_FIGURES.reduce((sum, q) => sum + q.n, 0)).toBe(300)
    for (const kind of KINDS.filter((k) => k !== 'overall')) {
      const questions = QUESTION_FIGURES.filter((q) => q.kind === kind)
      const n = questions.reduce((sum, q) => sum + q.n, 0)
      expect(n, kind).toBe(SUMMARY[kind].answerN)
      for (const id of APPROACHES) {
        // Every question in a kind has the same n, so the kind mean is the mean of question means (3 decimals each).
        const answer =
          questions.reduce((sum, q) => sum + q.answer[id] * q.n, 0) / n
        expect(
          Math.abs(answer - SUMMARY[kind].answer[id]),
          `${kind} ${id}`,
        ).toBeLessThan(0.001)
        const withEvidence = questions.filter((q) => q.evidence !== null)
        const evidenceN = withEvidence.reduce((s, q) => s + q.evidenceN, 0)
        const evidence =
          withEvidence.reduce((s, q) => s + q.evidence![id] * q.evidenceN, 0) /
          evidenceN
        expect(evidenceN, kind).toBe(SUMMARY[kind].evidenceN)
        expect(
          Math.abs(evidence - SUMMARY[kind].evidence[id]),
          `${kind} ${id}`,
        ).toBeLessThan(0.001)
      }
    }
    for (const q of QUESTION_FIGURES)
      for (const id of APPROACHES) {
        expect(
          q.answerWtl[id].reduce((a, b) => a + b, 0),
          q.id,
        ).toBe(q.n)
        if (q.evidenceWtl)
          expect(
            q.evidenceWtl[id].reduce((a, b) => a + b, 0),
            q.id,
          ).toBe(q.evidenceN)
      }
    for (const id of APPROACHES) {
      const failures = [0, 1].map((slot) =>
        QUESTION_FIGURES.reduce((sum, q) => sum + q.failures[id][slot]!, 0),
      )
      expect(failures, id).toEqual([...FAILURE_CLASSES[id]])
      expect(
        QUESTION_FIGURES.reduce((sum, q) => sum + q.unknown[id], 0),
        id,
      ).toBe(UNKNOWN_VERDICTS[id])
    }
  })

  it('quotes at Plain the figures the tables hold', () => {
    const q = (id: string) => QUESTION_FIGURES.find((f) => f.id === id)!
    const quoted = [
      // Kinds of question.
      KIND_FIGURES.H1.evidence.B,
      KIND_FIGURES.H1.evidence.A,
      KIND_FIGURES.H1.answer.B,
      KIND_FIGURES.H1.answer.A,
      KIND_FIGURES.H2.evidence.C,
      KIND_FIGURES.H2.evidence.B,
      KIND_FIGURES.H2.answer.C,
      KIND_FIGURES.H2.answer.B,
      KIND_FIGURES.H2_name.evidence.A,
      KIND_FIGURES.H2_name.evidence.B,
      KIND_FIGURES.H2_name.evidence.C,
      KIND_FIGURES.H5.evidence.A,
      KIND_FIGURES.H5.evidence.B,
      KIND_FIGURES.H5.answer.A,
      KIND_FIGURES.H5.answer.B,
      // Single questions.
      q('L05').evidence!.B,
      q('L05').evidence!.A,
      q('L06').evidence!.B,
      q('L06').evidence!.A,
      q('L09').evidence!.A,
      q('L09').evidence!.B,
      q('L10').evidence!.B,
      q('L10').evidence!.A,
      q('L10').evidence!.C,
      q('L11').evidence!.C,
      q('L11').answer.C,
      q('L12').evidence!.A,
      q('L12').evidence!.B,
      q('L13').answer.C,
      q('L14').answer.C,
      q('L20').evidence!.A,
    ]
    for (const value of quoted) {
      const words = inWords(value)
      const bare = String(Math.round(value * 100))
      expect(
        plainText.includes(words) ||
          new RegExp(`\\b${bare}\\b`).test(plainText),
        words,
      ).toBe(true)
    }
    // Answers right on single facts, of 72.
    for (const [id, right] of [
      ['A', 72],
      ['B', 71],
      ['C', 68],
    ] as const)
      expect(Math.round(KIND_FIGURES.H3.answer[id] * 72)).toBe(right)
    expect(plainText).toContain(
      'Text search answered all 72 correctly, the graph 71 and the graph with the ontology 68,',
    )
    // The one tested result, as summary.json states it.
    expect(plainText).toContain('22.1 points more')
    expect(plainText).toContain('is 10.4 to 34.1 points')
    // Evidence retrieved, answer wrong.
    expect(plainText).toContain(
      `In ${FAILURE_CLASSES.A[1]} answers from text search, ${FAILURE_CLASSES.B[1]} from the graph and ${FAILURE_CLASSES.C[1]} from the graph with the ontology`,
    )
    expect(q('L13').failures.C[1] + q('L14').failures.C[1]).toBe(12)
  })

  it('names its run, says which difference passed the test, and calls the rest patterns', () => {
    expect(plainText).toContain(
      'official run v0.3.0, which started on 2026-10-29',
    )
    expect(plainText).toContain('Only one passed')
    expect(plainText).toMatch(/a pattern seen in this run/)
    expect(plainText).toContain('These questions were not tested.')
    expect(allText).toContain('official-2026-10-29')
  })

  it('writes Plain for a newcomer: no codes, no banned word, and no em dash at either level', () => {
    expect(plainText).not.toMatch(CODE)
    expect(plainText).not.toMatch(BANNED)
    expect(allText).not.toContain(String.fromCharCode(0x2014))
    expect(allText).not.toMatch(/Atlas/)
  })

  it('shows its parts at Plain and the per-question tables only at Technical', () => {
    show('plain', plain)
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      'Where text search did best',
      'Where the graph did best',
      'Where the graph with the ontology did best',
      'Where none did well',
      'What to take home',
      'When you would want text, a graph, an ontology, or all three',
    ])
    expect(
      screen.queryByRole('table', { name: 'Means for each question' }),
    ).toBeNull()
    cleanup()

    show('technical', technical)
    for (const block of [QUESTION_TABLE, OUTCOME_TABLE]) {
      const table = screen.getByRole('table', { name: block.caption })
      expect(within(table).getAllByRole('row')).toHaveLength(23)
    }
    const l11 = within(
      screen.getByRole('table', { name: 'Means for each question' }),
    ).getByRole('row', { name: /^L11/ })
    expect(l11).toHaveTextContent('0.00 / 0.00 / 0.76')
  })

  it('rounds the Technical cells as Plain rounds its percentages', () => {
    // toFixed rounds the binary float, so 0.745 would read 0.74 against 75% at Plain.
    expect(twoDecimals(0.745)).toBe('0.75')
    expect(twoDecimals(0.185)).toBe('0.19')
    for (const q of QUESTION_FIGURES)
      for (const values of [q.evidence, q.answer])
        if (values)
          for (const id of APPROACHES)
            expect(
              Number(twoDecimals(values[id])) * 100,
              `${q.id} ${id}`,
            ).toBeCloseTo(Number(whole(values[id]).slice(0, -1)), 6)
    show('technical', [QUESTION_TABLE])
    const row = (id: string) =>
      within(
        screen.getByRole('table', { name: 'Means for each question' }),
      ).getByRole('row', { name: new RegExp(`^${id}`) })
    // The two cells the review found mis-rounded, and the Plain figures they match.
    expect(row('L13')).toHaveTextContent('0.75 / 0.54 / 1.00')
    expect(row('L09')).toHaveTextContent('0.28 / 0.19 / 0.19')
    expect(plainText).toContain('28 percent against 19 percent')
  })

  it('discloses the scorer issue at both levels and lists it in the register', () => {
    expect(plainText).toContain('known limit in chapter 9')
    expect(plainText).toContain('accepts "United Kingdom" but not "UK"')
    expect(plainText).toContain('falls from 8.0 to 4.9 points')
    expect(allText).toContain('L18 answers read 0.92 / 1.00 / 0.92')
    const row = REGISTER.find(({ id }) => id === 'scorer-reads-text')!
    expect(row.decision).toBe(
      'Not changed after the result; disclosed (2026-11-02)',
    )
    expect(row.plain).not.toMatch(BANNED)
  })
})
