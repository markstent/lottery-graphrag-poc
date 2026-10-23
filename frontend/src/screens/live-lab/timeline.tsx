/**
 * The run on a time axis: one track per pipeline with its steps as bars, a
 * marker at the position shown, and the controls that move it. A track that
 * has not started is empty, never filled in ahead of the run.
 */

import { Pause, Play, RotateCcw, SkipBack } from 'lucide-react'

import { PIPELINES } from '../../design/pipelines'
import type { RunState } from '../../run/reduce'
import type { Speed } from '../../run/replay'
import { STAGE_LABELS } from './columns'
import { formatDuration } from './format'
import { assignRows, trackSegments, type PlacedSegment } from './tracks'
import type {
  Timeline as TimelineValue,
  TimelineControls,
} from './use-live-run'

const SPEEDS: readonly Speed[] = [0.5, 1, 2, 4]

/** Steps that ran together sit on thin rows under the main row, so no bar is trimmed. */
const MAIN_ROW_PX = 16
const EXTRA_ROW_PX = 8

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50'

function summary(label: string, segments: PlacedSegment[]): string {
  if (segments.length === 0) return `${label}: not started`
  const end = Math.max(...segments.map((segment) => segment.to))
  return `${label}: ${segments.length} steps, from ${formatDuration(segments[0].from)} to ${formatDuration(end)}`
}

function Bar({
  segment,
  total,
  hue,
}: {
  segment: PlacedSegment
  total: number
  hue: string
}) {
  const stopped = segment.status === 'failed' || segment.status === 'cancelled'
  return (
    <span
      title={`${STAGE_LABELS[segment.stage]}: ${formatDuration(segment.to - segment.from)}, from ${formatDuration(segment.from)} to ${formatDuration(segment.to)}`}
      className="absolute rounded-chip"
      style={{
        top:
          segment.row === 0
            ? 0
            : MAIN_ROW_PX + EXTRA_ROW_PX * (segment.row - 1),
        height: segment.row === 0 ? MAIN_ROW_PX : EXTRA_ROW_PX,
        left: `${(segment.from / total) * 100}%`,
        width: `${Math.max(((segment.to - segment.from) / total) * 100, 0.4)}%`,
        backgroundColor: hue,
        backgroundImage: stopped
          ? 'repeating-linear-gradient(135deg, transparent 0 4px, rgb(255 255 255 / 0.6) 4px 7px)'
          : undefined,
      }}
    />
  )
}

export function Timeline({
  state,
  originMs,
  timeline,
  controls,
}: {
  state: RunState
  originMs: number
  timeline: TimelineValue
  controls: TimelineControls
}) {
  const { cursor, duration, playing, speed, enabled } = timeline
  const total = Math.max(duration, 1)
  const tracks = trackSegments(state, originMs, cursor)
  const placed = {
    A: assignRows(tracks.A),
    B: assignRows(tracks.B),
    C: assignRows(tracks.C),
  }
  const rows = {
    A: Math.max(1, ...placed.A.map((s) => s.row + 1)),
    B: Math.max(1, ...placed.B.map((s) => s.row + 1)),
    C: Math.max(1, ...placed.C.map((s) => s.row + 1)),
  }

  return (
    <section
      aria-label="Timeline"
      className="space-y-2 rounded-card border border-hairline bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-2 text-base font-semibold text-text-primary">
          Timeline
        </h2>
        <button
          type="button"
          className={BUTTON}
          disabled={!enabled}
          onClick={controls.rewind}
        >
          <SkipBack aria-hidden size={16} />
          Rewind
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={!enabled}
          onClick={playing ? controls.pause : controls.play}
        >
          {playing ? (
            <Pause aria-hidden size={16} />
          ) : (
            <Play aria-hidden size={16} />
          )}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={!enabled}
          onClick={controls.replay}
        >
          <RotateCcw aria-hidden size={16} />
          Replay
        </button>
        <input
          type="range"
          aria-label="Position"
          aria-valuetext={`${formatDuration(cursor)} of ${formatDuration(duration)}`}
          min={0}
          max={Math.max(Math.ceil(duration), 1)}
          step={1}
          value={Math.round(cursor)}
          disabled={!enabled}
          onChange={(event) => controls.seek(Number(event.target.value))}
          className="min-w-48 flex-1"
        />
        <span className="tabular text-sm text-text-secondary">
          {`${formatDuration(cursor)} of ${formatDuration(duration)}`}
        </span>
        <div role="group" aria-label="Speed" className="flex gap-1">
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={speed === option}
              onClick={() => controls.speed(option)}
              className={`${BUTTON} ${speed === option ? 'bg-surface-raised font-semibold' : ''}`}
            >
              {`${option}x`}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {PIPELINES.map(({ id, label, strong, hue }) => (
          <div key={id} className="flex items-center gap-3">
            <span
              className="w-8 text-base font-semibold"
              style={{ color: strong }}
            >
              {id}
            </span>
            <div
              role="img"
              aria-label={summary(label, placed[id])}
              className="relative flex-1 rounded-chip bg-surface-raised"
              style={{ height: MAIN_ROW_PX + EXTRA_ROW_PX * (rows[id] - 1) }}
            >
              {placed[id].map((segment) => (
                <Bar
                  key={segment.stage}
                  segment={segment}
                  total={total}
                  hue={hue}
                />
              ))}
              <span
                aria-hidden
                className="absolute -inset-y-1 w-0.5 bg-text-primary"
                style={{ left: `${(cursor / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
