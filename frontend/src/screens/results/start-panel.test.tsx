import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { ApiError } from '../../api/http'
import { MODELS, stubApi } from '../../test/api-stub'
import { StartPanel } from './start-panel'

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

function show(
  props: Partial<Parameters<typeof StartPanel>[0]> = {},
  routes: Record<string, unknown> = ROUTES,
) {
  stubApi(routes)
  const start = vi.fn().mockResolvedValue(undefined)
  const cancel = vi.fn().mockResolvedValue(undefined)
  render(
    <StartPanel
      job={null}
      error={null}
      start={start}
      cancel={cancel}
      {...props}
    />,
  )
  return { start, cancel, user: userEvent.setup() }
}

const form = () => screen.getByRole('region', { name: 'Run a benchmark' })
const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Start a run' }))

afterEach(() => vi.unstubAllGlobals())

describe('StartPanel', () => {
  it('opens an inline form with the defaults and the configured models', async () => {
    const { user } = show()
    expect(screen.queryByRole('radio')).toBeNull()
    await open(user)
    expect(screen.getByRole('radio', { name: 'Official run' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Quick check' })).not.toBeChecked()
    for (const seed of ['2026', '2027', '2028'])
      expect(screen.getByRole('checkbox', { name: seed })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Repeats' })).toHaveValue(3)
    expect(screen.getByRole('radio', { name: 'Whole bank' })).toBeChecked()
    expect(await within(form()).findByText('bank-v7')).toBeVisible()
    expect(within(form()).getByText('qwen3:8b')).toBeVisible()
    expect(within(form()).getByText('judge-model')).toBeVisible()
    expect(within(form()).getAllByText(/Set in configuration/)).toHaveLength(2)
  })

  it('says when no judge is configured and when the bank version is not known', async () => {
    const { user } = show({}, { '/api/v1/models': { ...MODELS, judge: null } })
    await open(user)
    expect(await within(form()).findByText('None configured')).toBeVisible()
    expect(within(form()).getByText('Not known')).toBeVisible()
  })

  it('official run needs three repeats', async () => {
    const { user, start } = show()
    await open(user)
    const repeats = screen.getByRole('spinbutton', { name: 'Repeats' })
    await user.clear(repeats)
    await user.type(repeats, '2')
    expect(screen.getByText('Use a whole number, at least 3.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Quick check' }))
    expect(screen.queryByText(/at least 3/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(start).not.toHaveBeenCalled()
  })

  it('starts the run the form describes', async () => {
    const { user, start } = show()
    await open(user)
    await user.click(screen.getByRole('radio', { name: 'Quick check' }))
    await user.click(screen.getByRole('checkbox', { name: '2027' }))
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
