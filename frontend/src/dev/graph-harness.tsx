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
 */

import { useMemo, useState } from 'react'

import type { components } from '../api/schema'
import { EvidencePathList } from '../graph/evidence-path-list'
import { recordedPathsFromResult } from '../graph/from-result'
import { GraphCanvas } from '../graph/graph-canvas'
import { GraphLegend } from '../graph/graph-legend'
import { DEFAULT_VISIBLE_NODE_CAP, graphView } from '../graph/model'
import { reduceAll, type RunEvent } from '../run/reduce'
import recordedRun from '../run/fixtures/run-abc.json'
import generated from './fixtures/graph-200.json'

type GraphRunResult = components['schemas']['GraphRunResult']

export default function GraphHarness() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const generatedRun = params.get('source') === '200'
  // The generated run holds configuration C only.
  const config = generatedRun || params.get('config') !== 'B' ? 'C' : 'B'
  const run = generatedRun ? generated : recordedRun
  const events = run.events as unknown as RunEvent[]
  const result = (
    run.results.results as unknown as Record<string, GraphRunResult>
  )[config]
  const [count, setCount] = useState(
    Number(params.get('count') ?? events.length),
  )
  const [focus, setFocus] = useState(params.get('focus') === '1')
  const [opened, setOpened] = useState<string | null>(null)
  const [shown, setShown] = useState(params.get('mount') !== 'click')
  const presentation = params.get('present') === '1'
  const cap = Number(params.get('cap') ?? DEFAULT_VISIBLE_NODE_CAP)

  // C is drawn against B, so what the ontology added shows. The generated
  // run has no B of its own.
  const viewAt = useMemo(() => {
    const recordedEvents = recordedRun.events as unknown as RunEvent[]
    const paths = recordedPathsFromResult(result)
    return (upTo: number) =>
      graphView(reduceAll(events.slice(0, upTo)).graph[config], {
        cap,
        focus,
        overlay:
          config === 'C' && !generatedRun
            ? reduceAll(recordedEvents.slice(0, upTo)).graph.B
            : undefined,
        paths,
      })
  }, [events, cap, focus, config, result, generatedRun])
  const view = useMemo(() => viewAt(count), [viewAt, count])
  const finalView = useMemo(() => viewAt(events.length), [viewAt, events])
  const live = params.get('mode') === 'live'
  const hasOverlay = config === 'C' && !generatedRun

  return (
    <main className="flex h-screen flex-col gap-3 bg-background p-4">
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
              pipeline={config}
              label={`Graph for configuration ${config}`}
              pathListId="harness-paths"
            />
          ) : null}
        </div>
        <aside className="w-96 overflow-auto rounded-card border border-border bg-surface p-3">
          <EvidencePathList id="harness-paths" view={view} />
        </aside>
      </div>
      <GraphLegend pipeline={config} ontologyAdded={hasOverlay} />
    </main>
  )
}
