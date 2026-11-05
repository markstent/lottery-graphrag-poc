import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { V03_SECOND_JUDGE } from '../../results/results.fixtures'
import { failure, stubApi } from '../../test/api-stub'
import { SecondJudgePanel } from './second-judge-panel'

const PATH = '/api/v1/benchmarks/fixture-v03/second-judge'

afterEach(() => vi.unstubAllGlobals())

describe('SecondJudgePanel', () => {
  it('shows the two judges, how they agree, and the label check', async () => {
    stubApi({ [PATH]: V03_SECOND_JUDGE })
    render(<SecondJudgePanel runId="fixture-v03" />)
    const panel = await screen.findByRole('region', { name: 'Second judge' })
    expect(
      within(panel).getByText(
        /Descriptive, not tested. Added after the result/,
      ),
    ).toBeVisible()
    expect(
      within(panel).getByText(
        'ollama/muse-glimmer:latest, reply limit 2,048 tokens',
      ),
    ).toBeVisible()
    for (const name of [
      'With the answer score',
      'With each other',
      'With the hand labels, on a sample of answers',
    ])
      expect(within(panel).getByRole('table', { name })).toBeVisible()
    expect(
      within(panel).getByRole('rowheader', { name: 'Second judge, answered' }),
    ).toBeVisible()
  })

  it("shows the judges' verdict: each approach's mark, its own tests, how often the judges agree and where they disagree", async () => {
    stubApi({ [PATH]: V03_SECOND_JUDGE })
    render(<SecondJudgePanel runId="fixture-v03" />)
    const panel = await screen.findByRole('region', {
      name: "Judges' verdict",
    })
    const combined = V03_SECOND_JUDGE.combined!
    expect(
      within(panel).getByText(
        'Tested apart from the evidence and answer score tests.',
      ),
    ).toBeVisible()
    expect(within(panel).getByText("Judges' mark: B · Graph")).toBeVisible()
    expect(
      within(panel).getByText(
        `${Math.round(combined.metrics.overall!.B!.mean! * 100)}%`,
      ),
    ).toBeVisible()
    for (const line of new Set(combined.headlines))
      expect(within(panel).getAllByText(line)[0]).toBeVisible()
    expect(
      within(panel).getByRole('img', {
        name: "Paired differences in judges' mark",
      }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(
        `Same verdict on ${combined.counts.agreed} of ${combined.counts.both_judged} answers; opposite verdicts on ${combined.counts.disagreements}.`,
      ),
    ).toBeVisible()
    const table = within(panel).getByRole('table', { name: 'Judges disagree' })
    expect(within(table).getAllByRole('row')).toHaveLength(
      combined.counts.disagreements + 1,
    )
    const first = combined.disagreements[0]!
    const row = within(table).getAllByRole('row')[1]!
    expect(within(row).getByRole('rowheader')).toHaveTextContent(first.question)
    expect(row).toHaveTextContent(first.first === 2 ? 'correct' : 'wrong')
  })

  it("shows the judges' verdict empty when the mark is not worked out", async () => {
    stubApi({ [PATH]: { ...V03_SECOND_JUDGE, combined: null } })
    render(<SecondJudgePanel runId="fixture-v03" />)
    const panel = await screen.findByRole('region', {
      name: "Judges' verdict",
    })
    expect(within(panel).getByText('Not worked out yet.')).toBeVisible()
    expect(
      await screen.findByRole('table', { name: 'With each other' }),
    ).toBeVisible()
  })

  it('leaves out the label table when there is no label check', async () => {
    stubApi({ [PATH]: { ...V03_SECOND_JUDGE, labels: null } })
    render(<SecondJudgePanel runId="fixture-v03" />)
    const panel = await screen.findByRole('region', { name: 'Second judge' })
    await within(panel).findByRole('table', { name: 'With each other' })
    expect(
      within(panel).queryByRole('table', {
        name: 'With the hand labels, on a sample of answers',
      }),
    ).toBeNull()
  })

  it('shows a loading state while the second judge loads', () => {
    stubApi({ [PATH]: () => new Promise<Response>(() => undefined) })
    render(<SecondJudgePanel runId="fixture-v03" />)
    expect(screen.getByText('Loading Second judge')).toBeInTheDocument()
  })

  it('shows nothing for a run without a second judge', async () => {
    const fetchMock = stubApi({})
    const { container } = render(<SecondJudgePanel runId="fixture-v03" />)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows an error with a retry, and loads again', async () => {
    let calls = 0
    stubApi({
      [PATH]: () =>
        ++calls === 1
          ? failure('The second judge is unavailable.', true)
          : new Response(JSON.stringify(V03_SECOND_JUDGE), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
    })
    render(<SecondJudgePanel runId="fixture-v03" />)
    // One load feeds both panels, so both show its error.
    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(2)
    for (const alert of alerts)
      expect(alert).toHaveTextContent('The second judge is unavailable.')
    await userEvent.click(
      within(alerts[1]).getByRole('button', { name: 'Retry' }),
    )
    expect(
      await screen.findByRole('table', { name: 'With each other' }),
    ).toBeVisible()
  })
})
