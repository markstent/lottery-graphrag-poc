/**
 * Playback state for a mock run. The UI never animates from timers alone:
 * every visible change is a prefix of the merged telemetry timeline, so
 * rewind and replay are exact (UX-LIVE-004).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  EvaluationEvent,
  GraphEvent,
  MockRun,
  RagEvent,
} from '../mock/telemetry'

export interface TimelineEntry {
  stream: 'rag' | 'graph' | 'evaluation'
  index: number
  t: number
  kind: string
}

export function mergeTimeline(run: MockRun): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const [stream, events] of [
    ['rag', run.rag],
    ['graph', run.graph],
    ['evaluation', run.evaluation],
  ] as const) {
    events.forEach((event, i) =>
      entries.push({ stream, index: i + 1, t: event.t, kind: event.kind }),
    )
  }
  return entries.sort((a, b) => a.t - b.t || a.stream.localeCompare(b.stream))
}

/** Demo pacing: real pipelines take seconds; playback is accelerated. */
const SPEED = 1.6

export type PlaybackStatus = 'idle' | 'running' | 'done'

export function useRunPlayback(run: MockRun, reducedMotion: boolean) {
  const timeline = useMemo(() => mergeTimeline(run), [run])
  const [played, setPlayed] = useState(0)
  const [status, setStatus] = useState<PlaybackStatus>('idle')

  const prefixes = useMemo(() => {
    let rag = 0
    let graph = 0
    let evaluation = 0
    for (const entry of timeline.slice(0, played)) {
      if (entry.stream === 'rag') rag = entry.index
      else if (entry.stream === 'graph') graph = entry.index
      else evaluation = entry.index
    }
    return {
      rag: run.rag.slice(0, rag) as RagEvent[],
      graph: run.graph.slice(0, graph) as GraphEvent[],
      evaluation: run.evaluation.slice(0, evaluation) as EvaluationEvent[],
    }
  }, [timeline, played, run])

  const runQuestion = useCallback(() => {
    if (reducedMotion) {
      setPlayed(timeline.length)
      setStatus('done')
      return
    }
    setPlayed(0)
    setStatus('running')
  }, [reducedMotion, timeline.length])

  useEffect(() => {
    if (status !== 'running') return
    if (played >= timeline.length) return
    const previous = played > 0 ? timeline[played - 1].t : 0
    const delay = Math.max(60, (timeline[played].t - previous) / SPEED)
    const timer = window.setTimeout(() => {
      setPlayed(played + 1)
      if (played + 1 >= timeline.length) setStatus('done')
    }, delay)
    return () => window.clearTimeout(timer)
  }, [status, played, timeline])

  const rewindTo = useCallback(
    (count: number) => {
      setPlayed(Math.max(0, Math.min(count, timeline.length)))
      if (status === 'running') setStatus('done')
    },
    [status, timeline.length],
  )

  const scores = prefixes.evaluation.at(-1)?.scores ?? null

  return {
    status,
    played,
    total: timeline.length,
    timeline,
    ...prefixes,
    scores,
    runQuestion,
    rewindTo,
  }
}
