/**
 * Overview: the verdict from the latest full official run, how the three
 * approaches differ, and the way into Live Lab. Numbers come from the run's
 * summary as published; nothing is computed here.
 */

import { getDemoQuestions, getModels, listDatasets } from '../../api/client'
import { datasetName } from '../../app/plain-words'
import { EVIDENCE_FOUND_LABEL, EVIDENCE_METRIC } from '../../app/method'
import { hrefFor } from '../../app/router'
import { percent } from '../../app/score-words'
import { MODEL_LABELS } from '../../app/settings-labels'
import { useLoad, type Load } from '../../app/use-load'
import { plural } from '../../charts/scale'
import { KindChart, MARK_LABEL } from '../../components/kind-chart'
import { Panel, type PanelState } from '../../components/panel'
import { pipeline, PIPELINES, type PipelineId } from '../../design/pipelines'
import { Screen } from '../screen'
import { FLOW_TITLE, FlowDiagram } from '../../components/flow-diagram'
import {
  loadOverview,
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

/** What the big number on a tile is called. */
const TILE_LABEL = EVIDENCE_FOUND_LABEL

/** The scores, said once above the tiles; the judges' mark only when the run has it. */
const SCORE_KEY: readonly [string, string][] = [
  [
    `${EVIDENCE_FOUND_LABEL}:`,
    'before the AI answers, each approach looks up records for it to read. This is the share of the records the question needed that it found.',
  ],
  ['Answer score:', "how close the AI's answer came to the correct answer."],
  [`${MARK_LABEL}:`, 'how two AI judges rated the answer, averaged.'],
]

/** The kinds of question in everyday words, for the sentences on this screen. */
const KIND_WORDS: Record<string, string> = {
  H1: 'questions that need several linked records',
  H2: 'questions that match terms across countries',
  H2_name: "questions that use a country's own name for something",
  H3: 'single-fact questions',
  H5: 'questions about hidden patterns',
  overall: 'all questions',
}

/** One example of each kind, so a reader can picture it. */
const KIND_EXAMPLES: Record<string, string> = {
  H1: 'For example: "which other countries had incidents on the same platform version as this one?"',
  H2: 'For example: "which games in other countries are the same kind of game as this one?"',
  H2_name: 'For example, Austria calls its national draw "Zahlenziehung".',
  H3: 'For example: "what is the ticket price of this game?"',
  H5: 'For example: "which countries were hit by the same platform fault?"',
}

/** The pipelines a tested pair compares, first minus second. */
const PAIRS: Record<Finding['comparison'], [PipelineId, PipelineId]> = {
  B_vs_A: ['B', 'A'],
  C_vs_B: ['C', 'B'],
}

/**
 * "Graph found about 22 more of every 100 needed facts than Text search."
 * `again` is for a difference that follows another of the same kind in one
 * sentence, which has already said what is counted: "Graph about 38 more than Text search."
 */
function difference({ comparison, metric, mean }: Finding, again = false) {
  const [first, second] = PAIRS[comparison]
  const [higher, lower] = mean < 0 ? [second, first] : [first, second]
  const points = Math.round(Math.abs(mean) * 100)
  const what = again
    ? `about ${points} ${metric === EVIDENCE_METRIC ? 'more' : 'points higher'} than`
    : metric === EVIDENCE_METRIC
      ? `found about ${points} more of every 100 needed facts than`
      : `scored about ${points} points higher on ${metric === 'answer' ? 'answers' : "the two judges' mark"} than`
  return {
    higher: pipeline(higher).name,
    text: `${pipeline(higher).name} ${what} ${pipeline(lower).name}.`,
  }
}

/** The kinds of question one approach led on, as a phrase: "on answers to X" when it led on one score of several. */
function ledOn(group: Finding[], scores: number) {
  const kind = KIND_WORDS[group[0]!.stratum] ?? group[0]!.stratum
  if (scores < 2 || new Set(group.map((f) => f.metric)).size === scores)
    return `on ${kind}`
  return group[0]!.metric === EVIDENCE_METRIC
    ? `on evidence for ${kind}`
    : `on answers to ${kind}`
}

/** "Graph + Ontology did better on X, Graph on answers to Y, and Text search on Z." */
function leaningSentence(leaning: Finding[]) {
  const scores = new Set(leaning.map((f) => f.metric)).size
  const groups = new Map<string, Finding[]>()
  for (const finding of leaning) {
    const key = `${difference(finding).higher}|${finding.stratum}`
    groups.set(key, [...(groups.get(key) ?? []), finding])
  }
  const parts = [...groups.entries()].map(([key, group], index) => {
    const higher = key.split('|')[0]!
    return `${index === 0 ? `${higher} did better` : higher} ${ledOn(group, scores)}`
  })
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)!}`
      : parts[0]!
  return `${list}.`
}

/** What the tested comparisons not stated as clear showed. */
function restSentence(
  count: number,
  leaning: Finding[],
  afterClear: boolean,
  oneScore: boolean,
) {
  const each = `${count === 1 ? 'comparing' : 'each comparing'} two approaches on one kind of question${oneScore ? '' : ' and one score'}`
  const made = `We made ${plural(count, `${afterClear ? 'other ' : ''}check`)}, ${each}.`
  if (leaning.length === 0)
    return `${made} In all of them the approaches were too close to call.`
  const close = count - leaning.length
  return [
    made,
    `In ${leaning.length}, one approach came out ahead, but not by enough to rule out luck.`,
    leaningSentence(leaning),
    close > 0
      ? `In the other ${close === 1 ? 'one' : close} the approaches were too close to call.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const findingKey = (f: Finding) => `${f.stratum}-${f.comparison}-${f.metric}`

/** One difference that passed its family's test, in words. */
function ClearItem({ finding }: { finding: Finding }) {
  const { higher, text } = difference(finding)
  return (
    <li>
      <strong>{`${higher} did better on ${KIND_WORDS[finding.stratum] ?? finding.stratum}.`}</strong>{' '}
      {KIND_EXAMPLES[finding.stratum]} {text} This passed our statistical test,
      so it is unlikely to be luck.
    </li>
  )
}

/** What one family's other tested comparisons showed; `measure` names a family other than the run's own. */
function CountItem({
  measure,
  tested,
  clear,
  leaning,
}: {
  measure?: string
  tested: number
  clear: number
  leaning: Finding[]
}) {
  return (
    <li>
      <strong>
        {`${measure ? `${measure}: ` : ''}${clear === 0 ? 'No difference is proven yet.' : 'Nothing else is proven yet.'}`}
      </strong>{' '}
      {restSentence(tested - clear, leaning, clear > 0, measure !== undefined)}
    </li>
  )
}

function Tile({ figures }: { figures: TileFigures }) {
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
      <div className="text-sm text-text-secondary">{TILE_LABEL}</div>
      <div className="tabular text-2xl font-semibold text-text-primary">
        {percent(figures.mean)}
      </div>
      <div className="tabular mt-1 text-sm text-text-secondary">
        {`Answer score ${percent(figures.answer)}`}
      </div>
      {figures.judgeMark !== undefined && (
        <div className="tabular text-sm text-text-secondary">
          {`${MARK_LABEL} ${percent(figures.judgeMark)}`}
        </div>
      )}
    </div>
  )
}

function LatestRun() {
  const load = useLoad(loadOverview, 'overview-latest')
  const verdict =
    load.status === 'ready'
      ? verdictFrom(load.data.latest, load.data.combined)
      : null
  const findings = verdict?.kind === 'official' ? verdict.findings : []
  const clear = findings.filter((f) => f.kind === 'clear')
  const hints = findings.filter((f) => f.kind === 'hint')
  const judges = verdict?.kind === 'official' ? verdict.judges : null
  const judgesClear = judges?.findings ?? []
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
          <p className="max-w-prose text-base text-text-primary">
            {`All three answered the same ${verdict.questions > 0 ? `${plural(verdict.questions, 'question')}` : 'questions'} about a made-up lottery company. Each gets ${judges ? 'three' : 'two'} scores:`}
          </p>
          <dl className="max-w-prose space-y-1 text-base text-text-primary">
            {SCORE_KEY.slice(0, judges ? 3 : 2).map(([term, meaning]) => (
              <div key={term}>
                <dt className="inline font-semibold">{term}</dt>{' '}
                <dd className="inline">{meaning}</dd>
              </div>
            ))}
          </dl>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {verdict.tiles.map((figures) => (
              <Tile key={figures.pipeline} figures={figures} />
            ))}
          </div>
          {verdict.kinds.evidence_recall.length > 0 && (
            <KindChart
              kinds={verdict.kinds}
              clear={[...clear, ...judgesClear]}
            />
          )}
          {(findings.length > 0 || verdict.tested > 0 || judges) && (
            <ul className="max-w-prose list-disc space-y-3 pl-5 text-base text-text-primary">
              {clear.map((finding) => (
                <ClearItem key={findingKey(finding)} finding={finding} />
              ))}
              {verdict.tested > 0 && (
                <CountItem
                  tested={verdict.tested}
                  clear={clear.length}
                  leaning={verdict.leaning}
                />
              )}
              {judgesClear.map((finding) => (
                <ClearItem key={findingKey(finding)} finding={finding} />
              ))}
              {judges && judges.tested > 0 && (
                <CountItem
                  measure={MARK_LABEL}
                  tested={judges.tested}
                  clear={judgesClear.length}
                  leaning={judges.leaning}
                />
              )}
              {[...new Set(hints.map((f) => f.stratum))].map((stratum) => (
                <li key={`hint-${stratum}`}>
                  <strong>A pointer, not a result.</strong>{' '}
                  {`On ${KIND_WORDS[stratum] ?? stratum}, ${hints
                    .filter((f) => f.stratum === stratum)
                    .map((f, i, all) =>
                      difference(
                        f,
                        i > 0 && all[i - 1]!.metric === f.metric,
                      ).text.replace(/\.$/, ''),
                    )
                    .join(', and ')}.`}{' '}
                  {KIND_EXAMPLES[stratum]} We did not test this group, so treat
                  it as a lead to follow up.
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
          <p className="text-sm text-text-secondary">
            Read{' '}
            <a href={hrefFor('help', { section: 'lessons' })} className={LINK}>
              what the results teach
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
          countries.
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
