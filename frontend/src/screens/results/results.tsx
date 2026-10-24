/**
 * Results: pick a published run, read its verdict, then its scores per kind of
 * question. `#/results?run=<id>` names the run; none opens the newest result.
 */

import { getBenchmark, listBenchmarks, type Schemas } from '../../api/client'
import { useRoute } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { defaultRun, standing } from '../../results/runs'
import { Screen } from '../screen'
import { RunPicker } from './run-picker'
import { StrataCharts } from './strata-charts'
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
  return (
    <>
      <Panel
        title="Verdict"
        state={load.status}
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      >
        {ready && <Verdict run={run} summary={load.data.summary} kind={kind} />}
      </Panel>
      {ready && kind !== 'quick-check' && (
        <Panel title="Scores by kind of question" state="ready">
          <StrataCharts summary={load.data.summary} />
        </Panel>
      )}
    </>
  )
}

export function Results() {
  const requested = useRoute().params.get('run')
  const load = useLoad(listBenchmarks, 'benchmark-runs')
  const runs =
    load.status === 'ready'
      ? [...load.data].sort(
          (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
        )
      : []
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
