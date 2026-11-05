/**
 * The planted stories. At Plain each card tells its story in plain words
 * (PLAIN_STORIES), with no dataset code; at Technical it adds the scenario id
 * and the hidden truth its question describes, exactly as the bank gives it.
 * Help is the one screen that shows hidden truths. SCN-007 is the worked
 * example, told here and linked from elsewhere: its question and answer key
 * show at both levels, the answer key with its market codes as countries at
 * Plain.
 */

import { marketsInWords } from '../../app/plain-words'
import type { Question, Scenario } from './bank'
import { PLAIN_STORIES } from './copy/stories'
import { useHelpData } from './help-data'

const WORKED_EXAMPLE = 'SCN-007'

function Story({
  scenario,
  questions,
  highlighted,
}: {
  scenario: Scenario
  questions: Question[]
  highlighted: boolean
}) {
  const { level } = useHelpData()
  const technical = level === 'technical'
  const id = scenario.scenario_id
  const truths = [...new Set(questions.flatMap((q) => q.hidden_truth ?? []))]
  const isExample = id === WORKED_EXAMPLE
  const example = questions[0]
  const story = PLAIN_STORIES[id]
  return (
    <article
      id={`story-${id}`}
      aria-labelledby={`title-${id}`}
      aria-current={highlighted ? 'true' : undefined}
      className="scroll-mt-24 rounded-card border border-hairline p-4 aria-[current=true]:border-2 aria-[current=true]:border-text-primary"
    >
      <h3
        id={`title-${id}`}
        className="text-base font-semibold text-text-primary"
      >
        {scenario.title}
      </h3>
      {technical && <p className="text-sm text-text-muted">{id}</p>}
      {isExample && (
        <p className="mt-1 inline-block rounded-chip bg-surface-raised px-2 py-0.5 text-sm font-semibold text-text-primary">
          Worked example
        </p>
      )}
      {story ? (
        <p className="mt-2 text-text-primary">{story}</p>
      ) : (
        !technical && (
          <p className="mt-2">
            This story is not yet told in plain words. Choose Technical to see
            its hidden truth.
          </p>
        )
      )}
      {truths.length === 0 ? (
        <p className="mt-2">
          No question in the bank describes this story&apos;s hidden truth.
        </p>
      ) : (
        technical &&
        truths.map((truth) => (
          <p key={truth} data-api className="mt-2 break-words">
            <span className="font-semibold text-text-muted">
              Hidden truth:{' '}
            </span>
            <span className="text-text-primary">{truth}</span>
          </p>
        ))
      )}
      {isExample && example && (
        <div className="mt-3 space-y-2">
          <p>
            The question names the incident by its reference code, as the
            company&apos;s own systems do.
          </p>
          <dl className="grid grid-cols-1 gap-y-1 md:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-text-muted">Question</dt>
            <dd data-api className="break-words text-text-primary">
              {example.text}
            </dd>
            <dt className="text-text-muted">Answer key</dt>
            <dd data-api className="break-words text-text-primary">
              {technical
                ? example.expected_answer
                : marketsInWords(example.expected_answer)}
            </dd>
          </dl>
        </div>
      )}
    </article>
  )
}

export function Stories() {
  const { bank, story } = useHelpData()
  if (bank.status !== 'ready') return null
  return (
    <div className="grid grid-cols-2 gap-4">
      {bank.data.scenarios.map((scenario) => (
        <Story
          key={scenario.scenario_id}
          scenario={scenario}
          questions={bank.data.questions.filter(
            (q) => q.scenario_id === scenario.scenario_id,
          )}
          highlighted={scenario.scenario_id === story}
        />
      ))}
    </div>
  )
}
