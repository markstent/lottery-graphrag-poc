/**
 * Live Lab (docs/06 section 3): the primary screen. Both panes render only
 * received telemetry; the timeline rewinds; the score strip waits for the
 * evaluator.
 */

import { useState } from 'react'

import { GraphPane } from '../components/graph-pane'
import { RagPane } from '../components/rag-pane'
import { ScoreStrip } from '../components/score-strip'
import { Timeline } from '../components/timeline'
import { useSettings } from '../app/settings'
import { hrefFor } from '../app/router'
import { DEMO_QUESTIONS } from '../mock/content'
import { MOCK_RUN, projectGraph, projectRag } from '../mock/telemetry'
import { useRunPlayback } from '../state/use-run-playback'

export function LiveLab() {
  const settings = useSettings()
  const [question, setQuestion] = useState('')
  const playback = useRunPlayback(MOCK_RUN, settings.reducedMotion)

  const ragState = projectRag(playback.rag)
  const graphState = projectGraph(playback.graph)
  const started = playback.played > 0

  const submit = (text: string) => {
    setQuestion(text)
    playback.runQuestion()
  }

  const citationHref = (id: string) =>
    hrefFor('evidence', { run: MOCK_RUN.runId, evidence: id })

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
            onClick={() => submit(question || DEMO_QUESTIONS[0].text)}
            disabled={playback.status === 'running'}
            title={
              playback.status === 'running'
                ? 'A run is already active'
                : undefined
            }
            className="rounded-chip bg-graph px-4 py-1.5 text-sm font-medium text-background transition-opacity duration-micro hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Run
          </button>
          <button
            type="button"
            onClick={() => setQuestion('')}
            className="rounded-chip border border-border px-3 py-1.5 text-sm text-secondary transition-colors duration-micro hover:text-primary"
          >
            Clear
          </button>
          <span className="text-xs text-muted">
            scope: all markets · configuration: {MOCK_RUN.runId}
          </span>
        </div>
        {settings.presentation && (
          <div
            className="mt-3 flex flex-wrap gap-2"
            aria-label="Saved demo questions"
          >
            {DEMO_QUESTIONS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                onClick={() => submit(demo.text)}
                className="rounded-chip border border-border bg-surface-raised px-3 py-1.5 text-left text-xs text-secondary transition-colors duration-micro hover:border-graph hover:text-primary"
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
