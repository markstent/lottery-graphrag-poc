/**
 * Overview: the verdict from the latest full official run, how the three
 * approaches differ, and the way into Live Lab. Numbers come from the run's
 * summary as published; nothing is computed here.
 */

import { getDemoQuestions, getModels, listDatasets } from '../../api/client'
import { datasetName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { MODEL_LABELS } from '../../app/settings-labels'
import { useLoad, type Load } from '../../app/use-load'
import { StatTile } from '../../charts/stat-tile'
import { plural } from '../../charts/scale'
import { Panel, type PanelState } from '../../components/panel'
import { PIPELINES } from '../../design/pipelines'
import { Screen } from '../screen'
import { FlowDiagram } from './flow-diagram'
import { loadLatest, verdictFrom, type TileFigures } from './latest-run'

const LINK = 'text-text-primary underline'

/** A load as a Panel state; `empty` is for a ready load with nothing in it. */
const stateOf = (load: Load<unknown>, empty = false): PanelState =>
  load.status === 'ready' && empty ? 'empty' : load.status

const errorOf = (load: Load<unknown>) =>
  load.status === 'error' ? load.error : undefined

async function loadConfiguration(signal: AbortSignal) {
  const [datasets, models] = await Promise.all([
    listDatasets(signal),
    getModels(signal),
  ])
  return { dataset: datasets.find((d) => d.active) ?? null, models }
}

function Tile({ figures }: { figures: TileFigures }) {
  const pipeline = PIPELINES.find((p) => p.id === figures.pipeline)!
  return (
    <div
      className="rounded-card p-4"
      style={{ backgroundColor: pipeline.tint }}
      data-testid={`tile-${pipeline.id}`}
    >
      <h3
        className="mb-2 text-base font-semibold"
        style={{ color: pipeline.strong }}
      >
        {pipeline.label}
      </h3>
      <StatTile
        label="Evidence score, all questions"
        value={figures.mean}
        unit=""
        decimals={2}
      />
      <div className="tabular mt-1 text-sm text-text-muted">
        {`${plural(figures.n, 'question')}, ${plural(figures.repeats, 'run')}`}
      </div>
    </div>
  )
}

function LatestRun() {
  const load = useLoad(loadLatest, 'overview-latest')
  const verdict = load.status === 'ready' ? verdictFrom(load.data) : null
  return (
    <Panel
      title="Latest official run"
      state={stateOf(load)}
      error={errorOf(load)}
      onRetry={load.retry}
      skeleton={
        <div className="grid grid-cols-3 gap-4">
          {PIPELINES.map((p) => (
            <div key={p.id} className="skeleton-bar h-24 rounded-card" />
          ))}
        </div>
      }
    >
      {verdict?.kind === 'official' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {verdict.tiles.map((figures) => (
              <Tile key={figures.pipeline} figures={figures} />
            ))}
          </div>
          <p className="text-sm text-text-muted">
            Evidence score: 1 is all the needed evidence and nothing extra.
            Intervals are for the differences below.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-base text-text-primary">
            {verdict.headlines.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {verdict?.kind === 'none' && (
        <div className="space-y-2 text-base">
          <p className="font-semibold text-text-primary">No official run yet</p>
          {verdict.otherRun && (
            <p className="text-text-secondary">
              Latest run: {verdict.otherRun}
            </p>
          )}
          <a href={hrefFor('results')} className={LINK}>
            Go to Results
          </a>
        </div>
      )}
    </Panel>
  )
}

function RunAQuestion() {
  const load = useLoad(getDemoQuestions, 'overview-questions')
  const empty = load.status === 'ready' && load.data.length === 0
  return (
    <Panel
      title="Run a question"
      state={stateOf(load, empty)}
      message="No demo questions are available."
      error={errorOf(load)}
      onRetry={load.retry}
    >
      <div className="space-y-3">
        <a
          href={hrefFor('live-lab')}
          className="inline-block rounded-chip bg-text-primary px-4 py-2 text-sm font-semibold text-surface"
        >
          Run a question
        </a>
        {load.status === 'ready' && (
          <ul className="space-y-2 text-base">
            {load.data.map((question) => (
              <li key={question.instance_id}>
                <a
                  href={hrefFor('live-lab', { question: question.instance_id })}
                  className={LINK}
                >
                  {question.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

function Configuration() {
  const load = useLoad(loadConfiguration, 'overview-configuration')
  return (
    <Panel
      title="Configuration"
      state={stateOf(load)}
      error={errorOf(load)}
      onRetry={load.retry}
    >
      {load.status === 'ready' && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-text-secondary">Dataset</dt>
          <dd className="text-text-primary">
            {load.data.dataset
              ? datasetName(load.data.dataset.dataset_id)
              : 'none active'}
          </dd>
          {(Object.keys(MODEL_LABELS) as (keyof typeof MODEL_LABELS)[]).map(
            (role) => (
              <div key={role} className="contents">
                <dt className="text-text-secondary">{MODEL_LABELS[role]}</dt>
                <dd className="text-text-primary">
                  {load.data.models[role].model}
                </dd>
              </div>
            ),
          )}
        </dl>
      )}
    </Panel>
  )
}

export function Overview() {
  return (
    <Screen destination="overview">
      <LatestRun />
      <Panel title="How the three approaches differ" state="ready">
        <FlowDiagram />
      </Panel>
      <div className="grid grid-cols-2 items-start gap-4">
        <RunAQuestion />
        <Configuration />
      </div>
    </Screen>
  )
}
