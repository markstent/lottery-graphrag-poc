import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failure, json, stubApi } from '../../test/api-stub'
import { OFFICIAL } from './help.fixtures'
import { HelpOutcomes } from './outcomes'

/** The newest run as `GET /benchmarks/latest` serves it: a whole-bank official run. */
const NEWEST = { ...OFFICIAL, run_id: 'newest' }

const OUTCOMES = {
  recorded: true,
  evidence: {
    A: {
      repeats: 3,
      found: 3,
      missed: 4,
      found_share: 0.4201,
      extra_per_question: 16,
    },
  },
  answers: {
    A: {
      scored: 10,
      right: 4,
      partly: 3,
      wrong: 3,
      right_declined: 1,
      partly_declined: 1,
      wrong_declined: 2,
      not_scored: 0,
      partly_score_sum: 1,
    },
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HelpOutcomes', () => {
  it('shows loading, then the newest run outcomes', async () => {
    stubApi({
      '/api/v1/benchmarks/latest': NEWEST,
      '/api/v1/benchmarks/newest/outcomes': OUTCOMES,
    })
    render(<HelpOutcomes />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByText('Evidence found')).toBeInTheDocument()
    expect(screen.getByText('Answers by score')).toBeInTheDocument()
  })

  it('says so when no run is published', async () => {
    stubApi({
      '/api/v1/benchmarks/latest': () => failure('none', false, 404),
    })
    render(<HelpOutcomes />)
    expect(
      await screen.findByText('No official run is published yet.'),
    ).toBeInTheDocument()
  })

  it('shows no outcomes when the newest run is not a full official run', async () => {
    const fetchMock = stubApi({
      '/api/v1/benchmarks/latest': {
        ...NEWEST,
        run_kind: 'dev',
        label: 'Development run',
      },
      '/api/v1/benchmarks/newest/outcomes': OUTCOMES,
    })
    render(<HelpOutcomes />)
    expect(
      await screen.findByText('No official run is published yet.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Evidence found')).toBeNull()
    expect(
      fetchMock.mock.calls.map(([input]) => String(input)),
    ).not.toContainEqual(expect.stringContaining('/outcomes'))
  })

  it('shows an error with Retry, and retries', async () => {
    const user = userEvent.setup()
    let calls = 0
    stubApi({
      '/api/v1/benchmarks/latest': NEWEST,
      '/api/v1/benchmarks/newest/outcomes': () =>
        ++calls === 1
          ? failure('The outcomes could not be read.', true)
          : json(OUTCOMES),
    })
    render(<HelpOutcomes />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be read',
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Evidence found')).toBeInTheDocument()
  })
})
