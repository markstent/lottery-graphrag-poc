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

  it('opens the recording named in the link and shows its question on one line', async () => {
    reduceMotion()
    api({ '/api/v1/health/ready': DOWN })
    open(`#/live-lab?question=${h1.instance_id}`)
    const bar = await screen.findByRole('region', { name: 'Question' })
    expect(within(bar).getByText(h1.question)).toBeVisible()
    expect(within(bar).getByText('Recorded run')).toBeVisible()
    expect(
      within(bar).getByRole('button', { name: 'Change question' }),
    ).toBeVisible()
    expect(
      within(bar).queryByRole('group', { name: 'Saved questions' }),
    ).toBeNull()
    await waitFor(() =>
      expect(
        steps('A · Text search').getAllByRole('listitem')[4],
      ).toHaveTextContent('Done'),
    )
  })

  it('opens the whole bar from "Change question", moves focus into it, and closes it when a run starts', async () => {
    reduceMotion()
    api({ '/api/v1/health/ready': DOWN })
    const user = userEvent.setup()
    open(`#/live-lab?question=${h1.instance_id}`)
    await user.click(
      await screen.findByRole('button', { name: 'Change question' }),
    )
    const saved = screen.getByRole('group', { name: 'Saved questions' })
    expect(within(saved).getAllByRole('button')[0]).toHaveFocus()
    expect(
      within(saved).getByRole('button', { name: h1.question }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.queryByRole('group', { name: 'Saved questions' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus()
  })

  it('keeps Run and Cancel run in the one-line form', async () => {
    api()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: h1.question }))
    const liveButton = screen.getByRole('button', { name: 'Live' })
    await waitFor(() => expect(liveButton).toBeEnabled())
    await user.click(liveButton)
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(stream.subscribeRun).toHaveBeenCalled())
    act(() => handlers.onEvent(live[0]))
    const bar = screen.getByRole('region', { name: 'Question' })
    expect(within(bar).getByText('Live')).toBeVisible()
    expect(
      within(bar).getByRole('button', { name: 'Cancel run' }),
    ).toBeVisible()
    expect(within(bar).getByRole('button', { name: 'Run' })).toBeDisabled()
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

  it('completes the run when the slider is moved to its far end, whatever the fraction of a millisecond', async () => {
    // H3 lasts 20 987.4 ms: a slider that stops at 20 987 would never apply the last event.
    const h3 = RECORDED_RUNS.find((run) => run.stratum === 'H3')!
    const exact = h3.events.at(-1)!.t_ms - h3.events[0].t_ms
    expect(exact % 1).toBeGreaterThan(0)
    expect(exact % 1).toBeLessThan(0.5)
    api({ '/api/v1/health/ready': DOWN })
    open(`#/live-lab?question=${h3.instance_id}`)
    const slider = await screen.findByRole('slider', { name: 'Position' })
    fireEvent.change(slider, {
      target: { value: (slider as HTMLInputElement).max },
    })
    expect(screen.getByText('The run is complete.')).toBeVisible()
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

describe('Live Lab, results', () => {
  const DATASETS = [
    { dataset_id: 'dev-seed2026', active: true, name: 'dev', seed: 2026 },
  ]
  const NODE = {
    node_id: 'INC_037',
    labels: ['Incident'],
    properties: { severity: 'MEDIUM' },
    provenance: {
      dataset_id: 'dev-seed2026',
      table: 'incidents',
      row_id: 'INC_037',
    },
  }
  const RECORD = {
    table: 'incidents',
    row: { incident_id: 'INC_017' },
    graph_node_id: 'INC_017',
    edges: [],
    graph_error: null,
  }
  const resultsApi = () =>
    api({
      '/api/v1/health/ready': DOWN,
      '/api/v1/datasets': DATASETS,
      '/api/v1/graph/nodes/INC_037': NODE,
      '/api/v1/graph/nodes/SUP_00113': { ...NODE, node_id: 'SUP_00113' },
      '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_017': RECORD,
    })

  async function finishRecording(user: ReturnType<typeof userEvent.setup>) {
    reduceMotion()
    resultsApi()
    open(`#/live-lab?question=${h1.instance_id}`)
    await screen.findByRole('region', { name: 'Scorecard' })
    return user
  }

  it('shows the scorecard, three answers, the path strips and the coverage matrix once the run completes', async () => {
    await finishRecording(userEvent.setup())
    const card = screen.getByRole('region', { name: 'Scorecard' })
    expect(
      within(card).getByText('scored against the answer key'),
    ).toBeVisible()
    for (const label of [
      'A · Text search answer',
      'B · Graph answer',
      'C · Graph + Ontology answer',
      'B · Graph evidence path',
      'C · Graph + Ontology evidence path',
    ])
      expect(screen.getByRole('region', { name: label })).toBeVisible()
    expect(screen.getByRole('table', { name: 'Market coverage' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Graph canvas' })).toBeVisible()
  })

  it('shows none of them before the run has ended', async () => {
    resultsApi()
    open()
    expect(screen.queryByRole('region', { name: 'Scorecard' })).toBeNull()
    expect(screen.queryByRole('table', { name: 'Market coverage' })).toBeNull()
    expect(screen.queryByRole('region', { name: /answer$/ })).toBeNull()
  })

  it('opens the evidence drawer from a citation by keyboard and returns focus on close', async () => {
    const user = await finishRecording(userEvent.setup())
    const answer = screen.getByRole('region', { name: 'B · Graph answer' })
    const citation = within(answer).getByRole('button', {
      name: /^Open source 1/,
    })
    citation.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    await within(dialog).findByText('severity')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(citation).toHaveFocus()
  })

  it('opens a table record cited by pipeline A from its row in the dataset', async () => {
    const user = await finishRecording(userEvent.setup())
    const answer = screen.getByRole('region', {
      name: 'A · Text search answer',
    })
    const citations = within(answer).getAllByRole('button')
    expect(citations.length).toBeGreaterThan(0)
    // The recorded A answer cites its first context block, the record INC_037's.
    api({
      '/api/v1/datasets': DATASETS,
      '/api/v1/datasets/dev-seed2026/tables/incidents/rows/INC_037': {
        ...RECORD,
        row: { incident_id: 'INC_037' },
      },
    })
    citations[0].focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(
      await within(dialog).findByText('INC_037', { selector: 'dd' }),
    ).toBeVisible()
  })

  it('opens the drawer from an evidence row in a column, by keyboard, and returns focus', async () => {
    const user = await finishRecording(userEvent.setup())
    const list = within(column('B · Graph')).getByRole('list', {
      name: 'Evidence',
    })
    const row = within(list).getAllByRole('button')[0]
    row.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    // The row is the node INC_037: its properties are the record shown first.
    expect(await within(dialog).findByText('severity')).toBeVisible()
    expect(within(dialog).getByText('MEDIUM')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(row).toHaveFocus()
  })

  it('opens a passage from its row with the text the results carry, and returns focus', async () => {
    reduceMotion()
    resultsApi()
    const h2 = RECORDED_RUNS.find((run) => run.stratum === 'H2')!
    const passage = (
      h2.results.results!.A as {
        evidence: {
          chunk_id: string
          kind: string
          text: string
          selected: boolean
        }[]
      }
    ).evidence.find((c) => c.kind === 'chunk' && c.selected)!
    const user = userEvent.setup()
    open(`#/live-lab?question=${h2.instance_id}`)
    await screen.findByRole('region', { name: 'Scorecard' })
    const list = within(column('A · Text search')).getByRole('list', {
      name: 'Evidence',
    })
    const row = within(list)
      .getAllByRole('button')
      .find((b) => b.textContent?.includes(passage.chunk_id))!
    row.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(dialog).toHaveTextContent(passage.text.replace(/\s+/g, ' ').trim())
    expect(
      within(dialog).getByRole('region', { name: 'Provenance' }),
    ).toBeVisible()
    await user.keyboard('{Escape}')
    expect(row).toHaveFocus()
  })

  it('opens a group of folded graph nodes in the drawer with its members listed', async () => {
    window.localStorage.setItem('visible-node-cap', '12')
    const user = await finishRecording(userEvent.setup())
    const canvas = await screen.findByRole('group', {
      name: 'Graph for B · Graph',
    })
    const group = await waitFor(() => {
      const found = canvas.querySelector<HTMLElement>(
        '[data-node-id^="cluster:"]',
      )
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.click(group)
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(within(dialog).getByText(/^Group of \d+ /)).toBeVisible()
    expect(within(dialog).getAllByRole('listitem').length).toBeGreaterThan(1)
    await user.keyboard('{Escape}')
  })

  it('shows where a node sits on the evidence path in the drawer', async () => {
    const user = await finishRecording(userEvent.setup())
    const strip = screen.getByRole('region', {
      name: 'B · Graph evidence path',
    })
    const node = within(strip)
      .getAllByRole('button')
      .find((b) => b.getAttribute('data-node-id') === 'SUP_00113')!
    node.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(
      within(dialog).getByText(/^Step 2 of 2 on evidence path 2$/),
    ).toBeVisible()
    await user.keyboard('{Escape}')
    expect(node).toHaveFocus()
  })

  it('opens the drawer from a graph node by keyboard and returns focus to the node', async () => {
    const user = await finishRecording(userEvent.setup())
    const canvas = await screen.findByRole('group', {
      name: 'Graph for B · Graph',
    })
    const node = await waitFor(() => {
      const found = canvas.querySelector<HTMLElement>(
        '[data-node-id="INC_037"]',
      )
      expect(found).not.toBeNull()
      return found!
    })
    node.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Evidence' })
    expect(await within(dialog).findByText('severity')).toBeVisible()
    expect(within(dialog).getByText('MEDIUM')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(node).toHaveFocus())
  })

  it('shows measurable items only, and no key, for a typed question', async () => {
    const adHoc = structuredClone(h1.results) as typeof h1.results
    Object.assign(adHoc, {
      benchmark_instance_id: null,
      answer_key: 'none',
      score_status: 'not_applicable',
      score: null,
    })
    api({
      '/api/v1/datasets': DATASETS,
      '/api/v1/queries/RUN-T': adHoc,
    })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: h1.question }))
    const liveButton = screen.getByRole('button', { name: 'Live' })
    await waitFor(() => expect(liveButton).toBeEnabled())
    await user.click(liveButton)
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(stream.subscribeRun).toHaveBeenCalled())
    act(() => {
      for (const event of live) handlers.onEvent(event)
      handlers.onEnd()
    })
    const card = await screen.findByRole('region', { name: 'Scorecard' })
    expect(
      within(card).getByText('No answer key exists for this question.'),
    ).toBeVisible()
    expect(within(card).queryByText('scored against the answer key')).toBeNull()
    expect(within(card).queryByText('Answer')).toBeNull()
  })
})
