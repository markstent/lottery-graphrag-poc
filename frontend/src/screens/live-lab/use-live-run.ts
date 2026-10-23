/**
 * One run of one question, from either source, in one shape. A recorded run
 * plays through the replay clock. A live run is started through the API and
 * followed on its event stream. Either way the screen reads the same run
 * state (the reducer's) and the same timeline controls. A live run becomes
 * replayable from its own stored events as soon as it has ended.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cancelRun, getRun, startQuery, type Schemas } from '../../api/client'
import { ApiError } from '../../api/http'
import { subscribeRun } from '../../api/stream'
import type { KeyedReplay } from '../../app/presentation'
import type { RecordedRun } from '../../run/recorded'
import {
  initialRunState,
  reduce,
  type RunEvent,
  type RunState,
} from '../../run/reduce'
import type { Speed } from '../../run/replay'
import { useReplay } from '../../run/use-replay'
import type { Source } from './source'

export type RunRequest =
  | { source: 'recorded'; recording: RecordedRun }
  | { source: 'live'; body: Schemas['QueryRequest'] }

/** `interrupted` is a live run whose connection was lost before its end. */
export type RunPhase =
  'idle' | 'starting' | 'running' | 'interrupted' | 'finished'

export interface RunError {
  message: string
  /** Repeats the step that failed; null when repeating it cannot help. */
  retry: (() => void) | null
}

export interface Timeline {
  /** Whether the position comes from the replay clock rather than the live stream. */
  replaying: boolean
  /** Milliseconds from the first event to the position shown. */
  cursor: number
  duration: number
  playing: boolean
  speed: Speed
  /** False while a live run is still arriving: there is nothing to scrub yet. */
  enabled: boolean
}

export interface TimelineControls {
  play: () => void
  pause: () => void
  step: (direction: 1 | -1) => void
  seek: (ms: number) => void
  speed: (speed: Speed) => void
  rewind: () => void
  /** From the start, playing. */
  replay: () => void
}

export interface LiveRun {
  phase: RunPhase
  /** Null before the first run. */
  source: Source | null
  state: RunState
  /** `t_ms` of the first event, which the timeline counts from. */
  originMs: number
  runId: string | null
  timeline: Timeline
  controls: TimelineControls
  /** The same controls as the presentation keys use. */
  keys: KeyedReplay
  /** The run's stored results: a recording's at once, a live run's once it ends. */
  results: Schemas['QueryResults'] | null
  /** A live run is starting or arriving; a recording is never busy. */
  busy: boolean
  cancelling: boolean
  error: RunError | null
  start: (request: RunRequest) => void
  cancel: () => void
}

interface LiveState {
  runId: string | null
  events: RunEvent[]
  state: RunState
  /** `starting` until the first request answers, `ended` after the last event. */
  stage: 'idle' | 'starting' | 'streaming' | 'interrupted' | 'ended'
}

const IDLE: LiveState = {
  runId: null,
  events: [],
  state: initialRunState(),
  stage: 'idle',
}
const NO_EVENTS: RunEvent[] = []

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong.'

const isRetryable = (error: unknown): boolean =>
  error instanceof ApiError && error.retryable

/** What went wrong and which step to repeat. */
interface Failure {
  message: string
  step: 'start' | 'follow' | 'cancel' | 'results'
  retryable: boolean
}

export function useLiveRun({
  reducedMotion,
}: {
  reducedMotion: boolean
}): LiveRun {
  const [live, setLive] = useState<LiveState>(IDLE)
  const [recording, setRecording] = useState<RecordedRun | null>(null)
  // A finished live run shows its own state until the reader uses the timeline.
  const [replaying, setReplaying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [fetched, setFetched] = useState<Schemas['QueryResults'] | null>(null)

  /** Identifies the current run, so a late answer from an older one is ignored. */
  const token = useRef(0)
  const unsubscribe = useRef<(() => void) | null>(null)
  const request = useRef<AbortController | null>(null)
  const lastRequest = useRef<RunRequest | null>(null)
  const runId = useRef<string | null>(null)
  const lastSequence = useRef(0)
  /** The live run's stream has reached its end. */
  const ended = useRef(false)

  const replayEvents =
    recording?.events ?? (live.stage === 'ended' ? live.events : NO_EVENTS)
  const replay = useReplay(replayEvents, { reducedMotion })
  const controlsRef = useRef(replay.controls)
  const recordingRef = useRef(recording)
  useEffect(() => {
    controlsRef.current = replay.controls
    recordingRef.current = recording
  })

  const stop = useCallback(() => {
    token.current += 1
    unsubscribe.current?.()
    unsubscribe.current = null
    request.current?.abort()
    request.current = null
  }, [])
  useEffect(() => stop, [stop])

  /** Reads the stored results, which name the records the evidence list shows. */
  const loadResults = useCallback((id: string, mine: number) => {
    getRun(id, request.current?.signal).then(
      (results) => {
        if (token.current === mine) setFetched(results)
      },
      (error: unknown) => {
        if (token.current !== mine) return
        setFailure({
          message: errorMessage(error),
          step: 'results',
          retryable: isRetryable(error),
        })
      },
    )
  }, [])

  /** Follows the run's stream from after `after`. */
  const follow = useCallback(
    (id: string, after: number, mine: number) => {
      unsubscribe.current = subscribeRun(
        id,
        {
          onEvent: (event) => {
            if (token.current !== mine) return
            lastSequence.current = event.sequence
            setLive((current) => ({
              ...current,
              stage: 'streaming',
              events: [...current.events, event],
              state: reduce(current.state, event),
            }))
          },
          onEnd: () => {
            if (token.current !== mine) return
            ended.current = true
            setCancelling(false)
            setLive((current) => ({ ...current, stage: 'ended' }))
            loadResults(id, mine)
          },
          onError: (error) => {
            if (token.current !== mine) return
            setCancelling(false)
            setLive((current) => ({ ...current, stage: 'interrupted' }))
            setFailure({
              message: error.message,
              step: 'follow',
              retryable: error.retryable,
            })
          },
        },
        { after },
      )
    },
    [loadResults],
  )

  const start = useCallback(
    (next: RunRequest) => {
      stop()
      setFailure(null)
      setCancelling(false)
      setReplaying(false)
      setFetched(null)
      lastSequence.current = 0
      ended.current = false
      runId.current = null
      lastRequest.current = next
      if (next.source === 'recorded') {
        setLive(IDLE)
        // The same recording is already loaded, so restart it explicitly.
        if (next.recording === recordingRef.current) {
          controlsRef.current.reset()
          controlsRef.current.play()
        } else setRecording(next.recording)
        return
      }
      setRecording(null)
      const mine = token.current
      const controller = new AbortController()
      request.current = controller
      setLive({ ...IDLE, stage: 'starting' })
      startQuery(next.body, controller.signal).then(
        ({ run_id: id }) => {
          if (token.current !== mine) return
          runId.current = id
          setLive((current) => ({ ...current, runId: id, stage: 'streaming' }))
          follow(id, 0, mine)
        },
        (error: unknown) => {
          if (token.current !== mine) return
          setLive(IDLE)
          setFailure({
            message: errorMessage(error),
            step: 'start',
            retryable: isRetryable(error),
          })
        },
      )
    },
    [follow, stop],
  )

  const cancel = useCallback(() => {
    if (runId.current === null) return
    const mine = token.current
    setCancelling(true)
    cancelRun(runId.current, request.current?.signal).catch(
      (error: unknown) => {
        // An older run's answer, or one that lost the race with the run's end.
        if (token.current !== mine || ended.current) return
        setCancelling(false)
        setFailure({
          message: errorMessage(error),
          step: 'cancel',
          retryable: isRetryable(error),
        })
      },
    )
  }, [])

  const retry = useCallback(() => {
    if (failure === null) return
    setFailure(null)
    if (failure.step === 'start' && lastRequest.current)
      start(lastRequest.current)
    else if (failure.step === 'cancel') cancel()
    else if (failure.step === 'results' && runId.current !== null)
      loadResults(runId.current, token.current)
    else if (runId.current !== null) {
      setLive((current) => ({ ...current, stage: 'streaming' }))
      follow(runId.current, lastSequence.current, token.current)
    }
  }, [cancel, failure, follow, loadResults, start])
  const error: RunError | null = failure && {
    message: failure.message,
    retry: failure.retryable ? retry : null,
  }

  // A recording plays as soon as it is chosen; under reduced motion that is its end.
  useEffect(() => {
    if (recording) controlsRef.current.play()
  }, [recording])

  const replayable = recording !== null || live.stage === 'ended'
  const showReplay = recording !== null || (live.stage === 'ended' && replaying)
  const engage = useCallback(
    <Args extends unknown[]>(action: (...args: Args) => void) =>
      (...args: Args) => {
        if (!replayable) return
        setReplaying(true)
        action(...args)
      },
    [replayable],
  )

  const { controls } = replay
  const timelineControls = useMemo<TimelineControls>(
    () => ({
      play: engage(() => controls.play()),
      pause: engage(() => controls.pause()),
      step: engage((direction) => controls.step(direction)),
      seek: engage((ms) => controls.seek(ms)),
      speed: (speed) => controls.speed(speed),
      rewind: engage(() => controls.reset()),
      replay: engage(() => {
        controls.reset()
        controls.play()
      }),
    }),
    [controls, engage],
  )
  const keys = useMemo<KeyedReplay>(
    () => ({
      play: timelineControls.play,
      pause: timelineControls.pause,
      step: timelineControls.step,
      reset: timelineControls.rewind,
      snapshot: () => controls.snapshot(),
    }),
    [controls, timelineControls],
  )

  const events = showReplay ? replayEvents : live.events
  const originMs = events[0]?.t_ms ?? 0
  const liveDuration = (live.events.at(-1)?.t_ms ?? originMs) - originMs

  const phase: RunPhase = recording
    ? replay.count >= recording.events.length
      ? 'finished'
      : 'running'
    : live.stage === 'idle'
      ? 'idle'
      : live.stage === 'starting'
        ? 'starting'
        : live.stage === 'ended'
          ? 'finished'
          : live.stage === 'interrupted'
            ? 'interrupted'
            : 'running'

  return {
    phase,
    source: recording ? 'recorded' : live.stage === 'idle' ? null : 'live',
    state: showReplay ? replay.state : live.state,
    results: recording?.results ?? fetched,
    busy: live.stage === 'starting' || live.stage === 'streaming',
    originMs,
    runId: recording?.run_id ?? live.runId,
    timeline: showReplay
      ? {
          replaying: true,
          cursor: replay.cursor,
          duration: replay.duration,
          playing: replay.playing,
          speed: replay.speed,
          enabled: true,
        }
      : {
          replaying: false,
          cursor: liveDuration,
          duration: liveDuration,
          playing: false,
          speed: replay.speed,
          enabled: replayable,
        },
    controls: timelineControls,
    keys,
    cancelling,
    error,
    start,
    cancel,
  }
}
