/**
 * Live Lab (docs/06 section 3): the primary screen. Both panes render only
 * received telemetry; the timeline rewinds; the score strip waits for the
 * evaluator. Two sources: the committed demo story (offline-safe) and the
 * live backend (real pipelines, recorded events, docs/07).
 */

import { useEffect, useState } from 'react'

import { GraphPane } from '../components/graph-pane'
import { RagPane } from '../components/rag-pane'
import { ScoreStrip } from '../components/score-strip'
import { Timeline } from '../components/timeline'
import { useSettings } from '../app/settings'
import { hrefFor } from '../app/router'
import { DEMO_QUESTIONS } from '../mock/content'
import { MOCK_RUN, projectGraph, projectRag } from '../mock/telemetry'
import type { MockRun } from '../mock/telemetry'
import { useRunPlayback } from '../state/use-run-playback'
import {
  fetchDemoQuestions,
  runBackendQuestion,
  type BackendQuestion,
} from '../api/backend-run'

type RunSource = 'story' | 'backend'

export function LiveLab() {
  const settings = useSettings()
  const [question, setQuestion] = useState('')
  const [source, setSource] = useState<RunSource>('story')
  const [liveRun, setLiveRun] = useState<MockRun | null>(null)
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
  const playback = useRunPlayback(activeRun, settings.reducedMotion)

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
      playback.runQuestion()
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

  return (
    <div className="space-y-4">
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
          className="w-full resize-none rounded-card border border-border bg-surface-raised p-3 text-base text-primary placeholder:text-muted focus:border-graph"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => submit(question || savedQuestions[0]?.text || '')}
            disabled={
              playback.status === 'running' ||
              (source === 'backend' && backendStatus === 'loading')
            }
            title={
              playback.status === 'running' || backendStatus === 'loading'
                ? 'A run is already active'
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
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-secondary transition-colors duration-micro hover:text-primary"
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
                    : 'text-secondary hover:text-primary'
                }`}
              >
                {option === 'story' ? 'Demo story' : 'Live backend'}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">
            scope: all markets · configuration: {activeRun.runId}
          </span>
        </div>
        {backendStatus === 'error' && (
          <p role="alert" className="mt-2 text-xs text-warning">
            Backend run failed: {backendError}
          </p>
        )}
        {source === 'backend' && backendQuestionsError && (
          <p className="mt-2 text-xs text-muted">
            Saved questions unavailable; the backend may be offline. Start it
            with <code>make serve-api</code>.
          </p>
        )}
        {settings.presentation && (
          <div
            className="mt-3 flex flex-wrap gap-2"
            aria-label="Saved demo questions"
          >
            {savedQuestions.map((demo) => (
              <button
                key={demo.id}
                type="button"
                onClick={() => submit(demo.text)}
                disabled={backendStatus === 'loading'}
                className="rounded-chip border border-border bg-surface-raised px-3 py-1.5 text-left text-xs text-secondary transition-colors duration-micro hover:border-graph hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {demo.text}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          aria-label="Current Approach"
          className="rounded-card border border-border bg-surface p-4"
        >
          <RagPane
            state={ragState}
            onCitation={(citation) => {
              window.location.hash = citationHref(citation.id)
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
              window.location.hash = citationHref(nodeId)
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

      {!started && (
        <p className="text-xs text-muted">
          Both pipelines run on the same question, corpus, embedding model and
          generation model. Pane activity is driven by real execution telemetry
          events.
        </p>
      )}
    </div>
  )
}
