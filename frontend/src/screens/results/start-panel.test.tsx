import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { ApiError } from '../../api/http'
import type { ModelStatus } from '../../app/use-readiness'
import { MODELS, stubApi } from '../../test/api-stub'
import { Panel } from '../../components/panel'
import {
  KINDS_NOTE,
  PUBLIC_RUNS_OFF,
  StartArea,
  StartButton,
} from './start-panel'

type Job = Schemas['BenchmarkJob']

const ROUTES = {
  '/api/v1/models': {
    ...MODELS,
    judge: {
      provider: 'ollama',
      model: 'judge-model',
      reachable: true,
      detail: 'listed',
    },
  },
  '/api/v1/benchmarks/latest': { summary: { bank_version: 'bank-v7' } },
}

const job = (change: Partial<Job>): Job => ({
  job_id: 'J1',
  status: 'running',
  run_id: null,
  error: null,
  progress: {
    world_seed: 2027,
    worlds_done: 1,
    worlds_total: 3,
    instances_done: 12,
    instances_total: 40,
  },
  ...change,
})

type Props = Pick<
  Parameters<typeof StartArea>[0],
  'job' | 'error' | 'start' | 'cancel'
> & { site?: ModelStatus }

function Harness({ site = 'ready', ...props }: Props) {
  const [open, setOpen] = useState(false)
  const [returned, setReturned] = useState(false)
  const close = () => {
    setReturned(true)
    setOpen(false)
  }
  return (
    <Panel
      title="Benchmark runs"
      state="ready"
      headerAction={
        <StartButton
          job={props.job}
          open={open}
          onOpen={() => setOpen(true)}
          autoFocus={returned}
          site={site}
        />
      }
      above={
        <StartArea
          {...props}
          open={open}
          onClose={close}
          onStarted={() => setOpen(false)}
        />
      }
    />
  )
}

function show(
  props: Partial<Props> = {},
  routes: Record<string, unknown> = ROUTES,
) {
  stubApi(routes)
  const start = vi.fn().mockResolvedValue(undefined)
  const cancel = vi.fn().mockResolvedValue(undefined)
  render(
    <Harness
      job={null}
      error={null}
      start={start}
      cancel={cancel}
      {...props}
    />,
  )
  return { start, cancel, user: userEvent.setup() }
}

const form = () => screen.getByRole('region', { name: 'Benchmark runs' })
const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Start a run' }))

afterEach(() => vi.unstubAllGlobals())

describe('StartPanel', () => {
  it('opens an inline form with the defaults and the configured models', async () => {
    const { user } = show()
    expect(screen.queryByRole('radio')).toBeNull()
    await open(user)
    expect(screen.getByRole('radio', { name: 'Development run' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Quick check' })).not.toBeChecked()
    // The official run is never started from here (D-091), and the form says why.
    expect(screen.queryByRole('radio', { name: 'Official run' })).toBeNull()
    expect(screen.getByText(KINDS_NOTE)).toBeVisible()
    expect(KINDS_NOTE).toMatch(/2029 to 2034/)
    expect(screen.getByRole('checkbox', { name: '2026' })).toBeChecked()
    for (const seed of ['2027', '2028']) {
      expect(screen.getByRole('checkbox', { name: seed })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: seed })).toBeDisabled()
    }
    expect(screen.getByText('World 2026 only')).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: 'Repeats' })).toHaveValue(1)
    expect(screen.getByRole('radio', { name: 'Whole bank' })).toBeChecked()
    expect(await within(form()).findByText('bank-v7')).toBeVisible()
    expect(within(form()).getByText('qwen3:8b')).toBeVisible()
    expect(within(form()).getByText('judge-model')).toBeVisible()
    expect(within(form()).getAllByText(/Set in configuration/)).toHaveLength(2)
  })

  it('greys out Start a run on the public site and says why', async () => {
    show({ site: 'public' })
    expect(screen.getByText(PUBLIC_RUNS_OFF)).toBeVisible()
    const button = screen.getByRole('button', { name: 'Start a run' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(PUBLIC_RUNS_OFF)
    expect(PUBLIC_RUNS_OFF).toBe('Runs cannot be started on the public site.')
  })

  it('greys out Start a run until the server has said whether this is the public site', () => {
    show({ site: 'checking' })
    expect(screen.getByRole('button', { name: 'Start a run' })).toBeDisabled()
    expect(screen.queryByText(PUBLIC_RUNS_OFF)).toBeNull()
  })

  it('opens from a button, which gives way to the form, and puts focus in the form', async () => {
    const { user } = show()
    const button = screen.getByRole('button', { name: 'Start a run' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(screen.queryByRole('button', { name: 'Start a run' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Development run' })).toHaveFocus()
  })

  it('closes with Escape or Close and brings the button back with focus', async () => {
    const { user } = show()
    await open(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start a run' })).toHaveFocus()
    await open(user)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start a run' })).toHaveFocus()
  })

  it('moves focus to Cancel once the run has started', async () => {
    stubApi(ROUTES)
    function Starting() {
      const [job, setJob] = useState<Job | null>(null)
      return (
        <Harness
          job={job}
          error={null}
          start={async () => setJob(job_({}))}
          cancel={async () => undefined}
        />
      )
    }
    const job_ = job
    render(<Starting />)
    const user = userEvent.setup()
    await open(user)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('shows a 422 at the field it names and the rest as a form message', async () => {
    const { user, start } = show()
    start.mockRejectedValueOnce(
      new ApiError(
        'VALIDATION_ERROR',
        "unknown strata ['H9']; unknown seeds [2029]; kind: Input should be 'smoke' or 'official'",
        false,
        422,
      ),
    )
    await open(user)
    await user.click(screen.getByRole('radio', { name: 'Chosen kinds' }))
    await user.click(screen.getByRole('checkbox', { name: /Multi-hop/ }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    const worlds = screen.getByRole('group', { name: 'Worlds' })
    expect(within(worlds).getByText(/unknown seeds \[2029\]/)).toBeVisible()
    const kinds = screen.getByRole('group', { name: 'Kinds of question' })
    expect(within(kinds).getByText(/unknown strata \['H9'\]/)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('kind: Input should be')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    // Editing the form clears what the server said about it.
    await user.click(screen.getByRole('checkbox', { name: '2026' }))
    expect(within(worlds).queryByText(/unknown seeds/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('frees the other seen worlds for a quick check and keeps Repeats the reader typed', async () => {
    const { user } = show()
    await open(user)
    const repeats = screen.getByRole('spinbutton', { name: 'Repeats' })
    await user.clear(repeats)
    await user.type(repeats, '2')
    await user.click(screen.getByRole('radio', { name: 'Quick check' }))
    expect(repeats).toHaveValue(2)
    expect(screen.getByRole('checkbox', { name: '2027' })).toBeEnabled()
    expect(screen.queryByText('World 2026 only')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: '2027' }))
    await user.click(screen.getByRole('radio', { name: 'Development run' }))
    expect(screen.getByRole('checkbox', { name: '2027' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '2027' })).toBeDisabled()
  })

  it('offers the kinds of question only under Chosen kinds, and needs one', async () => {
    const { user, start } = show()
    await open(user)
    const multi = screen.getByRole('checkbox', { name: /Multi-hop/ })
    expect(multi).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Whole bank' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Chosen kinds' }))
    expect(multi).toBeEnabled()
    expect(screen.getByText('Choose at least one kind.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    await user.click(multi)
    expect(screen.queryByText('Choose at least one kind.')).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Whole bank' }))
    expect(multi).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ strata: null }),
    )
  })

  it('says when no judge is configured and when the bank version is not known', async () => {
    const { user } = show({}, { '/api/v1/models': { ...MODELS, judge: null } })
    await open(user)
    expect(await within(form()).findByText('None configured')).toBeVisible()
    expect(within(form()).getByText('Not known')).toBeVisible()
  })

  it('needs at least one repeat', async () => {
    const { user, start } = show()
    await open(user)
    const repeats = screen.getByRole('spinbutton', { name: 'Repeats' })
    await user.clear(repeats)
    await user.type(repeats, '0')
    expect(screen.getByText('Use a whole number, at least 1.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(start).not.toHaveBeenCalled()
  })

  it('starts the run the form describes', async () => {
    const { user, start } = show()
    await open(user)
    await user.click(screen.getByRole('radio', { name: 'Quick check' }))
    await user.click(screen.getByRole('checkbox', { name: '2028' }))
    await user.click(screen.getByRole('radio', { name: 'Chosen kinds' }))
    await user.click(screen.getByRole('checkbox', { name: /Multi-hop/ }))
    await user.type(
      screen.getByRole('spinbutton', { name: 'At most N per question' }),
      '2',
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(start).toHaveBeenCalledExactlyOnceWith({
      kind: 'smoke',
      seeds: [2026, 2028],
      repeats: 1,
      strata: ['H1'],
      limit: 2,
    })
  })

  it('conflict shows the server message with retry', async () => {
    const { user, start } = show()
    start.mockRejectedValueOnce(
      new ApiError('CONFLICT', 'A live run is using the graph.', false, 409),
    )
    await open(user)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A live run is using the graph.',
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(start).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a validation or configuration message without a retry', async () => {
    const { user, start } = show()
    start.mockRejectedValueOnce(
      new ApiError(
        'CONFIGURATION_ERROR',
        'The judge is not set up.',
        false,
        503,
      ),
    )
    await open(user)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The judge is not set up.',
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows the progress of a running job with a cancel button', () => {
    show({ job: job({}) })
    expect(
      screen.getByText('World 2027 (2 of 3): 12 of 40 questions'),
    ).toBeVisible()
    expect(
      screen.getByRole('progressbar', { name: 'Run progress' }),
    ).toHaveAttribute('aria-valuenow', '43')
    expect(screen.queryByRole('button', { name: 'Start a run' })).toBeNull()
  })

  it('cancel shows the cooperative stop line', async () => {
    const { user, cancel } = show({ job: job({}) })
    expect(
      screen.getByText('Cancelling stops after the current question.'),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('says a cancelled job wrote no results', () => {
    show({ job: job({ status: 'cancelled' }) })
    expect(
      screen.getByText('Cancelled. No results were written.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start a run' })).toBeVisible()
  })

  it('shows what a cancelled job kept, below its own words', () => {
    show({
      job: job({
        status: 'cancelled',
        error: {
          error_code: 'CANCELLED',
          message: 'The run was cancelled. 1 finished world was kept.',
          retryable: true,
        },
      }),
    })
    expect(
      screen.getByText('Cancelled. No results were written.'),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The run was cancelled. 1 finished world was kept.',
    )
  })

  it('shows no alert for a cancelled job without an error', () => {
    show({ job: job({ status: 'cancelled' }) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the message of a failed job', () => {
    show({
      job: job({
        status: 'failed',
        error: {
          error_code: 'RUN_ERROR',
          message: 'The model server stopped answering.',
          retryable: true,
        },
      }),
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The model server stopped answering.',
    )
  })

  it('shows an error from following the job', () => {
    show({ job: job({}), error: new Error('The server did not answer.') })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The server did not answer.',
    )
  })
})
