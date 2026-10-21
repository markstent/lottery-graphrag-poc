/**
 * Settings: the numbers, versions and model names the experiment ran with,
 * shown as data, and the two preferences kept in this browser.
 */

import { useState } from 'react'

import { getDataset, getModels, getOntology, listDatasets } from '../api/client'
import { Drawer } from '../components/drawer'
import { Panel } from '../components/panel'
import { useLoad } from './use-load'
import { NODE_CAP_MAX, NODE_CAP_MIN, useSettings } from './use-settings'

const MODEL_LABELS = {
  generation: 'Answer model',
  embedding: 'Embedding model',
  rerank: 'Re-ordering model',
  sparse: 'Keyword search model',
} as const

const REACHABLE = {
  true: 'Reachable',
  false: 'Not reachable',
  null: 'Not checked',
} as const

async function loadSettings(signal: AbortSignal) {
  const active = (await listDatasets(signal)).find((dataset) => dataset.active)
  const [detail, models, ontology] = await Promise.all([
    active ? getDataset(active.dataset_id, signal) : null,
    getModels(signal),
    getOntology(signal),
  ])
  return { detail, models, ontology }
}

function Row({ term, children }: { term: string; children: string | number }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-x-4 text-sm">
      <dt className="text-text-muted">{term}</dt>
      <dd className="tabular min-w-0 break-words text-text-primary">
        {children}
      </dd>
    </div>
  )
}

function Values() {
  const load = useLoad(loadSettings, 'settings')

  return (
    <Panel
      title="World and models"
      state={load.status}
      error={load.status === 'error' ? load.error : undefined}
      onRetry={load.retry}
    >
      {load.status === 'ready' && (
        <div className="space-y-4">
          <dl className="space-y-2">
            {load.data.detail ? (
              <>
                <Row term="World number">
                  {load.data.detail.summary.world_seed}
                </Row>
                <Row term="Scenario number">
                  {load.data.detail.summary.scenario_seed}
                </Row>
                <Row term="Generator version">
                  {load.data.detail.summary.generator_version}
                </Row>
                {load.data.detail.index_status && (
                  <Row term="Index record version">
                    {load.data.detail.index_status.serialiser_version}
                  </Row>
                )}
              </>
            ) : (
              <p className="text-sm text-text-secondary">No active dataset.</p>
            )}
            <Row term="Ontology version">{load.data.ontology.version}</Row>
          </dl>
          <dl className="space-y-2">
            {(Object.keys(MODEL_LABELS) as (keyof typeof MODEL_LABELS)[]).map(
              (role) => {
                const model = load.data.models[role]
                return (
                  <Row key={role} term={MODEL_LABELS[role]}>
                    {`${model.model} (${model.provider}), ${REACHABLE[String(model.reachable) as keyof typeof REACHABLE]}`}
                  </Row>
                )
              },
            )}
          </dl>
        </div>
      )}
    </Panel>
  )
}

function Preferences() {
  const { reducedMotion, toggleReducedMotion, nodeCap, setNodeCap } =
    useSettings()
  // What is typed, until the field is left: the stored cap is always in range.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <Panel title="Preferences" state="ready">
      <div className="space-y-4 text-sm">
        <label className="flex items-center gap-2 text-text-primary">
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={toggleReducedMotion}
          />
          Reduce motion
        </label>
        <div>
          <label className="flex items-center gap-2 text-text-primary">
            Visible nodes
            <input
              type="number"
              min={NODE_CAP_MIN}
              max={NODE_CAP_MAX}
              step={1}
              value={draft ?? nodeCap}
              onChange={(event) => {
                setDraft(event.target.value)
                if (event.target.value !== '')
                  setNodeCap(Number(event.target.value))
              }}
              onBlur={() => setDraft(null)}
              className="tabular w-20 rounded-chip border border-border px-2 py-1"
            />
          </label>
          <p className="mt-1 text-text-secondary">
            Graph nodes drawn before the rest are grouped. From {NODE_CAP_MIN}{' '}
            to {NODE_CAP_MAX}.
          </p>
        </div>
      </div>
    </Panel>
  )
}

export function SettingsDrawer() {
  const { settingsOpen, setSettingsOpen } = useSettings()
  return (
    <Drawer
      open={settingsOpen}
      title="Settings"
      onClose={() => setSettingsOpen(false)}
    >
      <Preferences />
      <Values />
    </Drawer>
  )
}
