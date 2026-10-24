/**
 * The question bank and scenarios as the API answered them (captured by
 * `scripts/capture-questions.mjs`), so the tests read the real answer keys
 * and hidden truths. The scored capture comes from a run of part of the
 * bank, so it stands in for the shape of a whole-bank run's scores.
 */

import { vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { json, SHELL_API } from '../../test/api-stub'
import scored from '../../../e2e/fixtures/benchmark-questions-scored.json'
import unscored from '../../../e2e/fixtures/benchmark-questions-unscored.json'
import { SCENARIOS } from '../data-model/ontology.fixtures'

export { SCENARIOS }
export const SCORED = scored as unknown as Schemas['QuestionOut'][]
export const UNSCORED = unscored as unknown as Schemas['QuestionOut'][]

const cell = (mean: number) => ({ mean, n: 36, repeats: 108 })

const summary = (selection: {
  strata: string[] | null
  limit: number | null
}) => ({
  selection,
  headlines: [],
  metrics: {
    overall: { evidence_f1: { A: cell(0.3), B: cell(0.4), C: cell(0.4) } },
  },
})

/** `GET /benchmarks/latest` for a whole-bank official run and for a quick check. */
export const OFFICIAL = {
  run_id: 'official',
  run_kind: 'official',
  label: null,
  summary: summary({ strata: null, limit: null }),
}
export const SMOKE = {
  run_id: 'smoke',
  run_kind: 'smoke',
  label: 'scorer smoke test',
  summary: summary({ strata: null, limit: null }),
}

/** An official run of part of the bank, as the backend publishes today. */
export const OFFICIAL_SUBSET = {
  ...OFFICIAL,
  run_id: 'official-subset',
  summary: summary({ strata: null, limit: 2 }),
}
export const OFFICIAL_STRATA = {
  ...OFFICIAL,
  run_id: 'official-strata',
  summary: summary({ strata: ['H1'], limit: null }),
}

export const NOT_FOUND = () =>
  json(
    { error: { error_code: 'NOT_FOUND', message: 'none', retryable: false } },
    404,
  )

export interface BankStub {
  questions?: Schemas['QuestionOut'][]
  latest?: unknown
  failQuestions?: boolean
  failLatest?: boolean
}

/** A fetch stand-in for everything Help loads; the shell's routes are included. */
export function stubBank({
  questions = SCORED,
  latest = OFFICIAL,
  failQuestions = false,
  failLatest = false,
}: BankStub = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path === '/api/v1/benchmarks/questions')
      return Promise.resolve(
        failQuestions
          ? json(
              {
                error: {
                  error_code: 'RUN_ERROR',
                  message: 'The bank is unavailable.',
                  retryable: true,
                },
              },
              503,
            )
          : json(questions),
      )
    if (path === '/api/v1/scenarios') return Promise.resolve(json(SCENARIOS))
    if (path === '/api/v1/benchmarks/latest' && failLatest)
      return Promise.resolve(
        json(
          {
            error: {
              error_code: 'RUN_ERROR',
              message: 'The latest run is unavailable.',
              retryable: true,
            },
          },
          503,
        ),
      )
    if (path === '/api/v1/benchmarks/latest')
      return Promise.resolve(latest === null ? NOT_FOUND() : json(latest))
    if (path in SHELL_API)
      return Promise.resolve(json(SHELL_API[path as keyof typeof SHELL_API]))
    return Promise.resolve(NOT_FOUND())
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
