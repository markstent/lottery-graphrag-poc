/**
 * Live Lab (docs/06 section 3): the primary screen. Both panes render only
 * received telemetry; the timeline rewinds; the score strip waits for the
 * evaluator. Two sources: the committed demo story (offline-safe) and the
 * live backend (real pipelines, recorded events, docs/07), whose saved
 * questions come from the frozen bank and are scored against the answer key.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { GraphPane } from '../components/graph-pane'
import { LiveScoreNote } from '../components/live-score'
import { RagPane } from '../components/rag-pane'
import { ScoreStrip } from '../components/score-strip'
import { Timeline } from '../components/timeline'
import { EvidenceInspector } from './evidence-explorer'
import { useSettings } from '../app/use-settings'
import { hrefFor } from '../app/router'
import { DEMO_QUESTIONS } from '../mock/content'
import {
  MOCK_RUN,
  mergeTimeline,
  projectGraph,
  projectRag,
} from '../mock/telemetry'
import type {
  EvaluationEvent,
  GraphEvent,
  MockRun,
  RagEvent,
} from '../mock/telemetry'
import type { RunEvent } from '../run/reduce'
import { useReplay } from '../run/use-replay'
import {
  fetchDemoQuestions,
  runBackendQuestion,
  type BackendQuestion,
} from '../api/backend-run'

type RunSource = 'story' | 'backend'

/** Canonical demo markets, matching backend master data (UK, GR, AT, CZ). */
const MARKETS = [
  { code: 'UK', label: 'United Kingdom' },
  { code: 'GR', label: 'Greece' },
  { code: 'AT', label: 'Austria' },
  { code: 'CZ', label: 'Czech Republic' },
] as const

/**
 * v1 adapter: plays a mock run on the replay clock. The mock timeline is
 * passed as stand-in events (only `sequence` and `t_ms` are read by the
 * clock); the clock's own run state is ignored. Phase 6 replaces this view
 * with one driven by recorded run events, and this adapter goes with it.
 */
function useMockPlayback(run: MockRun, reducedMotion: boolean) {
  const timeline = useMemo(() => mergeTimeline(run), [run])
  const events = useMemo(
    () =>
      timeline.map((entry, i) => ({
        sequence: i + 1,
        t_ms: entry.t,
        event_type: entry.kind,
        pipeline: entry.stream,
        payload: {},
      })) as unknown as RunEvent[],
    [timeline],
  )
  const replay = useReplay(events, { reducedMotion })
  const { controls } = replay
  const played = replay.count

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
    controls.reset()
    controls.speed(2)
    controls.play()
  }, [controls])

  /** Show exactly the first `count` events, whatever their timestamps. */
  const rewindTo = useCallback(
    (count: number) => {
      controls.pause()
      const target = Math.max(0, Math.min(count, timeline.length))
      controls.seek(target === 0 ? 0 : controls.offsets[target - 1])
      while (controls.snapshot().count > target) controls.step(-1)
    },
    [controls, timeline.length],
  )

  const status: 'idle' | 'running' | 'done' = replay.playing
    ? 'running'
    : played > 0
      ? 'done'
      : 'idle'

  return {
    status,
    played,
    timeline,
    ...prefixes,
    scores: prefixes.evaluation.at(-1)?.scores ?? null,
    runQuestion,
    rewindTo,
  }
}

export function LiveLab() {
  const settings = useSettings()
  const [question, setQuestion] = useState('')
  const [source, setSource] = useState<RunSource>('story')
  const [liveRun, setLiveRun] = useState<MockRun | null>(null)
  const [drawerEvidenceId, setDrawerEvidenceId] = useState<string | null>(null)
  const [markets, setMarkets] = useState<string[]>([])
  const [backendStatus, setBackendStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle')
  const [backendError, setBackendError] = useState('')
  const [backendQuestions, setBackendQuestions] = useState<BackendQuestion[]>(
    [],
  )
  const [backendQuestionsError, setBackendQuestionsError] = useState(false)

  useEffect(() => {
    if (source !== 'backend' || backendQuestions.length > 0) return
    fetchDemoQuestions()
      .then(setBackendQuestions)
      .catch(() => setBackendQuestionsError(true))
  }, [source, backendQuestions.length])

  const activeRun = source === 'backend' && liveRun ? liveRun : MOCK_RUN
  const playback = useMockPlayback(activeRun, settings.reducedMotion)

  const ragState = projectRag(playback.rag)
  const graphState = projectGraph(playback.graph)
  const started = playback.played > 0

  useEffect(() => {
    if (source === 'backend' && liveRun) playback.runQuestion()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start playback once per delivered run
  }, [liveRun])

  const submit = (text: string) => {
    setQuestion(text)
    if (source === 'story') {
      if (text === storyQuestion || text === '') playback.runQuestion()
      return
    }
    const saved = backendQuestions.find((entry) => entry.question === text)
    setBackendStatus('loading')
    setBackendError('')
    setLiveRun(null)
    runBackendQuestion(
      saved ?? {
        id: 'adhoc',
        question: text,
        category: 'ad_hoc',
      },
      markets.map((code) => `MKT_${code}`),
    )
      .then((run) => {
        setLiveRun(run)
        setBackendStatus('idle')
      })
      .catch((error: unknown) => {
        setBackendError(
          error instanceof Error ? error.message : 'backend run failed',
        )
        setBackendStatus('error')
      })
  }

  const citationHref = (id: string) =>
    hrefFor('evidence', { run: activeRun.runId, evidence: id })

  const savedQuestions: { id: string; text: string }[] =
    source === 'backend'
      ? backendQuestions.map((entry) => ({
          id: entry.id,
          text: entry.question,
        }))
      : DEMO_QUESTIONS.map((entry) => ({ id: entry.id, text: entry.text }))

  // The recorded story only contains the Greece episode: no other chip may
  // pretend to run in Demo story mode (honesty rule).
  const storyQuestion = DEMO_QUESTIONS[0].text
  const offStory =
    source === 'story' && question.trim() !== '' && question !== storyQuestion

  return (
    <div className="space-y-4">
      {!started && (
        <section
          aria-label="First-time orientation"
          className="rounded-card border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-graph">
                What you are testing
              </p>
              <h2 className="mt-0.5 text-base font-semibold text-text-primary">
                Same question, same data: Conventional RAG vs Graph + Ontology
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <a
                href={hrefFor('dictionary')}
                className="rounded-chip border border-border bg-surface-raised px-2.5 py-1 text-text-secondary transition-colors duration-micro hover:border-graph/50 hover:text-text-primary"
              >
                Inspect sample database rows →
              </a>
              <a
                href={hrefFor('help')}
                className="rounded-chip border border-border bg-surface-raised px-2.5 py-1 text-text-secondary transition-colors duration-micro hover:border-graph/50 hover:text-text-primary"
              >
                How it works →
              </a>
            </div>
          </div>
          <ol className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
            <li className="rounded-card border border-border bg-surface-raised p-3">
              <p className="font-semibold text-text-primary">
                1. Click a question chip below
              </p>
              <p className="mt-1 text-text-secondary">
                Pick <span className="font-mono text-graph">dq-1</span> (Greece
                checkout drop) or press <strong>Run</strong> to start both
                pipelines side by side.
              </p>
            </li>
            <li className="rounded-card border border-border bg-surface-raised p-3">
              <p className="font-semibold text-text-primary">
                2. Compare the two panes
              </p>
              <p className="mt-1 text-text-secondary">
                Left retrieves text chunks from Qdrant; right traverses Neo4j
                relationships and ontology concepts across UK, GR, AT and CZ.
              </p>
            </li>
            <li className="rounded-card border border-border bg-surface-raised p-3">
              <p className="font-semibold text-text-primary">
                3. Click any citation chip
              </p>
              <p className="mt-1 text-text-secondary">
                Opens the inline Evidence Inspector showing the underlying
                Parquet warehouse row, document and provenance.
              </p>
            </li>
          </ol>
        </section>
      )}

      <section
        aria-label="Question composer"
        className="rounded-card border border-border bg-surface p-4"
      >
        <label htmlFor="question" className="sr-only">
          Enterprise question
        </label>
        <textarea
          id="question"
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask an enterprise question, e.g. why did digital conversion fall in Greece?"
          className="w-full resize-none rounded-card border border-border bg-surface-raised p-3 text-base text-text-primary placeholder:text-text-muted focus:border-graph"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => submit(question || savedQuestions[0]?.text || '')}
            disabled={
              playback.status === 'running' ||
              (source === 'backend' && backendStatus === 'loading') ||
              (source === 'backend' &&
                !backendQuestionsError &&
                backendQuestions.length === 0) ||
              offStory
            }
            title={
              playback.status === 'running' || backendStatus === 'loading'
                ? 'A run is already active'
                : offStory
                  ? 'The recorded demo only contains the Greece question; switch to Live backend to run this'
                  : undefined
            }
            className="rounded-chip bg-graph px-4 py-1.5 text-sm font-medium text-background transition-opacity duration-micro hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {source === 'backend' && backendStatus === 'loading'
              ? 'Running…'
              : 'Run'}
          </button>
          <button
            type="button"
            onClick={() => setQuestion('')}
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors duration-micro hover:text-text-primary"
          >
            Clear
          </button>
          <div
            role="group"
            aria-label="Telemetry source"
            className="ml-auto flex items-center gap-1 rounded-chip border border-border p-0.5"
          >
            {(['story', 'backend'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={source === option}
                onClick={() => setSource(option)}
                className={`rounded-chip px-3 py-1 text-xs transition-colors duration-micro ${
                  source === option
                    ? 'bg-graph text-background'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {option === 'story' ? 'Demo story' : 'Live backend'}
              </button>
            ))}
          </div>
          <span className="text-xs text-text-muted">
            scope:{' '}
            {markets.length
              ? markets
                  .map(
                    (code) =>
                      MARKETS.find((market) => market.code === code)?.label ??
                      code,
                  )
                  .join(', ')
              : 'all markets'}{' '}
            · configuration: {activeRun.runId}
          </span>
        </div>
        <div
          role="group"
          aria-label="Market scope"
          className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3"
        >
          <span className="mr-1 text-xs font-medium text-text-muted">
            Market scope:
          </span>
          <button
            type="button"
            aria-pressed={markets.length === 0}
            disabled={source === 'story'}
            onClick={() => setMarkets([])}
            title={
              source === 'story'
                ? 'Market scope applies to Live backend runs'
                : undefined
            }
            className={`rounded-chip border px-2.5 py-1 text-xs transition-colors duration-micro disabled:cursor-not-allowed disabled:opacity-40 ${
              markets.length === 0
                ? 'border-graph bg-graph/15 font-medium text-text-primary'
                : 'border-border bg-surface-raised text-text-secondary hover:text-text-primary'
            }`}
          >
            All markets
          </button>
          {MARKETS.map((market) => (
            <button
              key={market.code}
              type="button"
              aria-pressed={markets.includes(market.code)}
              disabled={source === 'story'}
              title={
                source === 'story'
                  ? 'Market scope applies to Live backend runs'
                  : market.label
              }
              onClick={() =>
                setMarkets((current) =>
                  current.includes(market.code)
                    ? current.filter((code) => code !== market.code)
                    : [...current, market.code],
                )
              }
              className={`rounded-chip border px-2.5 py-1 text-xs transition-colors duration-micro disabled:cursor-not-allowed disabled:opacity-40 ${
                markets.includes(market.code)
                  ? 'border-graph bg-graph/15 font-medium text-text-primary'
                  : 'border-border bg-surface-raised text-text-secondary hover:text-text-primary'
              }`}
            >
              {market.label}
            </button>
          ))}
          <span className="text-xs text-text-muted">
            {source === 'story'
              ? 'switch to Live backend to scope a run'
              : 'retrieval is restricted to the selected markets; saved questions run with their own scope (all markets)'}
          </span>
        </div>
        {backendStatus === 'error' && (
          <p role="alert" className="mt-2 text-xs text-warning">
            Backend run failed: {backendError}
          </p>
        )}
        {source === 'backend' && backendQuestionsError && (
          <p className="mt-2 text-xs text-text-muted">
            Saved questions unavailable; the backend may be offline. Start it
            with <code>make serve-api</code>.
          </p>
        )}
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3"
          aria-label="Saved demo questions"
        >
          <span className="mr-1 text-xs font-medium text-text-muted">Try:</span>
          {savedQuestions.map((demo) => (
            <button
              key={demo.id}
              type="button"
              onClick={() => submit(demo.text)}
              disabled={
                backendStatus === 'loading' ||
                (source === 'story' && demo.text !== storyQuestion)
              }
              title={
                source === 'story' && demo.text !== storyQuestion
                  ? 'Not part of the recorded demo; switch to Live backend to run this question'
                  : undefined
              }
              className="rounded-chip border border-border bg-surface-raised px-2.5 py-1 text-left text-xs text-text-secondary transition-colors duration-micro hover:border-graph/60 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="mr-1.5 font-mono text-xs text-graph">
                {demo.id}
              </span>
              {demo.text}
            </button>
          ))}
          {source === 'story' && (
            <span className="text-xs text-text-muted">
              only dq-1 is in the recorded story; switch to Live backend to run
              the others
            </span>
          )}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          aria-label="Current Approach"
          className="rounded-card border border-border bg-surface p-4"
        >
          <RagPane
            state={ragState}
            onCitation={(citation) => {
              setDrawerEvidenceId(citation.id)
            }}
          />
        </section>
        <section
          aria-label="Graph and Ontology"
          className="rounded-card border border-graph/40 bg-surface p-4"
        >
          <GraphPane
            state={graphState}
            onCitation={(nodeId) => {
              setDrawerEvidenceId(nodeId)
            }}
          />
        </section>
      </div>

      {started && (
        <Timeline
          timeline={playback.timeline}
          played={playback.played}
          onSelect={playback.rewindTo}
        />
      )}

      {playback.scores && <ScoreStrip scores={playback.scores} />}

      {source === 'backend' && liveRun && playback.status === 'done' && (
        <LiveScoreNote
          answerKey={liveRun.answerKey ?? 'none'}
          status={liveRun.scoreStatus ?? 'not_applicable'}
          failure={liveRun.scoreFailure ?? null}
          score={liveRun.liveScore ?? null}
        />
      )}

      {!started && (
        <p className="text-xs text-text-muted">
          Both pipelines run on the same question, corpus, embedding model and
          generation model. Pane activity is driven by real execution telemetry
          events.
        </p>
      )}

      {drawerEvidenceId !== null && (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-background/70"
          onClick={() => setDrawerEvidenceId(null)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Evidence inspection drawer"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDrawerEvidenceId(null)
            }}
            className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-surface p-6 shadow-overlay"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  Evidence Inspector
                </h2>
                <p className="text-xs text-text-muted">
                  run {activeRun.runId} · citation {drawerEvidenceId}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={citationHref(drawerEvidenceId)}
                  className="rounded-chip border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors duration-micro hover:text-text-primary"
                >
                  Open full page ↗
                </a>
                <button
                  type="button"
                  onClick={() => setDrawerEvidenceId(null)}
                  className="rounded-chip border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors duration-micro hover:text-text-primary"
                >
                  Close
                </button>
              </div>
            </div>
            <EvidenceInspector
              evidenceId={drawerEvidenceId}
              onSelectEvidence={setDrawerEvidenceId}
            />
          </aside>
        </div>
      )}
    </div>
  )
}
