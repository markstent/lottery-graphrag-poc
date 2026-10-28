/**
 * Live Lab: one question through all three approaches, side by side. The
 * columns, the timeline and the status line all read the one run state, from
 * a recorded run or a live one.
 */

import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  getBenchmarkQuestions,
  getDemoQuestions,
  listDatasets,
  type Schemas,
} from '../../api/client'
import { useRegisterReplay } from '../../app/presentation'
import { useRoute } from '../../app/router'
import { useSettings } from '../../app/use-settings'
import { useLoad, type Load } from '../../app/use-load'
import {
  EvidenceDrawer,
  type EvidenceSource,
} from '../../components/evidence-drawer'
import { Notice } from '../../components/panel'
import { PIPELINES, type PipelineId } from '../../design/pipelines'
import { RECORDED_INDEX } from '../../run/recorded'
import { Screen } from '../screen'
import { AnswerBlock } from './answer-block'
import { CanvasArea, CanvasPlaceholder, type FoldedGroup } from './canvas-area'
import { runStatusLine } from './columns'
import { CoverageMatrix } from './coverage-matrix'
import {
  otherWorldNotice,
  pathPosition,
  sourceFor,
  type PathPosition,
} from './evidence-open'
import { PathStrip } from './path-strip'
import { PipelineColumn } from './pipeline-column'
import { recordTitle } from './record-title'
import { QuestionBar } from './question-bar'
import { Scorecard } from './scorecard'
import { Timeline } from './timeline'
import { useLiveRun } from './use-live-run'

const NOT_LOADED = 'This question is not in the loaded world.'

/**
 * The saved questions, plus the one a link names when it is in the loaded
 * world's bank but not among the saved ones. The bank is read only then.
 */
function useLinkedQuestions(linkedId: string | null) {
  const saved = useLoad(getDemoQuestions, 'live-lab-questions')
  const needsBank =
    linkedId !== null &&
    saved.status === 'ready' &&
    !saved.data.some((q) => q.instance_id === linkedId) &&
    !RECORDED_INDEX.some((r) => r.instance_id === linkedId)
  const bank = useLoad(
    (signal) =>
      needsBank
        ? getBenchmarkQuestions(undefined, signal)
        : Promise.resolve([]),
    `live-lab-bank:${needsBank}`,
  )
  const found =
    bank.status === 'ready'
      ? bank.data.find((q) => q.instance_id === linkedId)
      : undefined
  // A bank question runs with its own text and no market scope, as the API requires.
  const linked: Schemas['DemoQuestion'] | null = found
    ? {
        instance_id: found.instance_id,
        question_id: found.question_id,
        text: found.text,
        stratum: found.stratum,
        market_scope: [],
      }
    : null
  const questions: Load<Schemas['DemoQuestion'][]> =
    saved.status === 'ready' && linked
      ? { ...saved, data: [...saved.data, linked] }
      : saved
  return {
    questions,
    missing: needsBank && bank.status === 'ready' && !linked,
    bankError: needsBank && bank.status === 'error' ? bank : null,
  }
}

interface Opened {
  /** Set when the drawer shows a folded group, which the canvas keeps current. */
  group?: { pipeline: 'B' | 'C'; id: string }
  source: EvidenceSource
  position: PathPosition | null
}

export function LiveLab() {
  const { reducedMotion } = useSettings()
  const linkedId = useRoute().params.get('question')
  const { questions, missing, bankError } = useLinkedQuestions(linkedId)
  const run = useLiveRun({ reducedMotion })
  useRegisterReplay(run.keys)

  // A link from Overview opens the question's recording, once.
  const opened = useRef<string | null>(null)
  const { start } = run
  useEffect(() => {
    if (
      linkedId === null ||
      opened.current === linkedId ||
      !RECORDED_INDEX.some((r) => r.instance_id === linkedId)
    )
      return
    opened.current = linkedId
    start({ source: 'recorded', instanceId: linkedId })
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
    const notice =
      source.kind === 'record' || source.kind === 'node'
        ? otherWorldNotice(run.recordedDataset, datasetId)
        : null
    if (notice !== null) {
      setInDrawer({
        source: { kind: 'unavailable', message: notice },
        position: null,
      })
      return
    }
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
      group: { pipeline, id: group.id },
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
        collapsed={run.phase !== 'idle'}
        runStatus={runStatusLine(run)}
        busy={run.busy}
        canCancel={run.source === 'live' && run.phase === 'running'}
        cancelling={run.cancelling}
        onRun={run.start}
        onCancel={run.cancel}
      />
      {missing && (
        <p role="status" className="text-sm text-text-primary">
          {NOT_LOADED}
        </p>
      )}
      {bankError && (
        <p role="alert" className="text-sm text-text-primary">
          {bankError.error.message}{' '}
          <button type="button" onClick={bankError.retry} className="underline">
            Retry
          </button>
        </p>
      )}
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
      {run.phase === 'idle' && (
        <p role="status" className="text-sm text-text-secondary">
          {error !== null ? 'The run did not start.' : runStatusLine(run)}
        </p>
      )}
      {stored !== null && state.status === 'completed' && (
        <Scorecard
          results={stored}
          // A live run is of the current method, which compares recall (D-087).
          metric={run.oldMethod ? 'evidence_f1' : 'evidence_recall'}
        />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
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
            openGroup={inDrawer?.group ?? null}
            onCloseGroup={() => setInDrawer(null)}
          />
        ) : (
          <CanvasPlaceholder />
        )}
        <div className="relative min-w-0">
          <div className="flex flex-col gap-2 md:absolute md:inset-0">
            {PIPELINES.map(({ id }) => (
              <PipelineColumn
                key={id}
                id={id}
                run={state}
                results={results}
                canOpen={(recordId) => sourceOf(id, recordId) !== null}
                onOpen={(recordId) => open(id, recordId)}
                oldMethod={run.oldMethod}
              />
            ))}
          </div>
        </div>
      </div>
      <Timeline
        state={state}
        oldMethod={run.oldMethod}
        originMs={run.originMs}
        timeline={run.timeline}
        controls={run.controls}
      />
      {stored !== null && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PIPELINES.map(({ id }) => (
              <AnswerBlock key={id} id={id} results={stored} onOpen={open} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
