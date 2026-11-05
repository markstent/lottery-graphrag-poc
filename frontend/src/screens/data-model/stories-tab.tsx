/**
 * The Stories tab (D-115): the stories planted in the synthetic world on the
 * explorer layout. Choose a story on the left, read what was planted in the
 * middle (its description, how strong, how noisy, the rows it added by
 * table), and go on to Help on the right. The story is in the address
 * (`tab=stories&story=<id>`); with none the first opens. Only the catalogue's
 * configuration is shown here: no row of the world is named.
 */

import { ArrowRight } from 'lucide-react'

import { getScenarios, type Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { SCENARIOS_ABOUT } from './about-copy'
import { AboutContent } from './about'
import { Explorer, NEXT_STEP, PickList } from './explorer'
import { count } from './model'

type Scenario = Schemas['ScenarioOut']

const STEPS = ['Choose a story', 'What was planted', 'Where next'] as const

const choose = (story: string) => {
  window.location.hash = hrefFor('data-model', { tab: 'stories', story })
}

function Planted({ scenario }: { scenario: Scenario }) {
  const tables = Object.entries(scenario.planted_rows)
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">
          {scenario.title}
        </h3>
        <p className="text-sm text-text-muted">{scenario.scenario_id}</p>
        {!scenario.planted && (
          <p className="mt-1 text-sm font-medium text-text-primary">
            Not planted in this world
          </p>
        )}
      </div>
      <p className="text-sm text-text-primary">{scenario.description}</p>
      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt className="text-text-muted">Strength</dt>
        <dd className="text-text-primary">
          {scenario.strength ?? 'not set'}
          <span className="block text-text-secondary">
            How clear the signal is, from 0.2 subtle to 1.0 obvious.
          </span>
        </dd>
        <dt className="text-text-muted">Noise level</dt>
        <dd className="text-text-primary">
          {scenario.noise_level ?? 'not set'}
        </dd>
      </dl>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-text-primary">Rows added</h4>
        {tables.length === 0 ? (
          <p className="text-sm text-text-secondary">No rows added.</p>
        ) : (
          <ul aria-label="Rows added" className="space-y-1 text-sm">
            {tables.map(([table, rows]) => (
              <li key={table} className="flex justify-between gap-4">
                <span className="text-text-secondary">{plainName(table)}</span>
                <span className="text-text-primary tabular-nums">
                  {count(rows)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function WhereNext({ story }: { story: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Help tells what happened in plain words and lists the test questions
        that ask about it.
      </p>
      <div className="flex flex-col items-start gap-2">
        <a
          href={hrefFor('help', { section: 'stories', story })}
          className={NEXT_STEP}
        >
          Read the full story
          <ArrowRight aria-hidden size={16} />
        </a>
        <a
          href={hrefFor('help', { section: 'questions', story })}
          className={NEXT_STEP}
        >
          See its questions
          <ArrowRight aria-hidden size={16} />
        </a>
      </div>
    </div>
  )
}

export function StoriesTab({ params }: { params: URLSearchParams }) {
  const load = useLoad(getScenarios, 'scenarios')
  if (load.status !== 'ready')
    return (
      <Panel
        title="Stories"
        state={load.status}
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      />
    )
  if (load.data.length === 0)
    return (
      <Panel title="Stories" state="empty" message="No stories are defined." />
    )
  const scenario =
    load.data.find((s) => s.scenario_id === params.get('story')) ?? load.data[0]
  return (
    <Explorer
      steps={STEPS}
      about={<AboutContent copy={SCENARIOS_ABOUT} />}
      list={
        <PickList
          label="Search stories"
          searchable={false}
          chosen={scenario.scenario_id}
          onChoose={choose}
          groups={[
            {
              items: load.data.map((s) => ({
                id: s.scenario_id,
                title: s.title,
                detail: s.strength === null ? undefined : String(s.strength),
              })),
            },
          ]}
        />
      }
      main={<Planted scenario={scenario} />}
      detail={<WhereNext story={scenario.scenario_id} />}
    />
  )
}
