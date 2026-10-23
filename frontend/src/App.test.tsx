import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { SHELL_API } from './test/api-stub'
import { ResultsDashboard } from './views/results-dashboard'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const SMOKE_LINE =
  'Scorer smoke test: the fake generator answers from titles only; these numbers are not a result.'

const V2_BENCHMARK = {
  run_id: 'smoke-2026',
  run_kind: 'smoke',
  label: 'scorer smoke test',
  summary: { schema_version: '2', headlines: [SMOKE_LINE] },
}

const LIVE_SCORE = {
  instance_id: 'L05-2026-INC_S007_GR',
  label: 'scored against the answer key',
  per_pipeline: {
    A: {
      answer: 0,
      evidence_f1: 0.5,
      anchor_resolution: 1,
      failure_class: 'generation_failure',
    },
    C: {
      answer: 1,
      evidence_f1: null,
      anchor_resolution: 1,
      failure_class: null,
    },
  },
}

function stubLiveBackend(
  answerKey: 'none' | 'available',
  scoreStatus: string,
  score: unknown,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const shellPath = new URL(url, 'http://localhost').pathname
      if (shellPath in SHELL_API)
        return Promise.resolve(
          jsonResponse(SHELL_API[shellPath as keyof typeof SHELL_API]),
        )
      if (url.endsWith('/demo/questions'))
        return Promise.resolve(
          jsonResponse([
            {
              instance_id: 'L05-2026-INC_S007_GR',
              question_id: 'L05',
              text: 'Why did digital conversion fall in Greece?',
              stratum: 'H1',
              market_scope: [],
            },
          ]),
        )
      if (url.endsWith('/queries'))
        return Promise.resolve(jsonResponse({ run_id: 'RUN-T' }))
      if (url.endsWith('/events'))
        return Promise.resolve(
          jsonResponse({ run_id: 'RUN-T', status: 'completed', events: [] }),
        )
      return Promise.resolve(
        jsonResponse({
          run_id: 'RUN-T',
          question: 'Why did digital conversion fall in Greece?',
          status: 'completed',
          configurations: ['A', 'C'],
          error: null,
          answer_key: answerKey,
          score_status: scoreStatus,
          score,
          results: {
            A: {
              answer: {
                text: 'Pipeline A answer',
                latency_ms: 10,
                context_tokens: 5,
                citations: [],
              },
            },
            C: {
              answer: {
                text: 'Pipeline C answer',
                latency_ms: 20,
                context_tokens: 9,
                citations: [],
              },
            },
          },
        }),
      )
    }),
  )
}

/** The Live Lab is its own chunk, so it appears a moment after the shell. */
async function renderLiveLab() {
  render(<App />)
  await screen.findByRole('region', { name: 'Question composer' })
}

async function runLiveQuestion() {
  await renderLiveLab()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByLabelText('Reduce motion'))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))

  fireEvent.click(screen.getByRole('button', { name: 'Live backend' }))
  const runButton = screen.getByRole('button', { name: 'Run' })
  await waitFor(() => expect(runButton).toBeEnabled())
  fireEvent.click(runButton)
}

describe('App', () => {
  // The screens below are the v1 Live Lab, which the shell now reaches at #/live-lab.
  beforeEach(() => {
    window.history.replaceState(null, '', '/#/live-lab')
  })

  it('renders the application shell with primary navigation', () => {
    render(<App />)

    expect(screen.getByText('Semantic Context Lab')).toBeVisible()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toBeVisible()
    expect(screen.getByRole('link', { name: 'Live Lab' })).toHaveAttribute(
      'href',
      '#/live-lab',
    )
    expect(screen.getByRole('link', { name: 'Data Model' })).toHaveAttribute(
      'href',
      '#/data-model',
    )
  })

  it('lands on Live Lab by default', async () => {
    await renderLiveLab()

    expect(
      screen.getByRole('region', { name: 'Question composer' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run' })).toBeVisible()
  })

  it('links to the in-app Help screen', () => {
    render(<App />)

    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute(
      'href',
      '#/help',
    )
  })

  it('opens the inline Evidence Inspector drawer when a citation is clicked in Live Lab', async () => {
    await renderLiveLab()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByLabelText('Reduce motion'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    const citationButton = screen.getByRole('button', {
      name: /Inspect citation Incident Report: INC_S007_GR/,
    })
    fireEvent.click(citationButton)

    expect(
      screen.getByRole('dialog', { name: 'Evidence inspection drawer' }),
    ).toBeVisible()
    expect(screen.getByText('Open full page ↗')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(
      screen.queryByRole('dialog', { name: 'Evidence inspection drawer' }),
    ).toBeNull()
  })

  it('embeds the benchmark question status log disclosure on Results Dashboard', () => {
    render(<ResultsDashboard />)

    expect(
      screen.getByText('Benchmark execution & question status log'),
    ).toBeVisible()
    expect(screen.getByText('Q-001')).toBeInTheDocument()
  })

  it('never replays the story for a question it does not contain', async () => {
    await renderLiveLab()

    expect(screen.getByRole('button', { name: /dq-2/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /dq-3/ })).toBeDisabled()

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Something entirely different?' },
    })
    expect(run).toBeDisabled()
  })

  it('offers a market scope selector that only activates in Live backend mode', async () => {
    await renderLiveLab()

    const group = screen.getByRole('group', { name: 'Market scope' })
    expect(group).toBeVisible()
    expect(screen.getByRole('button', { name: 'All markets' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(group).getByRole('button', { name: 'Greece' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Live backend' }))
    expect(within(group).getByRole('button', { name: 'Greece' })).toBeEnabled()
  })

  it('says in plain words that a bank question could not be scored', async () => {
    stubLiveBackend('available', 'failed', null)
    await runLiveQuestion()

    expect(await screen.findByText('Scoring failed.')).toBeVisible()
  })

  it('says an ad hoc live run has no answer key', async () => {
    stubLiveBackend('none', 'not_applicable', null)
    await runLiveQuestion()

    expect(await screen.findByText('No answer key.')).toBeVisible()
  })

  it('shows a bank question scored against the answer key as plain text', async () => {
    stubLiveBackend('available', 'scored', LIVE_SCORE)
    await runLiveQuestion()

    const score = await screen.findByRole('region', { name: 'Live score' })
    expect(score).toHaveTextContent(
      'Question L05-2026-INC_S007_GR: scored against the answer key.',
    )
    expect(score).toHaveTextContent(
      'A: answer 0.00 · evidence F1 0.50 · anchor resolution 1.00 · failure class generation_failure',
    )
    expect(score).toHaveTextContent(
      'C: answer 1.00 · evidence F1 not defined · anchor resolution 1.00 · failure class none',
    )
    expect(screen.queryByText('No answer key.')).not.toBeInTheDocument()
  })

  it('shows a v2 benchmark run as a notice, not the committed v1 run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(V2_BENCHMARK))),
    )
    render(<ResultsDashboard />)

    const notice = await screen.findByRole('region', {
      name: 'Benchmark v2 run',
    })
    expect(notice).toHaveTextContent('A benchmark v2 run is published')
    expect(notice).toHaveTextContent('kind smoke')
    expect(notice).toHaveTextContent('labelled scorer smoke test')
    expect(notice).toHaveTextContent(
      'The full results screen for benchmark v2 arrives in the product phase.',
    )
    expect(within(notice).getAllByRole('listitem')).toHaveLength(1)
    expect(within(notice).getByRole('listitem')).toHaveTextContent(SMOKE_LINE)
    expect(
      screen.queryByText('30-question Evaluation Harness'),
    ).not.toBeInTheDocument()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })
})
