/**
 * Development page for the graph canvas, at `#/__graph`. It exists for the
 * end-to-end specs and for looking at the canvas, and is left out of the
 * production build. Query parameters:
 *   source   abc (the recorded run, default) or 200 (the generated 200-node fixture)
 *   config   B or C (default C)
 *   count    events applied (default all)
 *   cap      visible-node cap (default the model's cap)
 *   focus    1 for focus mode
 *   present  1 for presentation mode
 *   mount    click to draw the canvas only when "Show graph" is pressed
 *   mode     replay (default) or live
 *   evidence 1 to open the evidence drawer on the node opened from the canvas
 *   shell    1 to draw the page inside the application shell
 * The gallery (gallery.tsx) draws this same page, in a box of its own, once
 * per state, passing the parameters as `query`.
 */

import { useEffect, useId, useMemo, useState } from 'react'

import { Shell } from '../app/shell'
import { useSettings } from '../app/use-settings'
import { EvidenceDrawer } from '../components/evidence-drawer'
import { EvidencePathList } from '../graph/evidence-path-list'
import { GraphCanvas } from '../graph/graph-canvas'
import { GraphLegend } from '../graph/graph-legend'
import { DEFAULT_VISIBLE_NODE_CAP } from '../graph/model'
import { type RunEvent } from '../run/reduce'
import {
  RECORDED_RUN,
  fixtureView,
  loadGeneratedRun,
  type FixtureRun,
} from './fixture-view'

export default function GraphHarness({ query }: { query?: string }) {
  const params = new URLSearchParams(
    query ?? window.location.hash.split('?')[1] ?? '',
  )
  const generatedRun = params.get('source') === '200'
  const [generated, setGenerated] = useState<FixtureRun | null>(null)
  useEffect(() => {
    if (!generatedRun) return
    let current = true
    void loadGeneratedRun().then((run) => {
      if (current) setGenerated(run)
    })
    return () => {
      current = false
    }
  }, [generatedRun])
  const run = generatedRun ? generated : RECORDED_RUN
  // The generated run is fetched on demand, so the page is empty until it is here.
  return run ? <Harness run={run} query={query} /> : null
}

function Harness({ run, query }: { run: FixtureRun; query?: string }) {
  // Without a query the page is the whole screen and reads the hash.
  const embedded = query !== undefined
  const { reducedMotion } = useSettings()
  const params = new URLSearchParams(
    query ?? window.location.hash.split('?')[1] ?? '',
  )
  const generatedRun = params.get('source') === '200'
  // The generated run holds configuration C only.
  const config = generatedRun || params.get('config') !== 'B' ? 'C' : 'B'
  const events = run.events as unknown as RunEvent[]
  const pathListId = useId()
  const [count, setCount] = useState(
    Number(params.get('count') ?? events.length),
  )
  const [focus, setFocus] = useState(params.get('focus') === '1')
  const [opened, setOpened] = useState<string | null>(null)
  const [shown, setShown] = useState(params.get('mount') !== 'click')
  const presentation = params.get('present') === '1'
  const cap = Number(params.get('cap') ?? DEFAULT_VISIBLE_NODE_CAP)

  const viewAt = useMemo(
    () => (upTo: number) =>
      fixtureView({
        run,
        config,
        upTo,
        cap,
        focus,
      }),
    [run, cap, focus, config],
  )
  const view = useMemo(() => viewAt(count), [viewAt, count])
  const finalView = useMemo(() => viewAt(events.length), [viewAt, events])
  const live = params.get('mode') === 'live'
  const hasOverlay = config === 'C' && !generatedRun

  const inShell = params.get('shell') === '1'
  const page = (
    <div
      className={`flex flex-col gap-3 bg-background p-4 ${
        presentation ? 'presentation' : ''
      } ${embedded ? 'h-[56rem]' : inShell ? 'h-[calc(100vh-8rem)]' : 'h-screen'}`}
    >
      <header className="flex flex-wrap items-center gap-4 text-sm">
        <h1 className="font-semibold">Graph canvas</h1>
        <button
          type="button"
          className="rounded-chip border border-border bg-surface px-3 py-1"
          onClick={() => setShown(true)}
        >
          Show graph
        </button>
        <button
          type="button"
          aria-pressed={focus}
          className="rounded-chip border border-border bg-surface px-3 py-1 aria-pressed:bg-grey-900 aria-pressed:text-surface"
          onClick={() => setFocus((on) => !on)}
        >
          Focus mode
        </button>
        <label className="flex items-center gap-2">
          Events applied
          <input
            type="range"
            min={0}
            max={events.length}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
          <span className="tabular">{count}</span>
        </label>
        <span role="status">
          {opened ? `Opened ${opened}` : 'Nothing opened'}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1">
          {shown ? (
            <GraphCanvas
              {...(live
                ? { mode: 'live' as const, settled: count === events.length }
                : { mode: 'replay' as const, finalView })}
              view={view}
              onSelectNode={setOpened}
              focusMode={focus}
              presentation={presentation}
              reducedMotion={reducedMotion}
              pipeline={config}
              label={`Graph for configuration ${config}`}
              pathListId={pathListId}
            />
          ) : null}
        </div>
        <aside className="w-96 overflow-auto rounded-card border border-border bg-surface p-3">
          <EvidencePathList
            id={pathListId}
            view={view}
            ended={count === events.length}
          />
        </aside>
      </div>
      <GraphLegend pipeline={config} ontologyAdded={hasOverlay} />
      {params.get('evidence') === '1' && (
        <EvidenceDrawer
          source={opened ? { kind: 'node', nodeId: opened } : null}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
  if (embedded) return page
  return inShell ? <Shell>{page}</Shell> : <main>{page}</main>
}
