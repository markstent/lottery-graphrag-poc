/**
 * Live Lab: one question through all three approaches, side by side. The
 * columns, the timeline and the status line all read the one run state, from
 * a recorded run or a live one.
 */

import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { getDemoQuestions, listDatasets } from '../../api/client'
import { useRegisterReplay } from '../../app/presentation'
import { useRoute } from '../../app/router'
import { useSettings } from '../../app/use-settings'
import { useLoad } from '../../app/use-load'
import {
  EvidenceDrawer,
  type EvidenceSource,
} from '../../components/evidence-drawer'
import { Notice } from '../../components/panel'
import { PIPELINES, type PipelineId } from '../../design/pipelines'
import { RECORDED_RUNS } from '../../run/recorded'
import { Screen } from '../screen'
import { AnswerBlock } from './answer-block'
import { CanvasArea, type FoldedGroup } from './canvas-area'
import { runStatusLine } from './columns'
import { CoverageMatrix } from './coverage-matrix'
import { pathPosition, sourceFor, type PathPosition } from './evidence-open'
import { PathStrip } from './path-strip'
import { PipelineColumn } from './pipeline-column'
import { recordTitle } from './record-title'
import { QuestionBar } from './question-bar'
import { Scorecard } from './scorecard'
import { Timeline } from './timeline'
import { useLiveRun } from './use-live-run'

interface Opened {
  source: EvidenceSource
  position: PathPosition | null
}

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

  // The evidence drawer: one for every opener on the screen.
  const datasets = useLoad(listDatasets, 'live-lab-datasets')
  const datasetId =
    datasets.status === 'ready'
      ? (datasets.data.find((d) => d.active)?.dataset_id ?? null)
      : null
  const [inDrawer, setInDrawer] = useState<Opened | null>(null)
  const { results, state } = run
  const sourceOf = (pipeline: PipelineId, id: string): EvidenceSource | null =>
    sourceFor(results, pipeline, id, datasetId) ??
    (pipeline !== 'A' && state.graph[pipeline].nodes.some((n) => n.id === id)
      ? { kind: 'node', nodeId: id }
      : null)
  const open = (
    pipeline: PipelineId,
    id: string,
    source = sourceOf(pipeline, id),
  ) => {
    if (source === null) return
    const recorded =
      pipeline !== 'A' && state.graph[pipeline].evidencePath !== null
    setInDrawer({
      source,
      position: pathPosition(results, pipeline, id, recorded),
    })
  }
  const openNode = (pipeline: 'B' | 'C', nodeId: string) =>
    open(pipeline, nodeId, { kind: 'node', nodeId })

  const openGroup = (pipeline: 'B' | 'C', group: FoldedGroup) =>
    setInDrawer({
      source: {
        kind: 'group',
        title: group.title,
        members: group.members.map((m) => ({
          id: m.id,
          label: m.label,
          title: recordTitle(results, pipeline, m.id),
        })),
      },
      position: null,
    })

  const { error } = run
  // What each approach found is shown once the run has ended.
  const ended = ['completed', 'failed', 'cancelled'].includes(state.status)
  const stored = ended ? results : null
  return (
    <Screen destination="live-lab">
      <QuestionBar
        questions={questions}
        linkedId={linkedId}
        busy={run.busy}
        canCancel={run.source === 'live' && run.phase === 'running'}
        cancelling={run.cancelling}
        onRun={run.start}
        onCancel={run.cancel}
      />
      {error !== null && (
        <div
          role="alert"
          className="rounded-card border border-border bg-surface p-3"
        >
          <Notice icon={<TriangleAlert size={16} className="text-error" />}>
            <p className="text-text-primary">{error.message}</p>
            {error.retry !== null && (
              <button
                type="button"
                onClick={error.retry}
                className="rounded-chip border border-border px-3 py-1 text-text-primary hover:bg-surface-raised"
              >
                Retry
              </button>
            )}
          </Notice>
        </div>
      )}
      <p role="status" className="text-sm text-text-secondary">
        {runStatusLine(run)}
      </p>
      {stored !== null && state.status === 'completed' && (
        <Scorecard results={stored} />
      )}
      <div className="grid grid-cols-[3fr_2fr] gap-4">
        {/* Canvas first, as it is on screen; the three panels follow it. */}
        {run.phase !== 'idle' ? (
          <CanvasArea
            state={state}
            finalState={run.finalState}
            results={results}
            mode={run.source === 'recorded' ? 'replay' : 'live'}
            settled={
              run.phase === 'finished' &&
              (!run.timeline.replaying ||
                run.timeline.cursor >= run.timeline.duration)
            }
            onOpenNode={openNode}
            onOpenGroup={openGroup}
          />
        ) : (
          <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-text-muted">
            The graph appears when a run starts.
          </p>
        )}
        <div className="relative min-w-0">
          <div className="absolute inset-0 flex flex-col gap-2">
            {PIPELINES.map(({ id }) => (
              <PipelineColumn
                key={id}
                id={id}
                run={state}
                results={results}
                canOpen={(recordId) => sourceOf(id, recordId) !== null}
                onOpen={(recordId) => open(id, recordId)}
              />
            ))}
          </div>
        </div>
      </div>
      <Timeline
        state={state}
        originMs={run.originMs}
        timeline={run.timeline}
        controls={run.controls}
      />
      {stored !== null && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {PIPELINES.map(({ id }) => (
              <AnswerBlock key={id} id={id} results={stored} onOpen={open} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <PathStrip
              id="B"
              state={state}
              results={stored}
              onOpen={openNode}
            />
            <PathStrip
              id="C"
              state={state}
              results={stored}
              onOpen={openNode}
            />
          </div>
          <CoverageMatrix results={stored} />
        </>
      )}
      <EvidenceDrawer
        source={inDrawer?.source ?? null}
        pathPosition={inDrawer?.position}
        onClose={() => setInDrawer(null)}
      />
    </Screen>
  )
}
