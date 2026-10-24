/**
 * The planted stories: each scenario with the hidden truth its question
 * describes, exactly as the bank gives it. Help is the one screen that shows
 * hidden truths. SCN-007 is the worked example, told here and linked from
 * elsewhere.
 */

import type { Load } from '../../app/use-load'
import type { Bank, Question, Scenario } from './bank'
import { Section } from './section'

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
  const id = scenario.scenario_id
  const truths = [...new Set(questions.flatMap((q) => q.hidden_truth ?? []))]
  const isExample = id === WORKED_EXAMPLE
  const example = questions[0]
  return (
    <article
      id={`story-${id}`}
      aria-labelledby={`title-${id}`}
      aria-current={highlighted ? 'true' : undefined}
      className="scroll-mt-4 rounded-card border border-hairline p-4 aria-[current=true]:border-2 aria-[current=true]:border-text-primary"
    >
      <h3
        id={`title-${id}`}
        className="text-base font-semibold text-text-primary"
      >
        {scenario.title}
      </h3>
      <p className="text-sm text-text-muted">{id}</p>
      {isExample && (
        <p className="mt-1 inline-block rounded-chip bg-surface-raised px-2 py-0.5 text-sm font-semibold text-text-primary">
          Worked example
        </p>
      )}
      {truths.length === 0 ? (
        <p className="mt-2">
          No question in the bank describes this story&apos;s hidden truth.
        </p>
      ) : (
        truths.map((truth) => (
          <p key={truth} data-api className="mt-2 text-text-primary">
            {truth}
          </p>
        ))
      )}
      {isExample && example && (
        <div className="mt-3 space-y-2">
          <p>
            A correct answer names the markets that shared the platform version
            with the incident, and the market that did not.
          </p>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-text-muted">Question</dt>
            <dd data-api className="text-text-primary">
              {example.text}
            </dd>
            <dt className="text-text-muted">Answer key</dt>
            <dd data-api className="text-text-primary">
              {example.expected_answer}
            </dd>
          </dl>
        </div>
      )}
    </article>
  )
}

export function Stories({
  load,
  story,
}: {
  load: Load<Bank>
  /** The story a link pointed at, to mark. */
  story: string | null
}) {
  return (
    <Section id="stories" load={load}>
      {load.status === 'ready' && (
        <>
          <p>
            Each story is planted in the data on purpose. The hidden truth says
            what was planted, so the answer key is known.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {load.data.scenarios.map((scenario) => (
              <Story
                key={scenario.scenario_id}
                scenario={scenario}
                questions={load.data.questions.filter(
                  (q) => q.scenario_id === scenario.scenario_id,
                )}
                highlighted={scenario.scenario_id === story}
              />
            ))}
          </div>
        </>
      )}
    </Section>
  )
}
