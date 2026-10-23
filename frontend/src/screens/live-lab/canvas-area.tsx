/**
 * The large graph canvas of Live Lab: B or C by tab, drawn from the run state
 * as far as the replay or the stream has got. C marks what its own events
 * record as added by the ontology, compared with B at the same point; the
 * other approach's evidence path can be laid over either graph; focus mode
 * dims what is off the evidence path. A recorded run is drawn as a replay (its
 * final graph sets the layout); a live run grows with its stream.
 */

import { useId, useMemo, useState, type KeyboardEvent } from 'react'

import type { Schemas } from '../../api/client'
import { useSettings } from '../../app/use-settings'
import { pipeline } from '../../design/pipelines'
import { EvidencePathList } from '../../graph/evidence-path-list'
import { GraphCanvas } from '../../graph/graph-canvas'
import { GraphLegend } from '../../graph/graph-legend'
import { countedLabel } from '../../design/node-labels'
import type { RunState } from '../../run/reduce'
import { otherOf, pipelineView, type GraphPipeline } from './graph-views'

const TABS: readonly GraphPipeline[] = ['B', 'C']

export interface FoldedGroup {
  /** "Group of 12 incident types". */
  title: string
  members: { id: string; label: string }[]
}

/**
 * The drawing's height: what is left of the window once the question bar,
 * the legend and the timeline have their room. It grows with a taller window
 * up to a limit and never drops below a readable floor. At 1920 by 1080 the
 * floor applies, so the timeline's controls sit a little below the first screen.
 */
const HEIGHT = 'clamp(26rem, calc(100vh - 46rem), 46rem)'
const PRESENTATION_HEIGHT = 'clamp(30rem, calc(100vh - 42rem), 54rem)'

const TOGGLE =
  'rounded-chip border border-border bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-grey-900 aria-pressed:bg-grey-900 aria-pressed:text-surface'

export function CanvasArea({
  state,
  finalState,
  results,
  mode,
  settled,
  onOpenNode,
  onOpenGroup,
}: {
  /** The run as far as the replay or stream has got. */
  state: RunState
  /** The run at its end, for a replay's layout; null while a live run is still arriving. */
  finalState: RunState | null
  results: Schemas['QueryResults'] | null
  mode: 'replay' | 'live'
  /** A live stream has ended, so the final graph is laid out whole. */
  settled: boolean
  onOpenNode: (pipeline: GraphPipeline, nodeId: string) => void
  /** A group of folded nodes was opened: its recorded members, by id and kind. */
  onOpenGroup: (pipeline: GraphPipeline, group: FoldedGroup) => void
}) {
  const { nodeCap, presentation, reducedMotion } = useSettings()
  const [tab, setTab] = useState<GraphPipeline>('B')
  const [focus, setFocus] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const ids = useId()
  const pathListId = `${ids}-paths`
  const other = otherOf(tab)
  const { label } = pipeline(tab)

  // The other path can be shown once its pipeline has recorded it and the
  // run's results, which hold the paths, have been read.
  const canOverlay =
    results !== null && state.graph[other].evidencePath !== null
  const whyNot =
    results === null
      ? 'Available when the run has ended.'
      : `${other}'s evidence path is not recorded yet.`
  const showOther = overlay && canOverlay

  const view = useMemo(
    () =>
      pipelineView({
        state,
        results,
        id: tab,
        cap: nodeCap,
        focus,
        showOther,
      }),
    [state, results, tab, nodeCap, focus, showOther],
  )
  const finalView = useMemo(
    () =>
      finalState &&
      pipelineView({
        state: finalState,
        results,
        id: tab,
        cap: nodeCap,
        focus,
        showOther,
      }),
    [finalState, results, tab, nodeCap, focus, showOther],
  )

  const move = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = tab === 'B' ? 'C' : 'B'
    setTab(next)
    document.getElementById(`${ids}-tab-${next}`)?.focus()
  }

  const marksOntology = tab === 'C' && view.nodes.some((n) => n.addedByOntology)
  const settledView = mode === 'live' && settled
  const canvasProps = {
    view,
    onSelectNode: (id: string) => {
      const group = (finalView ?? view).clusters.find((c) => c.id === id)
      if (!group) return onOpenNode(tab, id)
      // Only members already drawn are recorded so far in a replay.
      const present = new Map(view.nodes.map((n) => [n.id, n]))
      onOpenGroup(tab, {
        title: `Group of ${countedLabel(group.members.filter((m) => present.has(m)).length, group.label)}`,
        members: group.members.flatMap((m) => {
          const node = present.get(m)
          return node ? [{ id: m, label: node.label }] : []
        }),
      })
    },
    focusMode: focus,
    presentation,
    reducedMotion,
    pipeline: tab,
    otherPipeline: showOther ? other : undefined,
    label: `Graph for ${label}`,
    pathListId,
  }

  return (
    <section aria-label="Graph canvas" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Graph of"
          className="flex gap-1"
          onKeyDown={move}
        >
          {TABS.map((id) => {
            const selected = id === tab
            const { label: name, tint, strong } = pipeline(id)
            return (
              <button
                key={id}
                id={`${ids}-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${ids}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                className="rounded-chip border px-3 py-1 text-base font-semibold"
                style={{
                  backgroundColor: selected ? tint : undefined,
                  borderColor: selected ? strong : 'var(--color-border)',
                  color: strong,
                }}
              >
                {name}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={showOther}
            disabled={!canOverlay}
            onClick={() => setOverlay(!overlay)}
            className={TOGGLE}
          >
            {`Show ${other}'s evidence path`}
          </button>
          {!canOverlay && (
            <span className="text-sm text-text-secondary">{whyNot}</span>
          )}
          <button
            type="button"
            aria-pressed={focus}
            onClick={() => setFocus(!focus)}
            className={TOGGLE}
          >
            Focus on the evidence path
          </button>
        </div>
      </div>
      <div
        id={`${ids}-panel`}
        role="tabpanel"
        aria-labelledby={`${ids}-tab-${tab}`}
        style={{ height: presentation ? PRESENTATION_HEIGHT : HEIGHT }}
      >
        {mode === 'replay' && finalView ? (
          <GraphCanvas
            key={tab}
            {...canvasProps}
            mode="replay"
            finalView={finalView}
          />
        ) : (
          <GraphCanvas
            key={tab}
            {...canvasProps}
            mode="live"
            settled={settledView}
          />
        )}
      </div>
      {showOther && view.otherPathMissing.length > 0 && (
        <p className="text-sm text-text-secondary">
          {`${countedLabel(view.otherPathMissing.length, 'step')} of ${other}'s evidence path ${view.otherPathMissing.length === 1 ? 'is' : 'are'} not in this graph.`}
        </p>
      )}
      <GraphLegend
        pipeline={tab}
        ontologyAdded={marksOntology}
        otherPath={showOther ? other : undefined}
      />
      {/* The text alternative to the picture; the path strip below shows the same paths. */}
      <div className="sr-only">
        <EvidencePathList
          id={pathListId}
          view={view}
          ended={state.pipelines[tab].status !== 'running'}
        />
      </div>
    </section>
  )
}
