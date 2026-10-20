/**
 * A live run's answer-key status in plain text (spec 10a.1): a bank
 * question's deterministic scores per pipeline, exactly as the backend
 * scored them after the run completed; or why there are none. Phase 6
 * redesigns this surface.
 */

import type { LivePipelineScore, LiveScore } from '../mock/telemetry'

const PIPELINE_ORDER = ['A', 'B', 'C'] as const

function value(metric: number | null): string {
  return metric === null ? 'not defined' : metric.toFixed(2)
}

function pipelineLine(tag: string, score: LivePipelineScore): string {
  return [
    `${tag}: answer ${value(score.answer)}`,
    `evidence F1 ${value(score.evidence_f1)}`,
    `anchor resolution ${value(score.anchor_resolution)}`,
    `failure class ${score.failure_class ?? 'none'}`,
  ].join(' · ')
}

export function LiveScoreNote({
  answerKey,
  score,
}: {
  answerKey: 'none' | 'available'
  score: LiveScore | null
}) {
  if (answerKey === 'none') {
    return (
      <p className="text-xs text-muted">
        <span className="font-medium text-primary">No answer key.</span> This
        question is not in the question bank, so it is not scored. Run a saved
        question to see it scored against the answer key.
      </p>
    )
  }
  if (score === null) {
    return (
      <p className="text-xs text-muted">
        <span className="font-medium text-warning">Not scored.</span> This bank
        question has an answer key, but the run was not scored against it.
      </p>
    )
  }
  const tags = PIPELINE_ORDER.filter((tag) => tag in score.per_pipeline)
  return (
    <section aria-label="Live score" className="text-xs text-muted">
      <p>
        <span className="font-medium text-primary">
          Question {score.instance_id}: {score.label}.
        </span>
      </p>
      <ul className="mt-1 space-y-0.5 font-mono">
        {tags.map((tag) => (
          <li key={tag}>{pipelineLine(tag, score.per_pipeline[tag])}</li>
        ))}
      </ul>
    </section>
  )
}
