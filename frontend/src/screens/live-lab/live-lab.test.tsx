import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunStreamHandlers } from '../../api/stream'
import { SettingsProvider } from '../../app/settings'
import fixture from '../../run/fixtures/run-abc.json'
import { RECORDED_RUNS } from '../../run/recorded'
import type { RunEvent } from '../../run/reduce'
import { DOWN, failure, json, READY, stubApi } from '../../test/api-stub'
import { LiveLab } from './live-lab'

const stream = vi.hoisted(() => ({ subscribeRun: vi.fn() }))
vi.mock('../../api/stream', () => stream)

const h1 = RECORDED_RUNS.find((run) => run.stratum === 'H1')!
const QUESTIONS = [
  ...RECORDED_RUNS.map((run) => ({
    instance_id: run.instance_id,
    question_id: run.instance_id.slice(0, 3),
    text: run.question,
    stratum: run.stratum,
    market_scope: [],
  })),
  {
    instance_id: 'L99-2026-GR_ONLY',
    question_id: 'L99',
    text: 'A saved question with no recording?',
    stratum: 'H1',
    market_scope: ['MKT_GR'],
  },
]
const live = fixture.events as unknown as RunEvent[]

let handlers: RunStreamHandlers

function api(overrides: Record<string, unknown> = {}) {
  return stubApi({
    '/api/v1/health/ready': READY,
    '/api/v1/demo/questions': QUESTIONS,
    '/api/v1/queries': { run_id: 'RUN-T' },
    '/api/v1/queries/RUN-T/cancel': {},
    ...overrides,
  })
}

function open(hash = '#/live-lab', search = '') {
  window.history.replaceState(null, '', `/${search}${hash}`)
  return render(
    <SettingsProvider>
      <LiveLab />
    </SettingsProvider>,
  )
}

const reduceMotion = () => window.localStorage.setItem('reduced-motion', 'true')
const column = (label: string) => screen.getByRole('region', { name: label })
const steps = (label: string) =>
  within(within(column(label)).getByRole('list', { name: 'Steps' }))

beforeEach(() => {
  window.localStorage.clear()
  stream.subscribeRun.mockImplementation(
    (_id: string, next: RunStreamHandlers) => {
      handlers = next
      return vi.fn()
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Live Lab', () => {
  it('opens with its purpose sentence, its heading and one column per pipeline', async () => {
    api()
    open()
    expect(
      screen.getByText(
        'Run one question through all three approaches and watch them work',
      ),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Live Lab' }),
    ).toBeVisible()
    for (const label of [
      'A · Text search',
      'B · Graph',
      'C · Graph + Ontology',
    ])
      expect(column(label)).toBeVisible()
    await screen.findByRole('button', { name: h1.question })
  })

  it('defaults to the recorded run when the backend is not ready and says why Live is off', async () => {
    api({ '/api/v1/health/ready': DOWN })
    open()
    const source = screen.getByRole('group', { name: 'Source' })
    const live = within(source).getByRole('button', { name: 'Live' })
    await waitFor(() => expect(live).toBeDisabled())
    expect(
      within(source).getByRole('button', { name: 'Recorded run' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByText(
        'The answer model is not ready: qwen3:8b is not listed by the model server.',
      ),
    ).toBeVisible()
  })

  it('plays a recorded run to its end at once under reduced motion', async () => {
    reduceMotion()
    api({ '/api/v1/health/ready': DOWN })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: h1.question }))
    await user.click(screen.getByRole('button', { name: 'Run' }))

    for (const label of [
      'A · Text search',
      'B · Graph',
      'C · Graph + Ontology',
    ])
      for (const row of steps(label).getAllByRole('listitem'))
        expect(row).toHaveTextContent('Done')
    const evidence = within(column('B · Graph')).getByRole('list', {
      name: 'Evidence',
    })
    expect(within(evidence).getByText('INC_037')).toBeVisible()
    expect(within(column('B · Graph')).getByText(/12 used/)).toBeVisible()
  })

  it('titles evidence records in plain words with the id beside them', async () => {
    reduceMotion()
    api({ '/api/v1/health/ready': DOWN })
    open(`#/live-lab?question=${h1.instance_id}`)
    const evidence = await waitFor(() =>
      within(column('A · Text search')).getByRole('list', { name: 'Evidence' }),
    )
    expect(
      within(evidence).getByText(
        'Incident INC_037 in United Kingdom: Identity service latency causing timeouts',
      ),
    ).toBeVisible()
    expect(within(evidence).getByText('REC_incidents_INC_037')).toBeVisible()
    expect(
      within(column('A · Text search')).getByText(
        '40 found · 12 used · 28 set aside',
      ),
    ).toBeVisible()
  })

  it('keeps Run enabled while a recording is paused and restarts it when pressed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    api({ '/api/v1/health/ready': DOWN })
    open(`#/live-lab?question=${h1.instance_id}`)
    await act(async () => {})
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByText(/^Paused at /)).toBeVisible()
    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeEnabled()
    fireEvent.click(run)
    expect(screen.getByText('Playing the recorded run.')).toBeVisible()
    expect(screen.getByRole('slider', { name: 'Position' })).toHaveValue('0')
  })

  it('opens the recording named in the link and selects its question', async () => {
    reduceMotion()
    api({ '/api/v1/health/ready': DOWN })
    open(`#/live-lab?question=${h1.instance_id}`)
    expect(
      await screen.findByRole('button', { name: h1.question }),
    ).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(
        steps('A · Text search').getAllByRole('listitem')[4],
      ).toHaveTextContent('Done'),
    )
  })

  it('locks the market scope to the saved question and frees it for a typed one', async () => {
    api()
    const user = userEvent.setup()
    open()
    await user.click(
      await screen.findByRole('button', {
        name: 'A saved question with no recording?',
      }),
    )
    const scope = screen.getByRole('group', { name: 'Market scope' })
    for (const button of within(scope).getAllByRole('button'))
      expect(button).toBeDisabled()
    expect(
      within(scope).getByRole('button', { name: 'Greece' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await user.type(
      screen.getByRole('textbox', { name: 'Or ask your own question' }),
      'What changed in Austria?',
    )
    expect(within(scope).getByRole('button', { name: 'Greece' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Recorded run' })).toBeDisabled()
  })

  it('cannot run a typed question without the live backend', async () => {
    api({ '/api/v1/health/ready': DOWN })
    const user = userEvent.setup()
    open()
    await user.type(
      await screen.findByRole('textbox', { name: 'Or ask your own question' }),
      'What changed in Austria?',
    )
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(
      screen.getByText('Your own question needs the live source.'),
    ).toBeVisible()
  })

  it('has no recording to run for a saved question that lacks one', async () => {
    api({ '/api/v1/health/ready': DOWN })
    const user = userEvent.setup()
    open()
    await user.click(
      await screen.findByRole('button', {
        name: 'A saved question with no recording?',
      }),
    )
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(screen.getByText('No recorded run for this question.')).toBeVisible()
  })
})

describe('Live Lab, live run', () => {
  async function startLive(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: h1.question }))
    const liveButton = screen.getByRole('button', { name: 'Live' })
    await waitFor(() => expect(liveButton).toBeEnabled())
    await user.click(liveButton)
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(stream.subscribeRun).toHaveBeenCalled())
  }

  it('fills the columns as events arrive and offers the timeline once it ends', async () => {
    const fetchMock = api()
    const user = userEvent.setup()
    open()
    await startLive(user)

    const post = (fetchMock.mock.calls as unknown[][]).find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      benchmark_instance_id: h1.instance_id,
      market_scope: [],
    })

    const started = live.findIndex(
      (event) => event.event_type === 'rag.vector_search.started',
    )
    act(() => {
      for (const event of live.slice(0, started + 1)) handlers.onEvent(event)
    })
    const rows = steps('A · Text search').getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Done')
    expect(rows[1]).toHaveTextContent('Running')
    expect(rows[2]).toHaveTextContent('Waiting')
    expect(steps('B · Graph').getAllByRole('listitem')[0]).toHaveTextContent(
      'Waiting',
    )
    expect(screen.getByRole('slider', { name: 'Position' })).toBeDisabled()

    act(() => {
      for (const event of live.slice(started + 1)) handlers.onEvent(event)
      handlers.onEnd()
    })
    for (const row of steps('C · Graph + Ontology').getAllByRole('listitem'))
      expect(row).toHaveTextContent('Done')
    expect(screen.getByRole('slider', { name: 'Position' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull()
  })

  it('shows the 409 message and a retry that starts the run again', async () => {
    let calls = 0
    api({
      '/api/v1/queries': () =>
        ++calls === 1
          ? failure('Another run is using the graph.', true, 409)
          : json({ run_id: 'RUN-T' }),
    })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: h1.question }))
    const liveButton = screen.getByRole('button', { name: 'Live' })
    await waitFor(() => expect(liveButton).toBeEnabled())
    await user.click(liveButton)
    await user.click(screen.getByRole('button', { name: 'Run' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Another run is using the graph.')
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(stream.subscribeRun).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls).toBe(2)
  })

  it('cancels through the API and shows its 409 message', async () => {
    const fetchMock = api({
      '/api/v1/queries/RUN-T/cancel': () =>
        failure('The run has already ended.', false, 409),
    })
    const user = userEvent.setup()
    open()
    await startLive(user)
    act(() => handlers.onEvent(live[0]))
    await user.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/queries/RUN-T/cancel'),
      ),
    ).toBe(true)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The run has already ended.',
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('closes the live stream when the screen goes away', async () => {
    api()
    const close = vi.fn()
    stream.subscribeRun.mockReturnValue(close)
    const user = userEvent.setup()
    const { unmount } = open()
    await startLive(user)
    unmount()
    expect(close).toHaveBeenCalled()
  })
})

describe('Live Lab, timeline', () => {
  async function playRecording() {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    api({ '/api/v1/health/ready': DOWN })
    open('#/live-lab', '?present=1')
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: h1.question }))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    const duration = h1.events.at(-1)!.t_ms - h1.events[0].t_ms
    act(() => {
      vi.advanceTimersByTime(duration + 1000)
    })
  }

  const position = () =>
    Number(
      (screen.getByRole('slider', { name: 'Position' }) as HTMLInputElement)
        .value,
    )

  it('drives the timeline with the presentation keys', async () => {
    await playRecording()
    expect(position()).toBeGreaterThan(0)
    const first = () => steps('A · Text search').getAllByRole('listitem')[0]
    expect(first()).toHaveTextContent('Done')

    fireEvent.keyDown(document.body, { key: 'r' })
    expect(position()).toBe(0)
    expect(first()).toHaveTextContent('Waiting')

    fireEvent.keyDown(document.body, { key: ' ' })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(position()).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible()

    fireEvent.keyDown(document.body, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Play' })).toBeVisible()
    const paused = position()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(position()).toBe(paused)

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(position()).toBeGreaterThanOrEqual(paused)
  })

  it('rewinds, replays, scrubs and changes speed with its own controls', async () => {
    await playRecording()
    fireEvent.click(screen.getByRole('button', { name: 'Rewind' }))
    expect(position()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '4x' }))
    expect(screen.getByRole('button', { name: '4x' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(position()).toBeGreaterThan(1000)

    const duration = h1.events.at(-1)!.t_ms - h1.events[0].t_ms
    fireEvent.change(screen.getByRole('slider', { name: 'Position' }), {
      target: { value: String(Math.round(duration)) },
    })
    expect(
      steps('C · Graph + Ontology').getAllByRole('listitem')[4],
    ).toHaveTextContent('Done')
  })

  it('draws three tracks, one per pipeline', async () => {
    await playRecording()
    const timeline = screen.getByRole('region', { name: 'Timeline' })
    for (const id of ['A', 'B', 'C'])
      expect(
        within(timeline).getByRole('img', { name: new RegExp(`^${id} · `) }),
      ).toBeVisible()
  })
})
