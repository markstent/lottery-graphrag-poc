/**
 * The Scenarios tab: the stories planted in the synthetic world, one card
 * each, with whether the world holds it, the rows planted by table, and the
 * settings it was planted with. Each card links to its narrative and to the
 * questions that test it, both in Help. Only the catalogue's configuration
 * is shown here.
 */

import { getScenarios, type Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { count } from './model'
import { ScenariosWhy } from './why'
import { ExploreSteps } from './explore'
import { STEPS } from './explore-steps'

type Scenario = Schemas['ScenarioOut']

const LINK = 'text-sm text-text-primary underline'

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const tables = Object.entries(scenario.planted_rows)
  return (
    <article
      aria-labelledby={scenario.scenario_id}
      className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4"
    >
      <div>
        <h3
          id={scenario.scenario_id}
          className="text-base font-semibold text-text-primary"
        >
          {scenario.title}
        </h3>
        <p className="text-sm text-text-muted">{scenario.scenario_id}</p>
        {!scenario.planted && (
          <p className="mt-1 text-sm font-medium text-text-primary">
            Not planted in this world
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
        <dt className="text-text-muted">Strength</dt>
        <dd className="text-text-primary">{scenario.strength ?? 'not set'}</dd>
        <dt className="text-text-muted">Noise level</dt>
        <dd className="text-text-primary">
          {scenario.noise_level ?? 'not set'}
        </dd>
      </dl>
      {tables.length === 0 ? (
        <p className="text-sm text-text-secondary">No rows planted.</p>
      ) : (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-text-primary">
            Rows added
          </h4>
          <ul aria-label="Rows added" className="space-y-1 text-sm">
            {tables.map(([table, rows]) => (
              <li key={table} className="flex justify-between gap-4">
                <span className="text-text-secondary">{plainName(table)}</span>
                <span className="tabular-nums text-text-primary">
                  {count(rows)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1">
        <a
          href={hrefFor('help', {
            section: 'stories',
            story: scenario.scenario_id,
          })}
          className={LINK}
        >
          Read the story
        </a>
        <a
          href={hrefFor('help', {
            section: 'questions',
            story: scenario.scenario_id,
          })}
          className={LINK}
        >
          See its questions
        </a>
      </div>
    </article>
  )
}

export function ScenariosTab() {
  const load = useLoad(getScenarios, 'scenarios')
  if (load.status !== 'ready')
    return (
      <Panel
        title="Scenarios"
        state={load.status}
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      />
    )
  if (load.data.length === 0)
    return (
      <Panel
        title="Scenarios"
        state="empty"
        message="No scenarios are defined."
      />
    )
  return (
    <section aria-label="Scenarios" className="space-y-4">
      <ExploreSteps steps={STEPS.scenarios} />
      <div className="grid grid-cols-1 gap-4 min-[1400px]:grid-cols-2 min-[1800px]:grid-cols-4">
        {load.data.map((scenario) => (
          <ScenarioCard key={scenario.scenario_id} scenario={scenario} />
        ))}
      </div>
      <ScenariosWhy />
    </section>
  )
}
