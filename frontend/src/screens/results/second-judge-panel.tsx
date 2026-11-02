/**
 * A second model's judgement of the run's stored answers, when the run has one
 * (D-100), and the two judges' combined mark beside it (D-105).
 */

import { getSecondJudge, type Schemas } from '../../api/client'
import { ApiError } from '../../api/http'
import { useLoad } from '../../app/use-load'
import { DataTable, type DataTableRow } from '../../charts/data-table'
import { Panel } from '../../components/panel'
import { JUDGES } from '../../results/judges'
import { TABLE_HEADS } from '../../results/labels'
import {
  answerScoreRows,
  eachOtherRows,
  judgeModels,
  labelRows,
  SECOND_JUDGE,
} from '../../results/second-judge'
import { JudgesVerdict } from './judges-panel'
import { RunBadge } from './run-badge'

const COLUMNS = [
  TABLE_HEADS.pairs,
  TABLE_HEADS.agreement,
  TABLE_HEADS.weightedKappa,
] as const

function Table({
  title,
  rows,
}: {
  title: string
  rows: readonly DataTableRow[]
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <DataTable
        caption={title}
        rowHeader={TABLE_HEADS.group}
        columns={COLUMNS}
        rows={rows}
      />
    </div>
  )
}

export function SecondJudgeTables({
  data,
  badge,
}: {
  data: Schemas['SecondJudgeOut']
  badge?: string
}) {
  const labelled = labelRows(data)
  return (
    <div className="space-y-4">
      <RunBadge label={badge} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {judgeModels(data).map(([judge, model]) => (
          <div key={judge} className="contents">
            <dt className="text-text-secondary">{judge}</dt>
            <dd className="text-text-primary">{model}</dd>
          </div>
        ))}
      </dl>
      <Table title={SECOND_JUDGE.answerScore} rows={answerScoreRows(data)} />
      <Table title={SECOND_JUDGE.eachOther} rows={eachOtherRows(data)} />
      {labelled && <Table title={SECOND_JUDGE.labels} rows={labelled} />}
    </div>
  )
}

/**
 * The Judges' verdict and Second judge panels, shown while they load, on an
 * error and with data; a run without a second judge (404) shows neither, and
 * one whose combined mark is not worked out shows the verdict panel empty.
 */
export function SecondJudgePanel({
  runId,
  badge,
}: {
  runId: string
  badge?: string
}) {
  const load = useLoad(
    (signal) => getSecondJudge(runId, signal),
    `second-judge:${runId}`,
  )
  if (
    load.status === 'error' &&
    load.error instanceof ApiError &&
    load.error.status === 404
  )
    return null
  const error = load.status === 'error' ? load.error : undefined
  const combined = load.status === 'ready' ? load.data.combined : undefined
  return (
    <>
      <Panel
        title={JUDGES.title}
        purpose={JUDGES.note}
        state={load.status === 'ready' && !combined ? 'empty' : load.status}
        message={JUDGES.none}
        error={error}
        onRetry={load.retry}
      >
        {combined && <JudgesVerdict combined={combined} badge={badge} />}
      </Panel>
      <Panel
        title={SECOND_JUDGE.title}
        purpose={SECOND_JUDGE.note}
        state={load.status}
        error={error}
        onRetry={load.retry}
      >
        {load.status === 'ready' && (
          <SecondJudgeTables data={load.data} badge={badge} />
        )}
      </Panel>
    </>
  )
}
