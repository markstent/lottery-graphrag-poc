import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App'
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

function stubLiveBackend(
  benchmark: unknown,
  benchmarkQuestionId: string | null = null,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/demo/questions'))
        return Promise.resolve(
          jsonResponse([
            {
              id: 'dq-1',
              question: 'Why did digital conversion fall in Greece?',
              category: 'x',
              benchmark_question_id: benchmarkQuestionId,
            },
          ]),
        )
      if (url.endsWith('/queries'))
        return Promise.resolve(jsonResponse({ run_id: 'RUN-T' }))
      if (url.endsWith('/events'))
        return Promise.resolve(
          jsonResponse({ run_id: 'RUN-T', status: 'completed', events: [] }),
        )
      if (url.endsWith('/benchmarks/latest'))
        return Promise.resolve(jsonResponse(benchmark))
      return Promise.resolve(
        jsonResponse({
          run_id: 'RUN-T',
          question: 'Why did digital conversion fall in Greece?',
          status: 'completed',
          configurations: ['A', 'C'],
          error: null,
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

async function runLiveQuestion() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByLabelText('Reduce motion'))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))

  fireEvent.click(screen.getByRole('button', { name: 'Live backend' }))
  const runButton = screen.getByRole('button', { name: 'Run' })
  await waitFor(() => expect(runButton).toBeEnabled())
  fireEvent.click(runButton)
}

describe('App', () => {
  it('renders the application shell with primary navigation', () => {
    render(<App />)

    expect(screen.getByText('Semantic Context Lab')).toBeVisible()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toBeVisible()
    expect(screen.getByRole('link', { name: 'Live Lab' })).toHaveAttribute(
      'href',
      '#/lab',
    )
    expect(
      screen.getByRole('link', { name: 'Semantic Layer' }),
    ).toHaveAttribute('href', '#/semantic')
  })

  it('lands on Live Lab by default', () => {
    render(<App />)

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

  it('opens the inline Evidence Inspector drawer when a citation is clicked in Live Lab', () => {
    render(<App />)

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

  it('never replays the story for a question it does not contain', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /dq-2/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /dq-3/ })).toBeDisabled()

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Something entirely different?' },
    })
    expect(run).toBeDisabled()
  })

  it('offers a market scope selector that only activates in Live backend mode', () => {
    render(<App />)

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

  it('explains why a live backend run has no evaluation scores', async () => {
    stubLiveBackend({ questions: [] })
    await runLiveQuestion()

    expect(
      await screen.findByText('No evaluation scores for this run.'),
    ).toBeVisible()
  })

  it('says per-question scores are not shown for a v2 benchmark run', async () => {
    stubLiveBackend(V2_BENCHMARK, 'Q30')
    await runLiveQuestion()

    expect(
      await screen.findByText(
        'Per-question benchmark scores are not shown for benchmark v2 runs yet.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByText('No evaluation scores for this run.'),
    ).not.toBeInTheDocument()
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
