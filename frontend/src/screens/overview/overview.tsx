/**
 * Overview: the verdict from the latest full official run, how the three
 * approaches differ, and the way into Live Lab. Numbers come from the run's
 * summary as published; nothing is computed here.
 */

import { getDemoQuestions, getModels, listDatasets } from '../../api/client'
import type { EvidenceMetric } from '../../app/method'
import { datasetName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { percent } from '../../app/score-words'
import { MODEL_LABELS } from '../../app/settings-labels'
import { useLoad, type Load } from '../../app/use-load'
import { plural } from '../../charts/scale'
import { MethodBadge } from '../../components/method-badge'
import { Panel, type PanelState } from '../../components/panel'
import { pipeline, PIPELINES, type PipelineId } from '../../design/pipelines'
import { Screen } from '../screen'
import { FLOW_TITLE, FlowDiagram } from '../../components/flow-diagram'
import {
  loadLatest,
  verdictFrom,
  type Finding,
  type TileFigures,
} from '../../app/latest-run'

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

/** What the big number on a tile is called, by the run's evidence metric. */
const TILE_LABELS: Record<EvidenceMetric, string> = {
  evidence_recall: 'Evidence found',
  evidence_f1: 'Evidence score',
}

/** What the big number means, said once above the tiles. */
const TILE_MEANINGS: Record<EvidenceMetric, string> = {
  evidence_recall: 'Evidence found is the share of needed records found.',
  evidence_f1: 'Evidence score weighs needed records found against extra ones.',
}

/** The kinds of question in everyday words, for the sentences on this screen. */
const KIND_WORDS: Record<string, string> = {
  H1: 'questions that need several linked records',
  H2: 'questions that match terms across markets',
  H2_name: 'questions that name something in a local language',
  H3: 'single-fact questions',
  H5: 'questions about hidden patterns',
  overall: 'all questions',
}

/** How a difference on each metric reads, after "scored N points higher than X". */
const METRIC_WORDS: Record<string, string> = {
  evidence_recall: 'at finding needed evidence',
  evidence_f1: 'on evidence',
  answer: 'on answers',
}

/** The pipelines a tested pair compares, first minus second. */
const PAIRS: Record<Finding['comparison'], [PipelineId, PipelineId]> = {
  B_vs_A: ['B', 'A'],
  C_vs_B: ['C', 'B'],
}

/** The run's own declaration of a method change, said plainly for a known method. */
const METHOD_WORDS: Record<string, string> = {
  '0.3.0':
    'Our second method: the first, v0.2, found no clear difference, so we changed it and retested on new data. Help, chapter 9, explains.',
}

/** "On X, Graph scored 22 points higher than Text search at finding needed evidence." */
function findingSentence({ stratum, comparison, metric, mean }: Finding) {
  const [first, second] = PAIRS[comparison]
  const [higher, lower] = mean < 0 ? [second, first] : [first, second]
  const points = Math.round(Math.abs(mean) * 100)
  return `On ${KIND_WORDS[stratum] ?? stratum}, ${pipeline(higher).name} scored ${points} points higher than ${pipeline(lower).name} ${METRIC_WORDS[metric] ?? ''}.`
}

/** What the tested comparisons not stated as clear showed. */
function restSentence(count: number, leaning: number, afterClear: boolean) {
  const those = `${afterClear ? 'other ' : ''}${plural(count, 'comparison')}`
  if (leaning === 0) return `The ${those} we tested showed no clear difference.`
  return `Of the ${those} we tested, ${leaning} leaned one way but not enough to count, and ${count - leaning} showed no clear difference.`
}

const findingKey = (f: Finding) => `${f.stratum}-${f.comparison}-${f.metric}`

function Tile({
  figures,
  label,
}: {
  figures: TileFigures
  /** What the big number measures. */
  label: string
}) {
  const { label: name, tint, strong } = pipeline(figures.pipeline)
  return (
    <div
      className="rounded-card p-4"
      style={{ backgroundColor: tint }}
      data-testid={`tile-${figures.pipeline}`}
    >
      <h3 className="mb-2 text-base font-semibold" style={{ color: strong }}>
        {name}
      </h3>
      <div className="text-sm text-text-secondary">{label}</div>
      <div className="tabular text-2xl font-semibold text-text-primary">
        {percent(figures.mean)}
      </div>
      <div className="tabular mt-1 text-sm text-text-secondary">
        {`Answer score ${percent(figures.answer)}`}
      </div>
    </div>
  )
}

function LatestRun() {
  const load = useLoad(loadLatest, 'overview-latest')
  const verdict = load.status === 'ready' ? verdictFrom(load.data) : null
  const findings = verdict?.kind === 'official' ? verdict.findings : []
  const clear = findings.filter((f) => f.kind === 'clear')
  const hints = findings.filter((f) => f.kind === 'hint')
  return (
    <Panel
      title="What we found"
      state={stateOf(load)}
      error={errorOf(load)}
      onRetry={load.retry}
      skeleton={
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PIPELINES.map((p) => (
            <div key={p.id} className="skeleton-bar h-24 rounded-card" />
          ))}
        </div>
      }
    >
      {verdict?.kind === 'official' && (
        <div className="space-y-4">
          <MethodBadge
            method={verdict.method}
            note={METHOD_WORDS[verdict.method] ?? verdict.note}
          />
          <p className="max-w-prose text-base text-text-primary">
            {`All three answered the same ${verdict.questions > 0 ? `${plural(verdict.questions, 'question')}` : 'questions'} about a made-up lottery company. ${TILE_MEANINGS[verdict.metric]}`}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {verdict.tiles.map((figures) => (
              <Tile
                key={figures.pipeline}
                figures={figures}
                label={TILE_LABELS[verdict.metric]}
              />
            ))}
          </div>
          {(findings.length > 0 || verdict.tested > 0) && (
            <ul className="max-w-prose list-disc space-y-2 pl-5 text-base text-text-primary">
              {clear.map((finding) => (
                <li key={findingKey(finding)}>
                  <strong>Clear result.</strong> {findingSentence(finding)}
                </li>
              ))}
              {verdict.tested > 0 && (
                <li>
                  {clear.length === 0 && <strong>No clear result. </strong>}
                  {restSentence(
                    verdict.tested - clear.length,
                    verdict.disagreements,
                    clear.length > 0,
                  )}
                </li>
              )}
              {hints.map((finding) => (
                <li key={findingKey(finding)}>
                  <strong>Not tested, so only a hint.</strong>{' '}
                  {findingSentence(finding)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-text-secondary">
            Every figure and margin of error is on{' '}
            <a href={hrefFor('results')} className={LINK}>
              Results
            </a>
            .
          </p>
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
      message="No demo questions."
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
      title="Models used"
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
      <Panel title={FLOW_TITLE} state="ready">
        <p className="mb-3 max-w-prose text-base text-text-primary">
          Text search finds matching passages. Graph also follows links between
          records. Graph + Ontology adds a shared list of business terms across
          markets.
        </p>
        <FlowDiagram />
      </Panel>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <RunAQuestion />
        <Configuration />
      </div>
    </Screen>
  )
}
