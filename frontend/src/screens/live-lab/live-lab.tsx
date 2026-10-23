/**
 * Live Lab: one question through all three approaches, side by side. The
 * columns, the timeline and the status line all read the one run state, from
 * a recorded run or a live one.
 */

import { useEffect, useRef } from 'react'

import { getDemoQuestions } from '../../api/client'
import { useRegisterReplay } from '../../app/presentation'
import { useRoute } from '../../app/router'
import { useSettings } from '../../app/use-settings'
import { useLoad } from '../../app/use-load'
import { PIPELINES } from '../../design/pipelines'
import { RECORDED_RUNS } from '../../run/recorded'
import { Screen } from '../screen'
import { runStatusLine } from './columns'
import { PipelineColumn } from './pipeline-column'
import { QuestionBar } from './question-bar'
import { Timeline } from './timeline'
import { useLiveRun } from './use-live-run'

export function LiveLab() {
  const { reducedMotion } = useSettings()
  const linkedId = useRoute().params.get('question')
  const questions = useLoad(getDemoQuestions, 'live-lab-questions')
  const run = useLiveRun({ reducedMotion })
  useRegisterReplay(run.keys)

  // A link from Overview opens the question's recording, once.
  const opened = useRef<string | null>(null)
  const { start } = run
  useEffect(() => {
    const recording = RECORDED_RUNS.find((r) => r.instance_id === linkedId)
    if (!recording || opened.current === linkedId) return
    opened.current = linkedId
    start({ source: 'recorded', recording })
  }, [linkedId, start])

  const { error } = run
  return (
    <Screen destination="live-lab">
      <QuestionBar
        questions={questions}
        linkedId={linkedId}
        busy={run.phase === 'starting' || run.phase === 'running'}
        canCancel={run.source === 'live' && run.phase === 'running'}
        cancelling={run.cancelling}
        onRun={run.start}
        onCancel={run.cancel}
      />
      {error !== null && (
        <p
          role="alert"
          className="rounded-card border border-border bg-surface p-3 text-sm text-text-primary"
        >
          {error.message}{' '}
          {error.retry !== null && (
            <button type="button" onClick={error.retry} className="underline">
              Retry
            </button>
          )}
        </p>
      )}
      <p role="status" className="text-sm text-text-secondary">
        {runStatusLine(run.phase, run.source, run.state)}
      </p>
      <div className="grid grid-cols-3 gap-4">
        {PIPELINES.map(({ id }) => (
          <PipelineColumn key={id} id={id} run={run.state} />
        ))}
      </div>
      <Timeline
        state={run.state}
        originMs={run.originMs}
        timeline={run.timeline}
        controls={run.controls}
      />
    </Screen>
  )
}
