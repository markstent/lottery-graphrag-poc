/**
 * Scenario Lab (docs/06 section 12): the scenario catalogue with blind-mode
 * handling. Planted specifics are never shown; only configuration metadata
 * and observable signals.
 */

import { useState } from 'react'

import { SCENARIO_CATALOGUE } from '../mock/content'

export function ScenarioLab() {
  const [selectedId, setSelectedId] = useState<string | null>('SCN-007')
  const selected = SCENARIO_CATALOGUE.find(
    (scenario) => scenario.id === selectedId,
  )

  return (
    <div className="space-y-4">
      <section
        aria-label="Scenario header"
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg">Scenario Lab</h2>
            <p className="text-xs text-text-muted">
              Planted patterns and observable signals · blind benchmark mode
              hides evaluator truth
            </p>
          </div>
          <a
            href="#/experiment"
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors duration-micro hover:text-text-primary"
          >
            ← Back to Setup
          </a>
        </div>
      </section>

      <section
        aria-label="Blind mode notice"
        className="rounded-card border border-warning/50 bg-surface p-3"
      >
        <p className="text-xs text-warning">
          Blind benchmark mode is on: planted scenario specifics are hidden.
          Retrieval systems and benchmark runs never see the truth ledger
          (ADR-008).
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          aria-label="Scenario catalogue"
          className="rounded-card border border-border bg-surface p-4"
        >
          <h2 className="mb-3 text-lg">Scenario catalogue</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {SCENARIO_CATALOGUE.map((scenario) => (
              <li key={scenario.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(scenario.id)}
                  aria-current={scenario.id === selectedId ? 'true' : undefined}
                  className={`h-full w-full rounded-card border p-3 text-left transition-colors duration-micro ${
                    scenario.id === selectedId
                      ? 'border-graph/60 bg-surface-raised'
                      : 'border-border bg-surface hover:border-graph/40'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {scenario.id}
                    </span>
                    <span
                      className={`rounded-chip px-2 py-0.5 text-xs ${
                        scenario.enabled
                          ? 'bg-success/15 text-success'
                          : 'bg-surface-raised text-text-muted'
                      }`}
                    >
                      {scenario.enabled ? 'enabled' : 'registered'}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-text-secondary">
                    {scenario.type.replace(/_/g, ' ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label="Scenario detail"
          className="rounded-card border border-border bg-surface p-4"
        >
          <h2 className="mb-3 text-lg">Detail</h2>
          {selected ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-text-muted">Identifier</dt>
                <dd className="text-text-primary">{selected.id}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Description</dt>
                <dd className="text-text-secondary">{selected.description}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Strength</dt>
                <dd className="text-text-secondary">
                  {selected.strength.toFixed(1)} (signal intensity)
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Status</dt>
                <dd
                  className={
                    selected.enabled ? 'text-success' : 'text-text-muted'
                  }
                >
                  {selected.enabled
                    ? 'Enabled: the dev world plants this scenario deterministically.'
                    : 'Registered but disabled: enabling requires an injector implementation.'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Truth</dt>
                <dd className="text-text-muted">
                  Hidden in blind mode. Observable signals only are documented
                  in the catalogue.
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-text-muted">Select a scenario.</p>
          )}
        </section>
      </div>
    </div>
  )
}
