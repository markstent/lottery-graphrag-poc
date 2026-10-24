/**
 * Every benchmark question with its answer key and, when a whole-bank
 * official run backs them, each approach's scores. A question is a header
 * row, with one row below it for each instance (its anchor): scores are
 * those of the instance and are never averaged here. The two filters live in
 * the route, so a filtered table is a link. Scores read as on Live Lab.
 */

import { answerWords, evidenceScore } from '../../app/score-words'
import { hrefFor, useRoute } from '../../app/router'
import type { Load } from '../../app/use-load'
import { plural } from '../../charts/scale'
import { PIPELINES, type PipelineId } from '../../design/pipelines'
import {
  STRATUM_NAMES,
  type Bank,
  type Question,
  type ScoreState,
} from './bank'
import { Section } from './section'

const LINK = 'text-text-primary underline'
const SELECT =
  'rounded-chip border border-border bg-surface px-2 py-1 text-sm text-text-primary'
const CELL = 'border-b border-hairline px-3 py-2 align-top'
const NO_RUN = 'No official run yet'

const LABELS = {
  none: NO_RUN,
  unreadable: 'Scores could not be read',
  loading: 'Scores are loading',
}

const counted = (questions: number, instances: number) =>
  `${plural(questions, 'question')}, ${plural(instances, 'instance')}`

function ScoreCell({
  question,
  id,
  state,
}: {
  question: Question
  id: PipelineId
  state: ScoreState
}) {
  if (state !== 'shown')
    return (
      <td className={CELL}>
        <span className="sr-only">
          {LABELS[state as Exclude<ScoreState, 'shown'>]}
        </span>
      </td>
    )
  const score = question.scores?.[id]
  if (!score) return <td className={CELL}>Not scored in this run</td>
  return (
    <td className={`${CELL} whitespace-nowrap tabular-nums`}>
      <div>Answer: {answerWords(score.answer)}</div>
      <div>Evidence score: {evidenceScore(score.evidence_f1)}</div>
    </td>
  )
}

function Filters({
  bank,
  stratum,
  story,
  summary,
}: {
  bank: Bank
  stratum: string
  story: string
  summary: string
}) {
  const strata = [...new Set(bank.questions.map((q) => q.stratum))].sort()
  const go = (next: { stratum: string; story: string }) => {
    const params: Record<string, string> = { section: 'questions' }
    if (next.stratum) params.stratum = next.stratum
    if (next.story) params.story = next.story
    window.location.hash = hrefFor('help', params)
  }
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <label className="flex items-center gap-2 text-text-secondary">
        Kind of question
        <select
          className={SELECT}
          value={stratum}
          onChange={(event) => go({ stratum: event.target.value, story })}
        >
          <option value="">All kinds</option>
          {strata.map((id) => (
            <option key={id} value={id}>
              {STRATUM_NAMES[id] ?? id}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-text-secondary">
        Story
        <select
          className={SELECT}
          value={story}
          onChange={(event) => go({ stratum, story: event.target.value })}
        >
          <option value="">All stories</option>
          {bank.scenarios.map((s) => (
            <option key={s.scenario_id} value={s.scenario_id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <span className="text-text-muted">{summary}</span>
    </div>
  )
}

export function Questions({
  load,
  scores,
}: {
  load: Load<Bank>
  scores: ScoreState
}) {
  const { params } = useRoute()
  return (
    <Section id="questions" load={load}>
      {load.status === 'ready' && (
        <QuestionTable
          bank={load.data}
          scores={scores}
          stratum={params.get('stratum') ?? ''}
          story={params.get('story') ?? ''}
        />
      )}
    </Section>
  )
}

function QuestionTable({
  bank,
  scores,
  stratum: wantedStratum,
  story: wantedStory,
}: {
  bank: Bank
  scores: ScoreState
  stratum: string
  story: string
}) {
  // A kind or story the bank does not have is ignored, not an empty table.
  const stratum = bank.questions.some((q) => q.stratum === wantedStratum)
    ? wantedStratum
    : ''
  const story = bank.scenarios.some((s) => s.scenario_id === wantedStory)
    ? wantedStory
    : ''
  const titles = new Map(bank.scenarios.map((s) => [s.scenario_id, s.title]))
  const groups = (list: Question[]) => {
    const byId = new Map<string, Question[]>()
    for (const q of list)
      byId.set(q.question_id, [...(byId.get(q.question_id) ?? []), q])
    return [...byId.values()]
  }
  const shown = groups(
    bank.questions.filter(
      (q) =>
        (stratum === '' || q.stratum === stratum) &&
        (story === '' || q.scenario_id === story),
    ),
  )
  const total = counted(groups(bank.questions).length, bank.questions.length)
  const shownCount = counted(
    shown.length,
    shown.reduce((sum, group) => sum + group.length, 0),
  )
  const columns = 2 + PIPELINES.length
  return (
    <>
      <p>
        The answer key is the correct answer written for each question.
        {scores === 'shown' && ' Scores come from the latest official run.'}
      </p>
      {(scores === 'none' || scores === 'unreadable') && (
        <p>
          {scores === 'none'
            ? `${NO_RUN}. Scores appear after a full official run. `
            : 'The latest run could not be read, so scores are hidden. '}
          <a href={hrefFor('results')} className={LINK}>
            Go to Results
          </a>
        </p>
      )}
      <Filters
        bank={bank}
        stratum={stratum}
        story={story}
        summary={
          shownCount === total ? total : `Showing ${shownCount} of ${total}`
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Benchmark questions</caption>
          <thead className="text-text-muted">
            <tr>
              <th scope="col" className={CELL}>
                Instance
              </th>
              <th scope="col" className={CELL}>
                Answer key
              </th>
              {PIPELINES.map(({ id, label }) => (
                <th
                  key={id}
                  scope="col"
                  className={`${CELL} whitespace-nowrap`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {shown.map((group) => {
            const head = group[0]
            return (
              <tbody
                key={head.question_id}
                data-api
                className="text-text-primary"
              >
                <tr className="bg-surface-raised">
                  <th
                    scope="rowgroup"
                    colSpan={columns}
                    className={`${CELL} font-normal`}
                  >
                    <span className="font-semibold">{head.question_id}</span>
                    {' · '}
                    {STRATUM_NAMES[head.stratum] ?? head.stratum}
                    {' · '}
                    {head.tests}
                    {head.scenario_id && (
                      <>
                        {' · Story: '}
                        <a
                          className={LINK}
                          href={hrefFor('help', {
                            section: 'stories',
                            story: head.scenario_id,
                            ...(stratum && { stratum }),
                          })}
                        >
                          {titles.get(head.scenario_id) ?? head.scenario_id}
                        </a>
                      </>
                    )}
                  </th>
                </tr>
                {group.map((question) => (
                  <tr key={question.instance_id}>
                    <td className={CELL}>{question.text}</td>
                    <td className={CELL}>{question.expected_answer}</td>
                    {PIPELINES.map(({ id }) => (
                      <ScoreCell
                        key={id}
                        question={question}
                        id={id}
                        state={scores}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>
      {shown.length === 0 && (
        <p>
          No question matches these filters.{' '}
          <a href={hrefFor('help', { section: 'questions' })} className={LINK}>
            Clear the filters
          </a>
        </p>
      )}
    </>
  )
}
