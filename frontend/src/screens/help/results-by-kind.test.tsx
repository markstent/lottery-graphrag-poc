import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failure, json, stubApi } from '../../test/api-stub'
import { OFFICIAL, SMOKE } from './help.fixtures'
import { HelpResultsByKind } from './results-by-kind'

const LATEST = '/api/v1/benchmarks/latest'
const JUDGES = '/api/v1/benchmarks/official/second-judge'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HelpResultsByKind', () => {
  it("shows loading, then the newest official run's answer score by kind of question, as Overview draws it", async () => {
    stubApi({ [LATEST]: OFFICIAL })
    render(<HelpResultsByKind />)
    expect(screen.getByRole('status')).toHaveTextContent(
      "Loading the newest run's scores by kind of question.",
    )
    const chart = await screen.findByRole('img', {
      name: 'Answer score by kind of question',
    })
    expect(within(chart).getByText('Single facts')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Evidence found' }),
    )
    const evidence = await screen.findByRole('img', {
      name: 'Evidence found by kind of question',
    })
    expect(
      within(evidence).getByText('Local-language names (not tested)'),
    ).toBeInTheDocument()
  })

  it("adds the judges' mark when the run has it worked out", async () => {
    stubApi({
      [LATEST]: OFFICIAL,
      [JUDGES]: {
        combined: {
          metrics: {
            overall: { A: { mean: 0.5 }, B: { mean: 0.5 }, C: { mean: 0.6 } },
            H1: { A: { mean: 0.4 }, B: { mean: 0.6 }, C: { mean: 0.7 } },
          },
          comparisons: [],
        },
      },
    })
    render(<HelpResultsByKind />)
    await userEvent.click(
      await screen.findByRole('button', { name: "Judges' mark" }),
    )
    const chart = await screen.findByRole('img', {
      name: "Judges' mark by kind of question",
    })
    expect(within(chart).getByText('70')).toBeInTheDocument()
  })

  it('says so when no official run is published', async () => {
    stubApi({ [LATEST]: () => failure('none', false, 404) })
    render(<HelpResultsByKind />)
    expect(
      await screen.findByText('No official run is published yet.'),
    ).toBeInTheDocument()
    cleanup()
    stubApi({ [LATEST]: SMOKE })
    render(<HelpResultsByKind />)
    expect(
      await screen.findByText('No official run is published yet.'),
    ).toBeInTheDocument()
  })

  it('shows an error with Retry, and retries', async () => {
    let calls = 0
    stubApi({
      [LATEST]: () =>
        ++calls === 1
          ? failure('The latest run is unavailable.', true)
          : json(OFFICIAL),
    })
    render(<HelpResultsByKind />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest run is unavailable.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('img', {
        name: 'Answer score by kind of question',
      }),
    ).toBeInTheDocument()
  })
})
