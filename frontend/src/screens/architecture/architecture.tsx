/**
 * Architecture: the tech stack as one diagram (D-109), with the live counts
 * of the active world, and the same content in words for a screen reader
 * or a reader who wants it as text.
 */

import {
  getDataset,
  getGraphStats,
  getModels,
  getOntology,
  listDatasets,
} from '../../api/client'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { Screen } from '../screen'
import { stackCounts, type StackCounts } from './counts'
import { StackDiagram } from './stack-diagram'

const TITLE = 'How it fits together'

/** The counts of the active world, or null when no world is loaded. */
async function loadCounts(signal: AbortSignal): Promise<StackCounts | null> {
  const datasets = await listDatasets(signal)
  const dataset = datasets.find((d) => d.active)
  if (!dataset) return null
  const [detail, graph, ontology, models] = await Promise.all([
    getDataset(dataset.dataset_id, signal),
    getGraphStats(signal),
    getOntology(signal),
    getModels(signal),
  ])
  return stackCounts({ dataset, detail, graph, ontology, models })
}

const n = (value: number) => value.toLocaleString('en-GB')

/** The diagram's content in words, layer by layer from the bottom. */
function InWords({ counts }: { counts: StackCounts }) {
  const layers: [string, string][] = [
    [
      'Data platform, left unchanged',
      `A warehouse of ${n(counts.tables)} tables in Parquet files, queried with DuckDB, which is the source of every number, amount and date in an answer; and a text index in Qdrant 1.14 holding ${n(counts.documents)} documents and the table rows${counts.passages === null ? '' : ` as ${n(counts.passages)} passages`}, searched by meaning (bge-m3) and by keyword (BM25).`,
    ],
    [
      'Graph layer, added for B and C',
      `A Python load job reads the tables, without writing to them, and builds a Neo4j 5.26 graph of ${n(counts.graphRecords)} records of ${counts.graphKinds} kinds and ${n(counts.graphLinks)} links. Each record keeps its source table and row id; answers quote the warehouse row, not the graph.`,
    ],
    [
      'Ontology layer, added for C',
      `A hand-written file of business terms (YAML, version ${counts.ontologyVersion}) in four languages loads ${n(counts.concepts)} business concepts into the same graph and maps each country's own codes to them.`,
    ],
    [
      'Backend and AI',
      `A Python 3.13 FastAPI backend runs the three approaches on the same question, AI model and amount of evidence. All three search the text index; B and C also follow links in the graph, then read each fact's row from the warehouse. They share a re-ordering model (BAAI bge v2 m3) and a LiteLLM model gateway to Ollama, with answers by ${counts.answerModel}.`,
    ],
    [
      'Screens',
      'A React 19 web app in TypeScript, built with Vite and Tailwind, draws the graph with React Flow and ELK, and streams each run live from the backend.',
    ],
    [
      'Scoring, kept apart',
      'The answer key, two AI judges (gemma4 31B and Muse Glimmer) and the run store (SQLite and JSON files) read the answers; no approach can see them.',
    ],
  ]
  return (
    <details className="mt-3 text-sm text-text-secondary">
      <summary className="cursor-pointer text-text-primary">
        The diagram in words
      </summary>
      <dl className="mt-2 max-w-prose space-y-2">
        {layers.map(([layer, words]) => (
          <div key={layer}>
            <dt className="font-semibold text-text-primary">{layer}</dt>
            <dd>{words}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

export function Architecture() {
  const load = useLoad(loadCounts, 'architecture-counts')
  const counts = load.status === 'ready' ? load.data : null
  return (
    <Screen destination="architecture">
      <Panel
        title={TITLE}
        state={
          load.status === 'ready' && counts === null ? 'empty' : load.status
        }
        message="No world is loaded, so there are no counts to show."
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
        skeleton={<div className="skeleton-bar h-[32rem] rounded-card" />}
      >
        {counts && (
          <figure aria-label={TITLE}>
            <StackDiagram counts={counts} />
            <figcaption className="mt-2 text-sm text-text-secondary">
              Counts are the live ones of the loaded world.
            </figcaption>
            <InWords counts={counts} />
          </figure>
        )}
      </Panel>
    </Screen>
  )
}
