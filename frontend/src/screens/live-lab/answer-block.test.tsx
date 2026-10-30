import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Schemas } from '../../api/client'
import { RECORDINGS } from '../../test/recordings'
import { AnswerBlock } from './answer-block'

type Results = Schemas['QueryResults']

const h2 = RECORDINGS.find((run) => run.stratum === 'H2')!.results

/** Results whose pipeline B answers with `text` over the first citations of H2's B. */
const answering = (text: string): Results => {
  const out = structuredClone(h2) as Results
  out.results!.B.answer.text = text
  return out
}

describe('AnswerBlock', () => {
  it('shows the answer text under the pipeline name', () => {
    render(<AnswerBlock id="B" results={h2} onOpen={vi.fn()} />)
    const block = screen.getByRole('region', { name: 'B · Graph answer' })
    expect(block).toHaveTextContent(
      h2.results!.B.answer.text.replace(/\s+/g, ' '),
    )
  })

  it('makes each [n] a button that opens that citation with its pipeline and chunk id', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <AnswerBlock
        id="B"
        results={answering('One thing [1] and another [2].')}
        onOpen={onOpen}
      />,
    )
    const block = screen.getByRole('region', { name: 'B · Graph answer' })
    const buttons = within(block).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['[1]', '[2]'])
    const citations = h2.results!.B.answer.citations
    await user.click(buttons[1])
    expect(onOpen).toHaveBeenCalledWith('B', citations[1].chunk_id)
  })

  it('opens a citation from the keyboard with Enter and with Space', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <AnswerBlock id="B" results={answering('See [1].')} onOpen={onOpen} />,
    )
    await user.tab()
    expect(
      screen.getByRole('button', { name: /\[1\]|source 1/i }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('splits a group such as [1, 2] into one button each', () => {
    render(
      <AnswerBlock
        id="B"
        results={answering('Both [1, 2] agree.')}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '[1]',
      '[2]',
    ])
  })

  it('leaves a number with no citation as plain text', () => {
    render(
      <AnswerBlock
        id="B"
        results={answering('Odd [99] marker.')}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/Odd \[99\] marker\./)).toBeVisible()
  })

  it('names the cited source in the button label from the results text', () => {
    render(
      <AnswerBlock id="B" results={answering('See [1].')} onOpen={vi.fn()} />,
    )
    const button = screen.getByRole('button', { name: /^Open source 1/ })
    expect(button).toHaveAttribute('title')
  })

  it('says no answer was recorded for a pipeline with no result', () => {
    const none = structuredClone(h2) as Results
    delete none.results!.C
    render(<AnswerBlock id="C" results={none} onOpen={vi.fn()} />)
    expect(screen.getByText('No answer was recorded.')).toBeVisible()
  })

  it('says an answer stopped at the token limit it was generated under', () => {
    const cut = answering('It began [1] and then')
    Object.assign(cut.results!.B.answer, {
      cut_off: true,
      token_limit_reached: true,
      max_tokens: 4096,
    })
    render(<AnswerBlock id="B" results={cut} onOpen={vi.fn()} />)
    const block = screen.getByRole('region', { name: 'B · Graph answer' })
    expect(
      within(block).getByText('The answer stopped at the 4,096-token limit.'),
    ).toBeVisible()
  })

  it('has no note for an answer that finished', () => {
    const done = answering('Done [1].')
    Object.assign(done.results!.B.answer, {
      cut_off: false,
      token_limit_reached: false,
      max_tokens: 4096,
    })
    render(<AnswerBlock id="B" results={done} onOpen={vi.fn()} />)
    expect(screen.queryByText(/token limit|cut short/)).toBeNull()
  })

  it('keeps a long answer inside a card of capped height that scrolls on its own', () => {
    render(
      <AnswerBlock
        id="B"
        results={answering('A long answer.')}
        onOpen={vi.fn()}
      />,
    )
    const text = screen.getByText('A long answer.')
    expect(text.parentElement).toHaveClass('max-h-96', 'overflow-y-auto')
  })
})
