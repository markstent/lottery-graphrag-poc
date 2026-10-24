/**
 * What the scorecard shows, worked out from the run's stored results: the
 * score the harness wrote (`results.score`) and the results' own measures,
 * nothing else. A measure that is null stays null, so the screen can say it is
 * missing; it is never turned into 0. A run is scored only when its answer key
 * exists, scoring finished, and a score is there.
 */

import type { Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
import type { PipelineId } from '../../design/pipelines'
import { coverage } from '../../run/coverage'
import { formatDuration } from './format'

type Results = Schemas['QueryResults']

/** The harness's failure classes (backend/app/evaluation/scoring.py) in plain words. */
export const FAILURE_WORDS: Record<string, string> = {
  entity_resolution_failure: 'the starting record was not found',
  retrieval_failure: 'the needed evidence was not retrieved',
  generation_failure: 'the evidence was retrieved but the answer was wrong',
}

/** Words for a failure class; a class from a newer backend still reads as words. */
export function failureWords(failureClass: string | null): string | null {
  if (failureClass === null) return null
  return FAILURE_WORDS[failureClass] ?? plainName(failureClass)
}

export interface ScoreColumn {
  /** Null where the run holds no score for this pipeline. */
  answer: number | null
  evidenceF1: number | null
  anchorResolution: number | null
  failureClass: string | null
  failure: string | null
  latencyMs: number
  contextTokens: number
  /** How many markets the used evidence reached. */
  markets: number
}

export interface Scorecard {
  scored: boolean
  label: string
  /** Null for a pipeline with no stored result. */
  columns: Record<PipelineId, ScoreColumn | null>
}

const SCORE_LABEL = 'scored against the answer key'

export function scorecard(results: Results): Scorecard {
  const score = results.score ?? null
  const scored =
    results.answer_key === 'available' &&
    results.score_status === 'scored' &&
    score !== null
  const reached = coverage(results)
  const column = (id: PipelineId): ScoreColumn | null => {
    const result = results.results?.[id]
    if (!result) return null
    const own = scored ? (score.per_pipeline[id] ?? null) : null
    return {
      answer: own?.answer ?? null,
      evidenceF1: own?.evidence_f1 ?? null,
      anchorResolution: own?.anchor_resolution ?? null,
      failureClass: own?.failure_class ?? null,
      failure: failureWords(own?.failure_class ?? null),
      latencyMs: result.answer.latency_ms,
      contextTokens: result.answer.context_tokens,
      markets: reached[id]?.length ?? 0,
    }
  }
  return {
    scored,
    label: SCORE_LABEL,
    columns: { A: column('A'), B: column('B'), C: column('C') },
  }
}

/** The value less the baseline; null when either is missing. */
export function delta(value: number | null, base: number | null) {
  return value === null || base === null ? null : value - base
}

export type DeltaKind = 'score' | 'latency' | 'tokens' | 'markets'

const SAME = 'same as A'

/**
 * How a pipeline moved against A; null when there is no delta. Every move is a
 * signed figure ("+0.40 vs A", "-6.5 s vs A", "+1 vs A").
 */
export function deltaWords(kind: DeltaKind, d: number | null): string | null {
  if (d === null) return null
  if (kind === 'score') {
    const size = Math.abs(d).toFixed(2)
    if (size === '0.00') return SAME
    return `${d > 0 ? '+' : '-'}${size} vs A`
  }
  if (kind === 'latency') {
    if (Math.abs(d) < 1) return SAME
    return `${d > 0 ? '+' : '-'}${formatDuration(Math.abs(d))} vs A`
  }
  if (d === 0) return SAME
  return `${d > 0 ? '+' : '-'}${Math.abs(d).toLocaleString('en-GB')} vs A`
}
