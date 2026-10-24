/**
 * Running it: the one section that names the vendors and the engineering
 * commands. Every command is a target in the Makefile, and a test checks it.
 */

import type { ReactNode } from 'react'

import { Section } from './section'

const CODE = 'rounded-chip bg-surface-raised px-1.5 py-0.5 text-sm'
const CELL = 'border-b border-hairline px-3 py-2 align-top'

const Command = ({ children }: { children: string }) => (
  <code className={CODE}>{children}</code>
)

const BRING_UP: readonly [string, string][] = [
  ['make setup', 'Install the Python, frontend and browser dependencies.'],
  [
    'make services-up',
    'Start Neo4j and Qdrant in Docker. Ollama runs on the host.',
  ],
  ['make pull-models', 'Pull the embedding model into Ollama.'],
  ['make generate-dev-data', 'Generate the synthetic world.'],
  ['make ingest-graph', 'Load the world into Neo4j.'],
  ['make index-vector', 'Build the passage index in Qdrant.'],
  ['make ground-bank', 'Fit the question bank to this world.'],
  [
    'make dev',
    'Run the API and the screens together, then open localhost:5173.',
  ],
]

const RECOVERY: readonly [string, string, ReactNode][] = [
  [
    'A service is down',
    'make services-up',
    'The model status in the header names the check that failed.',
  ],
  [
    'The graph is empty or holds another world',
    'make ingest-graph',
    'The graph must hold the presentation world, the dev world for 2026.',
  ],
  [
    'Text search finds nothing',
    'make index-vector',
    'The passage index is missing or was built for another world.',
  ],
  [
    'A model is not listed',
    'make pull-models',
    'Start Ollama first. It must be running on the host.',
  ],
]

const MODELS: readonly [string, string, string][] = [
  [
    'Answer model',
    'GENERATION_PROVIDER, GENERATION_MODEL',
    'Set in .env. The recorded Live Lab runs used qwen3.6 through Ollama.',
  ],
  [
    'Embedding model',
    'EMBEDDING_PROVIDER, EMBEDDING_MODEL',
    'bge-m3 through Ollama.',
  ],
  [
    'Re-ordering model',
    'RERANK_PROVIDER, RERANK_MODEL',
    'BAAI/bge-reranker-v2-m3, run in process.',
  ],
  [
    'Judge model',
    'JUDGE_PROVIDER, JUDGE_MODEL',
    'Another model family than the answer model.',
  ],
]

export function Running() {
  return (
    <Section id="running">
      <h3 className="text-base font-semibold text-text-primary">Bring-up</h3>
      <ol className="list-decimal space-y-1 pl-6">
        {BRING_UP.map(([command, line]) => (
          <li key={command}>
            <Command>{command}</Command> {line}
          </li>
        ))}
      </ol>
      <h3 className="text-base font-semibold text-text-primary">Recovery</h3>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Recovery</caption>
        <thead className="text-text-muted">
          <tr>
            {['What you see', 'Run', 'Note'].map((name) => (
              <th key={name} scope="col" className={CELL}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RECOVERY.map(([symptom, command, note]) => (
            <tr key={command}>
              <td className={CELL}>{symptom}</td>
              <td className={CELL}>
                <Command>{command}</Command>
              </td>
              <td className={CELL}>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="text-base font-semibold text-text-primary">
        Model configuration
      </h3>
      <p>
        All three approaches use the same answer model and settings. Models are
        set in <code className={CODE}>.env</code>, and the example file lists
        every setting. The example answer and judge are stand-ins that need no
        model.
      </p>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Model configuration</caption>
        <thead className="text-text-muted">
          <tr>
            {['Role', 'Settings', 'Note'].map((name) => (
              <th key={name} scope="col" className={CELL}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODELS.map(([role, settings, note]) => (
            <tr key={role}>
              <td className={CELL}>{role}</td>
              <td className={CELL}>
                <code className={CODE}>{settings}</code>
              </td>
              <td className={CELL}>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        An official run needs <code className={CODE}>GENERATION_PROVIDER</code>{' '}
        and <code className={CODE}>JUDGE_PROVIDER</code> set to{' '}
        <code className={CODE}>litellm</code>. Then{' '}
        <Command>make run-benchmark</Command> runs every question on three
        worlds, three times each. <Command>make run-smoke</Command> checks the
        scoring with stand-ins and is not a result.
      </p>
    </Section>
  )
}
