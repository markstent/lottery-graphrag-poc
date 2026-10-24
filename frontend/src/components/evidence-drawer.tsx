/**
 * The evidence drawer: the record behind a citation, an evidence row or a
 * graph node. The record comes first (a table row, or a graph node's
 * properties), then where it came from.
 */

import { getNode, getRecord, type Schemas } from '../api/client'
import { datasetName, plainName, plainValue } from '../app/plain-words'
import { useLoad } from '../app/use-load'
import { nodeLabel } from '../design/node-labels'
import { relationshipPhrase } from '../design/relationships'
import { Drawer } from './drawer'
import { Panel } from './panel'

export type EvidenceSource =
  | { kind: 'record'; datasetId: string; table: string; rowId: string }
  | { kind: 'node'; nodeId: string }
  /** Nodes the graph canvas folded into one group: their recorded members, listed. */
  | {
      kind: 'group'
      title: string
      members: readonly { id: string; label: string; title: string | null }[]
    }
  /** A passage the run's results carry in full: shown as is, with no request. */
  | {
      kind: 'passage'
      title: string
      text: string
      facts: readonly (readonly [string, string])[]
    }

interface EvidenceDrawerProps {
  /** What to show; `null` keeps the drawer closed. */
  source: EvidenceSource | null
  onClose: () => void
  /** Where the record sits on the evidence path (step 2 of 3 on path 2). */
  pathPosition?: { path: number; step: number; of: number } | null
  /** The address of a graph node, to offer "Follow into the graph" on a record that has one. */
  followInto?: (nodeId: string) => string
}

type JsonValue = Schemas['JsonValue']
type Fields = Record<string, JsonValue>

function Fact({ term, children }: { term: string; children: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-4 text-sm">
      <dt className="text-text-muted">{term}</dt>
      <dd className="min-w-0 break-words text-text-primary">{children}</dd>
    </div>
  )
}

function Facts({ fields }: { fields: Fields }) {
  const entries = Object.entries(fields)
  if (entries.length === 0)
    return <p className="text-sm text-text-secondary">No fields.</p>
  return (
    <dl className="space-y-2">
      {entries.map(([name, value]) => (
        <Fact key={name} term={plainName(name)}>
          {plainValue(value)}
        </Fact>
      ))}
    </dl>
  )
}

const GRAPH_ERRORS: Record<string, string> = {
  GRAPH_QUERY_ERROR: 'The graph could not be queried for this record.',
  OTHER_WORLD: 'The graph holds a different world than this record.',
}

/** Words for a graph error code; a code from a newer server still reads as a sentence. */
const graphErrorWords = (code: string): string =>
  GRAPH_ERRORS[code] ?? 'The graph could not be read for this record.'

type Fetched = Exclude<EvidenceSource, { kind: 'passage' | 'group' }>

function loaded(source: Fetched, followInto?: (nodeId: string) => string) {
  return source.kind === 'record'
    ? async (signal: AbortSignal) => {
        const record = await getRecord(
          source.datasetId,
          source.table,
          source.rowId,
          signal,
        )
        return {
          labels: [] as string[],
          fields: record.row as Fields,
          provenance: (
            <>
              <dl className="space-y-2">
                <Fact term="Table">{record.table}</Fact>
                <Fact term="Dataset">{datasetName(source.datasetId)}</Fact>
                <Fact term="Graph node">
                  {record.graph_node_id ?? 'This row has no node in the graph.'}
                </Fact>
                {(record.edges ?? []).map((edge) => (
                  <Fact
                    key={`${edge.type}-${edge.direction}`}
                    term="Relationship"
                  >
                    {`${relationshipPhrase(edge.type)} (${edge.direction === 'out' ? 'outgoing' : 'incoming'}) × ${edge.count}`}
                  </Fact>
                ))}
                {record.graph_error && (
                  <Fact term="Graph">
                    {graphErrorWords(record.graph_error)}
                  </Fact>
                )}
              </dl>
              {followInto && record.graph_node_id && (
                <a
                  href={followInto(record.graph_node_id)}
                  className="mt-3 block text-sm font-medium text-text-primary underline"
                >
                  Follow into the graph
                </a>
              )}
            </>
          ),
        }
      }
    : async (signal: AbortSignal) => {
        const node = await getNode(source.nodeId, signal)
        return {
          fields: node.properties as Fields,
          labels: node.labels,
          provenance: node.provenance ? (
            <dl className="space-y-2">
              <Fact term="Table">{node.provenance.table}</Fact>
              <Fact term="Row">{node.provenance.row_id}</Fact>
              <Fact term="Dataset">
                {datasetName(node.provenance.dataset_id)}
              </Fact>
            </dl>
          ) : (
            <p className="text-sm text-text-secondary">
              This node has no source record.
            </p>
          ),
        }
      }
}

function PathPositionLine({
  position,
}: {
  position: EvidenceDrawerProps['pathPosition']
}) {
  return position ? (
    <p className="text-sm text-text-secondary">
      {`Step ${position.step} of ${position.of} on evidence path ${position.path}`}
    </p>
  ) : null
}

function GroupBody({
  source,
}: {
  source: Extract<EvidenceSource, { kind: 'group' }>
}) {
  return (
    <Panel title="Folded nodes" state="ready">
      <div className="space-y-3">
        <p className="text-sm font-medium">{source.title}</p>
        <ul className="space-y-2 text-sm">
          {source.members.map((m) => (
            <li key={m.id}>
              <span className="font-medium">{nodeLabel(m.label)}</span>{' '}
              <span className="text-text-secondary">{m.id}</span>
              {m.title !== null && (
                <span className="block text-text-secondary">{m.title}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

function PassageBody({
  source,
}: {
  source: Extract<EvidenceSource, { kind: 'passage' }>
}) {
  return (
    <>
      <Panel title="Record" state="ready">
        <div className="space-y-3">
          <p className="text-sm font-medium">{source.title}</p>
          <p className="text-sm whitespace-pre-line text-text-primary">
            {source.text}
          </p>
        </div>
      </Panel>
      <Panel title="Provenance" state="ready">
        <dl className="space-y-2">
          {source.facts.map(([term, value]) => (
            <Fact key={term} term={term}>
              {value}
            </Fact>
          ))}
        </dl>
      </Panel>
    </>
  )
}

function EvidenceBody({
  source,
  pathPosition,
  followInto,
}: {
  source: Fetched
  pathPosition?: EvidenceDrawerProps['pathPosition']
  followInto?: EvidenceDrawerProps['followInto']
}) {
  const key =
    source.kind === 'record'
      ? `record/${source.datasetId}/${source.table}/${source.rowId}`
      : `node/${source.nodeId}`
  const load = useLoad(loaded(source, followInto), key)

  return (
    <>
      <PathPositionLine position={pathPosition} />
      <Panel
        title="Record"
        state={load.status}
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      >
        {load.status === 'ready' && (
          <div className="space-y-3">
            {load.data.labels.length > 0 && (
              <p className="text-sm font-medium">
                {load.data.labels.map(nodeLabel).join(', ')}
              </p>
            )}
            <Facts fields={load.data.fields} />
          </div>
        )}
      </Panel>
      {load.status === 'ready' && (
        <Panel title="Provenance" state="ready">
          {load.data.provenance}
        </Panel>
      )}
    </>
  )
}

export function EvidenceDrawer({
  source,
  onClose,
  pathPosition,
  followInto,
}: EvidenceDrawerProps) {
  return (
    <Drawer open={source !== null} title="Evidence" onClose={onClose}>
      {source?.kind === 'passage' ? (
        <PassageBody source={source} />
      ) : source?.kind === 'group' ? (
        <GroupBody source={source} />
      ) : (
        source && (
          <EvidenceBody
            source={source}
            pathPosition={pathPosition}
            followInto={followInto}
          />
        )
      )}
    </Drawer>
  )
}
