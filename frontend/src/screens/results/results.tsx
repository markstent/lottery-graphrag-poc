/**
 * Results: pick a published run, read its verdict, then its scores per kind of
 * question. `#/results?run=<id>` names the run; none opens the newest result.
 */

import { useRef, useState } from 'react'

import { getBenchmark, listBenchmarks, type Schemas } from '../../api/client'
import { evidenceMetric } from '../../app/method'
import { hrefFor, useRoute } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { filterFromParams, paramsWithFilter } from '../../results/questions'
import { defaultRun, standing, standingWord } from '../../results/runs'
import { groundednessRows } from '../../results/strata'
import { Screen } from '../screen'
import { EfficiencyPanel } from './efficiency-panel'
import { FailurePanel } from './failure-panel'
import { GroundednessPanel } from './groundedness-panel'
import { JudgePanel } from './judge-panel'
import { QuestionsPanel } from './question-table'
import { ReproPanel } from './repro-panel'
import { RunPicker } from './run-picker'
import { StartArea, StartButton } from './start-panel'
import { StrataCharts } from './strata-charts'
import { useBenchmarkJob } from './use-benchmark-job'
import { Verdict } from './verdict'

type Run = Schemas['BenchmarkRunOut']

const NOT_PUBLISHED = new Error('This run is not published.')

function RunView({ run }: { run: Run }) {
  const load = useLoad(
    (signal) => getBenchmark(run.run_id, signal),
    `run:${run.run_id}`,
  )
  const kind = standing(run)
  const ready = load.status === 'ready'
  const grounded = ready ? groundednessRows(load.data.summary) : null
  const badge = kind === 'subset' ? standingWord(run) : undefined
  const { params } = useRoute()
  const tableRef = useRef<HTMLDivElement>(null)
  const filterBy = (pipeline: string, cls: string) => {
    window.location.hash = hrefFor(
      'results',
      paramsWithFilter(params, {
        ...filterFromParams(params),
        failure: { pipeline, cls },
      }),
    )
    tableRef.current?.focus()
  }
  return (
    <>
      <Panel
        title="Verdict"
        state={load.status}
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      >
        {ready && (
          <Verdict
            run={run}
            summary={load.data.summary}
            method={load.data.method_version}
            kind={kind}
          />
        )}
      </Panel>
      {ready && kind !== 'quick-check' && (
        <>
          <Panel title="Scores by kind of question" state="ready">
            <StrataCharts
              summary={load.data.summary}
              evidence={evidenceMetric(load.data.method_version)}
              badge={badge}
            />
          </Panel>
          <QuestionsPanel
            runId={run.run_id}
            tableRef={tableRef}
            badge={badge}
          />
          <Panel title="Efficiency" state="ready">
            <EfficiencyPanel summary={load.data.summary} badge={badge} />
          </Panel>
          <Panel title="Failures" state="ready">
            <FailurePanel
              summary={load.data.summary}
              badge={badge}
              onFilter={filterBy}
            />
          </Panel>
          <Panel
            title="Judge"
            state={load.data.summary.judge_agreement ? 'ready' : 'empty'}
            message="No judge in this run"
          >
            <JudgePanel summary={load.data.summary} badge={badge} />
          </Panel>
          {grounded && (
            <Panel title="Groundedness" state="ready">
              <GroundednessPanel rows={grounded} badge={badge} />
            </Panel>
          )}
        </>
      )}
      {ready && (
        <Panel title="Reproducibility" state="ready">
          <ReproPanel
            runId={run.run_id}
            record={load.data.summary.reproducibility}
          />
        </Panel>
      )}
    </>
  )
}

export function Results() {
  const requested = useRoute().params.get('run')
  const load = useLoad(listBenchmarks, 'benchmark-runs')
  // A finished run joins the list and is the one shown.
  const { job, error, start, cancel } = useBenchmarkJob((runId) => {
    load.retry()
    window.location.hash = hrefFor('results', { run: runId })
  })
  const runs =
    load.status === 'ready'
      ? [...load.data].sort(
          (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
        )
      : []
  const [starting, setStarting] = useState(false)
  const [returned, setReturned] = useState(false)
  const closeForm = () => {
    setReturned(true)
    setStarting(false)
  }
  const empty = load.status === 'ready' && runs.length === 0
  const id = requested ?? defaultRun(runs)
  const run = runs.find((candidate) => candidate.run_id === id)
  return (
    <Screen destination="results">
      <Panel
        title="Benchmark runs"
        state={empty ? 'empty' : load.status}
        message="No benchmark runs yet."
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
        headerAction={
          <StartButton
            job={job}
            open={starting}
            onOpen={() => {
              setReturned(false)
              setStarting(true)
            }}
            autoFocus={returned}
          />
        }
        above={
          <StartArea
            job={job}
            error={error}
            open={starting}
            onClose={closeForm}
            onStarted={() => {
              setReturned(false)
              setStarting(false)
            }}
            start={start}
            cancel={cancel}
          />
        }
      >
        {load.status === 'ready' && (
          <RunPicker runs={runs} selected={run?.run_id ?? null} />
        )}
      </Panel>
      {load.status === 'ready' && !empty && !run && (
        <Panel title="Run" state="error" error={NOT_PUBLISHED} />
      )}
      {run && <RunView key={run.run_id} run={run} />}
    </Screen>
  )
}
