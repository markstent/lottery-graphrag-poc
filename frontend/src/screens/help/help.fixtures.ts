/**
 * The question bank and scenarios as the API answered them (captured by
 * `scripts/capture-questions.mjs`), so the tests read the real answer keys
 * and hidden truths. The scored capture comes from a run of part of the
 * bank (dry-run-2026-10-29, four instances), so it stands in for the shape of
 * a whole-bank run's scores.
 */

import { vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { json, SHELL_API } from '../../test/api-stub'
import scored from '../../../e2e/fixtures/benchmark-questions-scored.json'
import unscored from '../../../e2e/fixtures/benchmark-questions-unscored.json'
import world from '../../../e2e/fixtures/ontology-world.json'

export const SCENARIOS = world.scenarios as unknown as Schemas['ScenarioOut'][]
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
    overall: { evidence_recall: { A: cell(0.3), B: cell(0.4), C: cell(0.4) } },
  },
})

/** `GET /benchmarks/latest` for a whole-bank official run and for a quick check. */
export const OFFICIAL = {
  run_id: 'official',
  run_kind: 'official',
  label: null,
  method_version: '0.3.0',
  summary: summary({ strata: null, limit: null }),
}
export const SMOKE = {
  run_id: 'smoke',
  run_kind: 'smoke',
  label: 'scorer smoke test',
  method_version: '0.3.0',
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

/** `GET /settings`: the settings the system runs with now. */
export const SETTINGS = {
  judge_configured: true,
  values: {
    generation_model: 'model-now',
    generation_temperature: 0,
    max_tokens: 1024,
    top_k: 20,
    context_budget_tokens: 2000,
    context: { dedupe_threshold: 0.85 },
    judge_model: 'judge-now',
  },
}

/** A listed run, as `GET /benchmarks` gives it. */
const listed = (run_id: string, run_kind: string, started_at: string) => ({
  run_id,
  run_kind,
  label: null,
  headlines: [],
  selection: { strata: null, limit: null, questions: null },
  started_at,
  worlds: [2026],
})

/** An official run that recorded some of those settings, one of them with another value. */
const OFFICIAL_RECORDED = {
  ...OFFICIAL,
  run_id: 'official-recorded',
  summary: {
    ...OFFICIAL.summary,
    reproducibility: {
      run: {
        generation_model: 'model-then',
        top_k: 20,
        context_budget_tokens: 1500,
        context: { dedupe_threshold: 0.85 },
      },
      worlds: [],
    },
  },
}

/** The run list and run records of a published official run, older than any quick check. */
export const RECORDED_RUNS = {
  runs: [listed('official-recorded', 'official', '2026-10-01T00:00:00Z')],
  details: { 'official-recorded': OFFICIAL_RECORDED },
}

/** A newer quick check listed beside the older official run, whose record has other values. */
export const QUICK_CHECK_NEWER = {
  runs: [
    listed('quick', 'smoke', '2026-10-20T00:00:00Z'),
    listed('official-recorded', 'official', '2026-10-01T00:00:00Z'),
  ],
  details: {
    quick: {
      ...SMOKE,
      summary: {
        ...SMOKE.summary,
        reproducibility: { run: { top_k: 99 }, worlds: [] },
      },
    },
    'official-recorded': OFFICIAL_RECORDED,
  },
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
  settings?: unknown
  failSettings?: boolean
  /** The run list and the record of each run, by id. */
  runs?: unknown[]
  details?: Record<string, unknown>
  failRuns?: boolean
}

/** A fetch stand-in for everything Help loads; the shell's routes are included. */
export function stubBank({
  questions = SCORED,
  latest = OFFICIAL,
  failQuestions = false,
  failLatest = false,
  settings = SETTINGS,
  failSettings = false,
  runs = [],
  details = {},
  failRuns = false,
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
    if (path === '/api/v1/benchmarks')
      return Promise.resolve(
        failRuns
          ? json(
              {
                error: {
                  error_code: 'RUN_ERROR',
                  message: 'The run list is unavailable.',
                  retryable: true,
                },
              },
              503,
            )
          : json(runs),
      )
    const detail = /^\/api\/v1\/benchmarks\/([^/]+)$/.exec(path)?.[1]
    if (detail && detail in details)
      return Promise.resolve(json(details[detail]))
    if (path === '/api/v1/settings')
      return Promise.resolve(
        failSettings
          ? json(
              {
                error: {
                  error_code: 'CONFIGURATION_ERROR',
                  message: 'The settings are invalid.',
                  retryable: true,
                },
              },
              503,
            )
          : json(settings),
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

/** A copy of `element` without the glossary meanings that first-use terms carry, so its text is what a reader sees. */
export function withoutTermHelp(element: Element): Element {
  const copy = element.cloneNode(true) as Element
  for (const help of copy.querySelectorAll('[role="tooltip"]')) help.remove()
  return copy
}
