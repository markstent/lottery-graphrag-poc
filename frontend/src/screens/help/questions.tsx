/**
 * Every benchmark question with its answer key and, when a whole-bank
 * official run backs them, each approach's scores. The two filters live in
 * the route, so a filtered table is a link. Scores are shown as the run
 * published them: a metric the question does not define reads "n/a".
 */

import { hrefFor, useRoute } from '../../app/router'
import type { Load } from '../../app/use-load'
import { plural } from '../../charts/scale'
import { PIPELINES, type PipelineId } from '../../design/pipelines'
import { STRATUM_NAMES, type Bank, type Question } from './bank'
import { Section } from './section'

const LINK = 'text-text-primary underline'
const SELECT =
  'rounded-chip border border-border bg-surface px-2 py-1 text-sm text-text-primary'
const CELL = 'border-b border-hairline px-3 py-2 align-top'

const format = (value: number | null) =>
  value === null ? 'n/a' : value.toFixed(2)

function ScoreCell({ question, id }: { question: Question; id: PipelineId }) {
  const score = question.scores?.[id]
  if (!score) return <td className={CELL}>Not scored in this run</td>
  return (
    <td className={`${CELL} whitespace-nowrap tabular-nums`}>
      <div>Answer {format(score.answer)}</div>
      <div>Evidence score {format(score.evidence_f1)}</div>
    </td>
  )
}

function Filters({
  bank,
  stratum,
  story,
  shown,
}: {
  bank: Bank
  stratum: string
  story: string
  shown: number
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
      <span className="text-text-muted">
        Showing {shown} of {plural(bank.questions.length, 'question')}
      </span>
    </div>
  )
}

export function Questions({ load }: { load: Load<Bank> }) {
  const { params } = useRoute()
  return (
    <Section id="questions" load={load}>
      {load.status === 'ready' && (
        <QuestionTable
          bank={load.data}
          stratum={params.get('stratum') ?? ''}
          story={params.get('story') ?? ''}
        />
      )}
    </Section>
  )
}

function QuestionTable({
  bank,
  stratum: wantedStratum,
  story: wantedStory,
}: {
  bank: Bank
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
  const rows = bank.questions.filter(
    (q) =>
      (stratum === '' || q.stratum === stratum) &&
      (story === '' || q.scenario_id === story),
  )
  return (
    <>
      <p>
        The answer key is the correct answer written for each question.
        {bank.scored && ' Scores come from the latest official run.'}
      </p>
      {!bank.scored && (
        <p>
          <a href={hrefFor('results')} className={LINK}>
            Go to Results
          </a>{' '}
          for the runs that have been made.
        </p>
      )}
      <Filters
        bank={bank}
        stratum={stratum}
        story={story}
        shown={rows.length}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Benchmark questions</caption>
          <thead className="text-text-muted">
            <tr>
              {['Question', 'What it tests', 'Story', 'Answer key'].map(
                (name) => (
                  <th key={name} scope="col" className={CELL}>
                    {name}
                  </th>
                ),
              )}
              {bank.scored ? (
                PIPELINES.map(({ id, label }) => (
                  <th key={id} scope="col" className={CELL}>
                    {label}
                  </th>
                ))
              ) : (
                <th scope="col" className={CELL}>
                  Scores
                </th>
              )}
            </tr>
          </thead>
          <tbody data-api className="text-text-primary">
            {rows.map((question) => (
              <tr key={question.instance_id}>
                <td className={CELL}>
                  <div>{question.text}</div>
                  <div className="text-text-muted">
                    {STRATUM_NAMES[question.stratum] ?? question.stratum}
                  </div>
                </td>
                <td className={CELL}>{question.tests}</td>
                <td className={CELL}>
                  {question.scenario_id ? (
                    <a
                      className={LINK}
                      href={hrefFor('help', {
                        section: 'stories',
                        story: question.scenario_id,
                      })}
                    >
                      {titles.get(question.scenario_id) ?? question.scenario_id}
                    </a>
                  ) : (
                    'None'
                  )}
                </td>
                <td className={CELL}>{question.expected_answer}</td>
                {bank.scored ? (
                  PIPELINES.map(({ id }) => (
                    <ScoreCell key={id} question={question} id={id} />
                  ))
                ) : (
                  <td className={`${CELL} whitespace-nowrap`}>
                    No official run yet
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
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
