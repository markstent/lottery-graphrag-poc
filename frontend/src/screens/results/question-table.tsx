/** The per-question table: one row per question and world, filtered by the address, opened for the full scores. */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type RefObject } from 'react'

import {
  getBenchmarkInstances,
  listDatasets,
  type Schemas,
} from '../../api/client'
import { EVIDENCE_LABELS, type EvidenceMetric } from '../../app/method'
import { failureWords } from '../../app/plain-words'
import { hrefFor, useRoute } from '../../app/router'
import { evidenceScore, MISSING, percent } from '../../app/score-words'
import { useLoad } from '../../app/use-load'
import { DataTable } from '../../charts/data-table'
import { formatNumber } from '../../charts/scale'
import { PIPELINES } from '../../design/pipelines'
import { Panel } from '../../components/panel'
import {
  filterFromParams,
  filterInstances,
  liveLabLink,
  paramsWithFilter,
  stratumOf,
  type QuestionFilter,
} from '../../results/questions'
import {
  CAPTIONS,
  MEASURES,
  QUESTION_HEADS,
  TABLE_HEADS,
} from '../../results/labels'
import {
  JUDGE_LABELS,
  STRATUM_LABELS,
  STRATUM_SHORT,
  STRATUM_ORDER,
} from '../../results/strata'
import { RunBadge } from './run-badge'
import { ScrollBox } from '../../components/scroll-box'

type Row = Schemas['InstanceResultOut']
type PipelineScores = Schemas['InstancePipelineOut']

export const PAGE_SIZE = 50
const ALL = 'All'
const NO_JUDGE = 'No judge'
const NO_EVIDENCE = 'Not scored'
const num = (value: number | null, format: (v: number) => string) =>
  value === null ? MISSING : format(value)
const whole = (v: number) => formatNumber(v, { decimals: 0 })
const twoPlaces = (v: number) => formatNumber(v, { decimals: 2 })

const SELECT =
  'w-auto min-w-0 max-w-xs rounded-chip border border-border bg-surface px-3 py-1 text-sm text-text-primary'
const BUTTON =
  'rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-text-muted'

const classCounts = (classes: Record<string, number>) =>
  Object.entries(classes)
    .map(([cls, count]) => {
      const words = failureWords(cls)
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}: ${count}`
    })
    .join('; ') || 'None'

/** The scores of one question in one world, a column per approach. */
function Details({ row }: { row: Row }) {
  const rows: [string, (s: PipelineScores) => string][] = [
    [MEASURES.recall, (s) => num(s.evidence_recall, evidenceScore)],
    [MEASURES.precision, (s) => num(s.evidence_precision, evidenceScore)],
    [MEASURES.citation, (s) => num(s.citation_accuracy, evidenceScore)],
    [MEASURES.latency, (s) => num(s.latency_ms, whole)],
    [MEASURES.context, (s) => num(s.context_tokens, whole)],
    [MEASURES.efficiency, (s) => num(s.efficiency_per_1k, twoPlaces)],
    ...Object.entries(JUDGE_LABELS).map(
      ([key, label]): [string, (s: PipelineScores) => string] => [
        `${MEASURES.judgeName}: ${label}`,
        (s) => num(s[key as keyof typeof JUDGE_LABELS], twoPlaces),
      ],
    ),
    [MEASURES.failures, (s) => classCounts(s.failure_classes)],
    [MEASURES.unscored, (s) => String(s.unscored_repeats)],
  ]
  return (
    <DataTable
      caption={`${row.question_id}, world ${row.world_seed}`}
      rowHeader={TABLE_HEADS.measure}
      columns={PIPELINES.map(({ label }) => label)}
      rows={rows.map(([label, read]) => ({
        key: label,
        label,
        cells: PIPELINES.map(({ id }) => {
          const s = row.pipelines[id]
          return s ? read(s) : MISSING
        }),
      }))}
    />
  )
}

const CELL = 'tabular whitespace-nowrap px-2 py-2 text-right'

/** One approach's cells; `metric` is the evidence metric of the run's method. */
function Scores({
  row,
  id,
  metric,
}: {
  row: Row
  id: string
  metric: EvidenceMetric
}) {
  const s = row.pipelines[id]
  const evidence = s
    ? s[metric] === null && row.stratum === 'H3'
      ? NO_EVIDENCE
      : num(s[metric], evidenceScore)
    : MISSING
  return (
    <>
      <td className={CELL}>{s ? percent(s.answer) : MISSING}</td>
      <td className={CELL}>{evidence}</td>
      <td className={CELL}>
        {s
          ? s.judge_correctness === null
            ? NO_JUDGE
            : twoPlaces(s.judge_correctness)
          : MISSING}
      </td>
    </>
  )
}

function QuestionRow({
  row,
  metric,
  open,
  onToggle,
  activeWorld,
  worldsFailed,
}: {
  row: Row
  metric: EvidenceMetric
  open: boolean
  onToggle: () => void
  activeWorld: number | null
  worldsFailed: boolean
}) {
  const link = liveLabLink(row, activeWorld)
  const detailId = `detail-${row.instance_id}`
  return (
    <>
      <tr className="border-b border-hairline align-top">
        <td className="py-2 pr-3">
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              aria-label={`Details for ${row.instance_id}`}
              onClick={onToggle}
              className="mt-0.5 shrink-0 rounded-chip border border-border p-0.5 text-text-primary hover:bg-surface-raised"
            >
              {open ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
            </button>
            <div>
              <div className="text-text-primary">{row.text}</div>
              <div className="text-xs text-text-secondary">
                {row.question_id}
              </div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2">{STRATUM_SHORT[stratumOf(row)]}</td>
        <td className={CELL}>{row.world_seed}</td>
        {PIPELINES.map(({ id }) => (
          <Scores key={id} row={row} id={id} metric={metric} />
        ))}
        <td className="px-2 py-2">
          {'href' in link ? (
            <a
              href={link.href}
              aria-label={`Open ${row.instance_id} in Live Lab`}
              className="text-text-primary underline"
            >
              Open
            </a>
          ) : (
            <span className="text-text-secondary">
              {worldsFailed ? (
                MISSING
              ) : (
                <span title={link.reason} className="whitespace-nowrap">
                  <span aria-hidden>Not loaded</span>
                  <span className="sr-only">{link.reason}</span>
                </span>
              )}
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr
          id={detailId}
          className="border-b border-hairline bg-surface-raised"
        >
          <td colSpan={13} className="p-3">
            <Details row={row} />
          </td>
        </tr>
      )}
    </>
  )
}

const distinct = <T,>(values: T[]) => [...new Set(values)]

function Filters({
  rows,
  filter,
  change,
}: {
  rows: Row[]
  filter: QuestionFilter
  change: (next: QuestionFilter) => void
}) {
  const strata = STRATUM_ORDER.filter(
    (s) => s !== 'overall' && rows.some((row) => stratumOf(row) === s),
  )
  const worlds = distinct(rows.map((row) => row.world_seed)).sort(
    (a, b) => a - b,
  )
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-text-primary">
      <label className="flex min-w-0 max-w-full items-center gap-2">
        {QUESTION_HEADS.kind}
        <select
          className={SELECT}
          value={filter.stratum ?? ''}
          onChange={(e) =>
            change({ ...filter, stratum: e.target.value || null })
          }
        >
          <option value="">{ALL}</option>
          {strata.map((s) => (
            <option key={s} value={s}>
              {STRATUM_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 max-w-full items-center gap-2">
        {QUESTION_HEADS.world}
        <select
          className={SELECT}
          value={filter.world ?? ''}
          onChange={(e) =>
            change({
              ...filter,
              world: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value="">{ALL}</option>
          {worlds.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      {filter.failure && (
        <span className="flex items-center gap-2">
          <span className="rounded-chip border border-border px-2 py-0.5">
            {filter.failure.pipeline}: {failureWords(filter.failure.cls)}
          </span>
          <button
            type="button"
            className={BUTTON}
            onClick={() => change({ ...filter, failure: null })}
          >
            Clear
          </button>
        </span>
      )}
    </div>
  )
}

function Table({
  rows,
  metric,
  tableRef,
  badge,
  activeWorld,
  worldsFailed,
}: {
  rows: Row[]
  metric: EvidenceMetric
  tableRef: RefObject<HTMLDivElement | null>
  badge?: string
  activeWorld: number | null
  worldsFailed: boolean
}) {
  const { params } = useRoute()
  const filter = filterFromParams(params)
  const key = JSON.stringify(filter)
  const [paged, setPaged] = useState({ key, page: 0 })
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const page = paged.key === key ? paged.page : 0
  const kept = filterInstances(rows, filter)
  const shown = kept.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const from = kept.length === 0 ? 0 : page * PAGE_SIZE + 1
  const to = page * PAGE_SIZE + shown.length
  const go = (next: number) => setPaged({ key, page: next })
  const toggle = (id: string) =>
    setOpened((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <div ref={tableRef} tabIndex={-1} className="space-y-3">
      <RunBadge label={badge} />
      <Filters
        rows={rows}
        filter={filter}
        change={(next) => {
          window.location.hash = hrefFor(
            'results',
            paramsWithFilter(params, next),
          )
        }}
      />
      <ScrollBox label={CAPTIONS.questions}>
        <table className="w-full border-collapse text-sm text-text-primary">
          <caption className="sr-only">{CAPTIONS.questions}</caption>
          <thead>
            <tr className="text-left text-text-secondary">
              <th rowSpan={2} scope="col" className="py-2 pr-3 font-semibold">
                {QUESTION_HEADS.question}
              </th>
              <th rowSpan={2} scope="col" className="px-2 py-2 font-semibold">
                {QUESTION_HEADS.kind}
              </th>
              <th
                rowSpan={2}
                scope="col"
                className="px-2 py-2 text-right font-semibold"
              >
                {QUESTION_HEADS.world}
              </th>
              {PIPELINES.map(({ id, label, tint }) => (
                <th
                  key={id}
                  colSpan={3}
                  scope="colgroup"
                  className="px-2 py-1 text-center font-semibold text-text-primary"
                  style={{ background: tint }}
                >
                  {label}
                </th>
              ))}
              <th rowSpan={2} scope="col" className="px-2 py-2 font-semibold">
                {QUESTION_HEADS.liveLab}
              </th>
            </tr>
            <tr className="border-b border-hairline text-right text-text-secondary">
              {PIPELINES.flatMap(({ id }) =>
                [
                  QUESTION_HEADS.answer,
                  EVIDENCE_LABELS[metric],
                  MEASURES.judge,
                ].map((name) => (
                  <th
                    key={`${id}-${name}`}
                    scope="col"
                    className="whitespace-nowrap px-2 py-1 font-semibold"
                  >
                    {name}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <QuestionRow
                key={row.instance_id}
                row={row}
                metric={metric}
                open={opened.has(row.instance_id)}
                onToggle={() => toggle(row.instance_id)}
                activeWorld={activeWorld}
                worldsFailed={worldsFailed}
              />
            ))}
          </tbody>
        </table>
      </ScrollBox>
      {kept.length === 0 ? (
        <p className="text-sm text-text-secondary">No match</p>
      ) : (
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <span className="tabular">
            {`${from} to ${to} of ${kept.length}`}
            {kept.length < rows.length &&
              ` (${rows.length} ${TABLE_HEADS.total})`}
          </span>
          <button
            type="button"
            className={BUTTON}
            disabled={page === 0}
            onClick={() => go(page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={to >= kept.length}
            onClick={() => go(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

/** Loads the run's per-question scores and the loaded world; a failure here leaves the rest of the screen alone. */
export function QuestionsPanel({
  runId,
  evidence,
  tableRef,
  badge,
}: {
  runId: string
  /** The evidence metric of the run's method: F1 under v0.2, recall from v0.3 (D-087). */
  evidence: EvidenceMetric
  tableRef: RefObject<HTMLDivElement | null>
  badge?: string
}) {
  const instances = useLoad(
    (signal) => getBenchmarkInstances(runId, signal),
    `instances:${runId}`,
  )
  const datasets = useLoad(listDatasets, 'results-datasets')
  const activeWorld =
    datasets.status === 'ready'
      ? (datasets.data.find((d) => d.active)?.world_seed ?? null)
      : null
  return (
    <Panel
      title="Questions"
      state={instances.status}
      error={instances.status === 'error' ? instances.error : undefined}
      onRetry={instances.retry}
    >
      {instances.status === 'ready' && (
        <Table
          rows={instances.data}
          metric={evidence}
          tableRef={tableRef}
          badge={badge}
          activeWorld={activeWorld}
          worldsFailed={datasets.status === 'error'}
        />
      )}
    </Panel>
  )
}
