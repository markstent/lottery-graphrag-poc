/**
 * Start a benchmark run from Results and follow it. The form opens inline;
 * the models are set in configuration, so they are shown and not chosen.
 */

import { TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { getLatestBenchmark, getModels, type Schemas } from '../../api/client'
import { ApiError } from '../../api/http'
import { KIND_WORDS } from '../../app/run-kinds'
import { useLoad } from '../../app/use-load'
import { Notice, Panel } from '../../components/panel'
import { STRATUM_LABELS } from '../../results/strata'
import {
  DEFAULT_FORM,
  errorsOf,
  progressFraction,
  progressText,
  startBody,
  STRATA,
  WORLD_SEEDS,
  type StartForm,
} from '../../results/start'

type Job = Schemas['BenchmarkJob']
type Body = Schemas['BenchmarkStart']

const BUTTON =
  'rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50'
const FIELD =
  'rounded-chip border border-border bg-surface px-3 py-1 text-sm text-text-primary'

const NOT_KNOWN = 'Not known'
const SET_IN_CONFIGURATION = 'Set in configuration'

const KINDS: StartForm['kind'][] = ['official', 'smoke']

const toggled = <T,>(list: T[], item: T) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error))

function Problem({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div role="alert">
      <Notice icon={<TriangleAlert size={16} className="text-error" />}>
        <p className="text-text-primary">{message}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className={BUTTON}>
            Retry
          </button>
        )}
      </Notice>
    </div>
  )
}

function Group({
  legend,
  error,
  children,
}: {
  legend: string
  error?: string
  children: ReactNode
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <legend className="float-left w-56 text-sm font-semibold text-text-primary">
        {legend}
      </legend>
      {children}
      {error && <span className="text-sm text-error">{error}</span>}
    </fieldset>
  )
}

function Choice({
  type,
  checked,
  onChange,
  children,
}: {
  type: 'radio' | 'checkbox'
  checked: boolean
  onChange: () => void
  children: string
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input type={type} checked={checked} onChange={onChange} />
      {children}
    </label>
  )
}

/** The read-only lines: what the run will be asked and judged with. */
function Setup() {
  const models = useLoad(getModels, 'start-models')
  const latest = useLoad(getLatestBenchmark, 'start-latest')
  const bank =
    latest.status === 'ready' ? latest.data.summary.bank_version : NOT_KNOWN
  const generation =
    models.status === 'ready' ? models.data.generation.model : NOT_KNOWN
  const judge =
    models.status !== 'ready'
      ? NOT_KNOWN
      : (models.data.judge?.model ?? 'None configured')
  const judgeNote =
    models.status === 'ready' && models.data.judge?.provider === 'invalid'
      ? models.data.judge.detail
      : null
  return (
    <>
      <dl className="grid grid-cols-[14rem_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-secondary">Question bank</dt>
        <dd className="text-text-primary">{bank}</dd>
        <dt className="text-text-secondary">Generation model</dt>
        <dd className="text-text-primary">
          <span>{generation}</span>
          <span className="text-text-muted"> - {SET_IN_CONFIGURATION}</span>
        </dd>
        <dt className="text-text-secondary">Judge model</dt>
        <dd className="text-text-primary">
          <span>{judge}</span>
          <span className="text-text-muted"> - {SET_IN_CONFIGURATION}</span>
        </dd>
      </dl>
      {models.status === 'error' && <Problem message={models.error.message} />}
      {judgeNote && <Problem message={judgeNote} />}
    </>
  )
}

function Form({ start }: { start: (body: Body) => Promise<void> }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<Error | null>(null)
  const errors = errorsOf(form)
  const change = (part: Partial<StartForm>) => setForm({ ...form, ...part })

  const submit = async () => {
    setProblem(null)
    setSending(true)
    try {
      await start(startBody(form))
    } catch (failure) {
      setProblem(asError(failure))
    } finally {
      setSending(false)
    }
  }
  const retryable =
    problem instanceof ApiError &&
    (problem.code === 'CONFLICT' || problem.retryable)

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Group legend="Kind">
        {KINDS.map((kind) => (
          <Choice
            key={kind}
            type="radio"
            checked={form.kind === kind}
            onChange={() =>
              change({
                kind,
                repeats: kind === 'official' ? DEFAULT_FORM.repeats : '1',
              })
            }
          >
            {KIND_WORDS[kind]}
          </Choice>
        ))}
      </Group>
      <Group legend="Worlds" error={errors.worlds}>
        {WORLD_SEEDS.map((seed) => (
          <Choice
            key={seed}
            type="checkbox"
            checked={form.worlds.includes(seed)}
            onChange={() => change({ worlds: toggled(form.worlds, seed) })}
          >
            {String(seed)}
          </Choice>
        ))}
      </Group>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label
          htmlFor="start-repeats"
          className="w-56 text-sm font-semibold text-text-primary"
        >
          Repeats
        </label>
        <input
          id="start-repeats"
          type="number"
          min={1}
          value={form.repeats}
          onChange={(event) => change({ repeats: event.target.value })}
          className={`${FIELD} w-20`}
        />
        {errors.repeats && (
          <span className="text-sm text-error">{errors.repeats}</span>
        )}
      </div>
      <Group legend="Scope">
        <Choice
          type="radio"
          checked={form.strata.length === 0}
          onChange={() => change({ strata: [] })}
        >
          Whole bank
        </Choice>
        {STRATA.map((stratum) => (
          <Choice
            key={stratum}
            type="checkbox"
            checked={form.strata.includes(stratum)}
            onChange={() => change({ strata: toggled(form.strata, stratum) })}
          >
            {STRATUM_LABELS[stratum]}
          </Choice>
        ))}
      </Group>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label
          htmlFor="start-limit"
          className="w-56 text-sm font-semibold text-text-primary"
        >
          At most N per question
        </label>
        <input
          id="start-limit"
          type="number"
          min={1}
          value={form.limit}
          onChange={(event) => change({ limit: event.target.value })}
          className={`${FIELD} w-20`}
        />
        {errors.limit && (
          <span className="text-sm text-error">{errors.limit}</span>
        )}
      </div>
      <Setup />
      {problem && (
        <Problem
          message={problem.message}
          onRetry={retryable ? () => void submit() : undefined}
        />
      )}
      <button
        type="submit"
        disabled={sending || Object.keys(errors).length > 0}
        className="rounded-chip bg-text-primary px-5 py-2 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start
      </button>
    </form>
  )
}

function Progress({ job, cancel }: { job: Job; cancel: () => Promise<void> }) {
  const [cancelling, setCancelling] = useState(false)
  const [problem, setProblem] = useState<Error | null>(null)
  const percent = Math.round(progressFraction(job.progress) * 100)
  const stop = async () => {
    setCancelling(true)
    try {
      await cancel()
    } catch (failure) {
      setProblem(asError(failure))
      setCancelling(false)
    }
  }
  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-text-primary">
        {progressText(job.progress)}
      </p>
      <div
        role="progressbar"
        aria-label="Run progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-chip bg-surface-raised"
      >
        <div
          className="h-full bg-text-primary"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={cancelling}
          onClick={() => void stop()}
          className={BUTTON}
        >
          Cancel
        </button>
        <span className="text-sm text-text-secondary">
          Cancelling stops after the current question.
        </span>
      </div>
      {problem && <Problem message={problem.message} />}
    </div>
  )
}

export function StartPanel({
  job,
  error,
  start,
  cancel,
}: {
  job: Job | null
  /** A failure to start following, or to keep following, the job. */
  error: Error | null
  start: (body: Body) => Promise<void>
  cancel: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const running = job?.status === 'running'
  return (
    <Panel title="Run a benchmark" state="ready">
      <div className="space-y-3">
        {error && <Problem message={error.message} />}
        {running ? (
          <Progress job={job} cancel={cancel} />
        ) : (
          <>
            {job?.status === 'cancelled' && (
              <p role="status" className="text-sm text-text-primary">
                Cancelled. No results were written.
              </p>
            )}
            {job?.status === 'failed' && (
              <Problem message={job.error?.message ?? 'The run failed.'} />
            )}
            {open ? (
              <Form
                start={async (body) => {
                  await start(body)
                  setOpen(false)
                }}
              />
            ) : (
              <button
                type="button"
                aria-expanded={false}
                onClick={() => setOpen(true)}
                className={BUTTON}
              >
                Start a run
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}
