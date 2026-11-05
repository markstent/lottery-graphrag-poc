/**
 * The Judges' verdict section (D-105): the two judges' combined mark per
 * approach, its own tested comparisons, how often the judges agree, and the
 * answers they disagree on. Every number is the one `combined.json` holds;
 * nothing here is a statistic.
 */

import type { Schemas } from '../api/client'
import type { IntervalRow } from '../charts/interval-plot'
import { pipeline, PIPELINES, type PipelineId } from '../design/pipelines'
import { cellRows } from './strata'

export type JudgesMark = Schemas['JudgesMarkOut']

export const JUDGES = {
  title: "Judges' verdict",
  mark: "Judges' mark",
  note: 'Tested apart from the evidence and answer score tests.',
  disagree: 'Judges disagree',
  none: 'Not worked out yet.',
} as const

/** A judge's correctness level (0, 1, 2) in words. */
const LEVEL_WORDS = ['wrong', 'partly', 'correct'] as const

export const levelWord = (level: number): string => LEVEL_WORDS[level] ?? '-'

/** Each approach's mean mark over every question, null where it has none. */
export function markTiles(
  combined: JudgesMark,
): { pipeline: PipelineId; mean: number | null }[] {
  const overall = combined.metrics.overall ?? {}
  return PIPELINES.map(({ id }) => ({
    pipeline: id,
    mean: overall[id]?.mean ?? null,
  }))
}

/** The judges' family as interval rows, in points. */
export const markRows = (combined: JudgesMark): IntervalRow[] =>
  cellRows(combined.comparisons)

export interface DisagreeRow {
  key: string
  question: string
  approach: string
  first: string
  second: string
}

/** The answers the judges disagree on, in run order, in words. */
export function disagreeRows(combined: JudgesMark): DisagreeRow[] {
  return combined.disagreements.map((d) => ({
    key: `${d.instance_id}:${d.pipeline}:${d.repeat}`,
    question: d.question,
    approach: pipeline(d.pipeline as PipelineId).label,
    first: levelWord(d.first),
    second: levelWord(d.second),
  }))
}
