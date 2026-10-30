/**
 * One pipeline's answer as the model wrote it, with each citation marker such
 * as [1] a button that opens the passage or record it cites. A marker the
 * results hold no citation for stays plain text. A long answer scrolls inside
 * its card, which is capped in height, so one long answer does not stretch the
 * row (D-096); an answer that stops before the model finished it says so under
 * the text.
 */

import { Fragment } from 'react'

import type { Schemas } from '../../api/client'
import { cutOffNote } from '../../app/cut-off'
import { ScrollBox } from '../../components/scroll-box'
import { pipeline, type PipelineId } from '../../design/pipelines'
import { recordTitle } from './record-title'

/** A bracketed list of numbers: "[1]" or "[1, 2]". */
const MARKERS = /\[(\d+(?:\s*,\s*\d+)*)\]/g

export function AnswerBlock({
  id,
  results,
  onOpen,
}: {
  id: PipelineId
  results: Schemas['QueryResults']
  onOpen: (pipeline: PipelineId, recordId: string) => void
}) {
  const { label, tint, strong } = pipeline(id)
  const answer = results.results?.[id]?.answer
  const note = answer ? cutOffNote(answer) : null
  const parts: (string | { n: number; text: string })[] = []
  if (answer) {
    let last = 0
    for (const match of answer.text.matchAll(MARKERS)) {
      parts.push(answer.text.slice(last, match.index))
      for (const n of match[1].split(',').map(Number))
        parts.push({ n, text: `[${n}]` })
      last = match.index + match[0].length
    }
    parts.push(answer.text.slice(last))
  }
  return (
    <section
      aria-label={`${label} answer`}
      className="min-w-0 overflow-hidden rounded-card border border-hairline bg-surface"
    >
      <h3
        className="px-4 py-2 text-base font-semibold"
        style={{ backgroundColor: tint, color: strong }}
      >
        {label}
      </h3>
      <ScrollBox label={`${label} answer text`} axis="y" className="max-h-96">
        <p className="p-4 leading-relaxed whitespace-pre-line text-text-primary">
          {answer
            ? parts.map((part, index) => {
                if (typeof part === 'string')
                  return <Fragment key={index}>{part}</Fragment>
                const citation = answer.citations[part.n - 1]
                if (!citation)
                  return <Fragment key={index}>{part.text}</Fragment>
                const title = recordTitle(results, id, citation.chunk_id)
                return (
                  <button
                    key={index}
                    type="button"
                    aria-label={`Open source ${part.n}${title ? `: ${title}` : ''}`}
                    title={title ?? citation.title}
                    onClick={() => onOpen(id, citation.chunk_id)}
                    className="mx-0.5 rounded-chip border border-border bg-surface px-1.5 font-medium text-text-primary hover:bg-surface-raised"
                  >
                    {part.text}
                  </button>
                )
              })
            : 'No answer was recorded.'}
        </p>
      </ScrollBox>
      {note && (
        <p className="border-t border-hairline px-4 py-2 text-sm text-text-secondary">
          {note}
        </p>
      )}
    </section>
  )
}
