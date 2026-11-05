/**
 * The right column of the Tables tab: one row's fields in words, the graph
 * links it becomes (each kind counted, in words), and a way into the graph.
 * The row is read from `GET .../rows/{row_id}`; a row the table does not have
 * is said so plainly, and any other failure shows its own error and retry.
 */

import { ArrowRight } from 'lucide-react'

import { getRecord } from '../../api/client'
import { ApiError } from '../../api/http'
import {
  distinctFields,
  graphErrorWords,
  plainName,
  plainValue,
} from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { SkeletonBar } from '../../components/panel'
import { relationshipPhrase } from '../../design/relationships'
import { NEXT_STEP } from './explorer'
import { ErrorNote } from './overview-tab'

const NOTE = 'text-sm text-text-secondary'

export function RecordDetail({
  datasetId,
  table,
  rowId,
}: {
  datasetId: string
  table: string
  rowId: string | undefined
}) {
  const load = useLoad(
    (signal) =>
      rowId === undefined
        ? Promise.resolve(null)
        : getRecord(datasetId, table, rowId, signal),
    `${datasetId}/${table}/${rowId}`,
  )

  if (rowId === undefined)
    return <p className={NOTE}>Choose a row to see its record.</p>
  if (load.status === 'loading')
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading the record</span>
        <SkeletonBar className="w-2/3" />
        <SkeletonBar />
        <SkeletonBar className="w-5/6" />
      </div>
    )
  if (load.status === 'error')
    return load.error instanceof ApiError && load.error.status === 404 ? (
      <p className={NOTE}>{`No row ${rowId} in ${table}.`}</p>
    ) : (
      <ErrorNote error={load.error} retry={load.retry} />
    )
  const record = load.data
  if (record === null) return null

  const fields = distinctFields(record.row)
  const edges = record.edges ?? []
  return (
    <div className="space-y-5">
      <dl className="space-y-3 text-sm">
        {fields.map(([name, value]) => (
          <div key={name}>
            <dt className="text-text-muted">{plainName(name)}</dt>
            <dd className="break-words text-text-primary">
              {plainValue(value)}
            </dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="record-links" className="space-y-2">
        <h3
          id="record-links"
          className="text-sm font-semibold text-text-primary"
        >
          Becomes these links in the graph
        </h3>
        {record.graph_node_id === null && (
          <p className={NOTE}>
            {record.graph_error
              ? graphErrorWords(record.graph_error)
              : 'This row is not in the graph.'}
          </p>
        )}
        {record.graph_node_id !== null && edges.length === 0 && (
          <p className={NOTE}>It has no links in the graph.</p>
        )}
        {edges.length > 0 && (
          <ul className="space-y-1 text-sm text-text-primary">
            {edges.map((edge) => (
              <li key={`${edge.type}-${edge.direction}`}>
                {`${relationshipPhrase(edge.type)}: ${edge.count.toLocaleString('en-GB')} ${edge.direction === 'out' ? 'outgoing' : 'incoming'}`}
              </li>
            ))}
          </ul>
        )}
      </section>
      {record.graph_node_id !== null && (
        <a
          href={hrefFor('data-model', {
            tab: 'graph',
            node: record.graph_node_id,
          })}
          className={NEXT_STEP}
        >
          Open in the graph
          <ArrowRight aria-hidden size={16} />
        </a>
      )}
    </div>
  )
}
