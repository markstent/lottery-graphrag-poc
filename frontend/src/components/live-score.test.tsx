import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LiveScoreNote } from './live-score'

describe('LiveScoreNote', () => {
  it('says a score still pending in plain words', () => {
    render(
      <LiveScoreNote answerKey="available" status="pending" score={null} />,
    )
    expect(screen.getByText('Score pending.')).toBeVisible()
  })

  it('says a failed scoring in plain words', () => {
    render(<LiveScoreNote answerKey="available" status="failed" score={null} />)
    expect(screen.getByText('Scoring failed.')).toBeVisible()
  })

  it('says a scoring a server stop cut off was interrupted', () => {
    render(
      <LiveScoreNote
        answerKey="available"
        status="failed"
        failure="interrupted"
        score={null}
      />,
    )
    expect(screen.getByText('Scoring was interrupted.')).toBeVisible()
    expect(screen.queryByText('Scoring failed.')).not.toBeInTheDocument()
  })

  it('says an ad hoc question has no answer key', () => {
    render(
      <LiveScoreNote answerKey="none" status="not_applicable" score={null} />,
    )
    expect(screen.getByText('No answer key.')).toBeVisible()
  })
})
