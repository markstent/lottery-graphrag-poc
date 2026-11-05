/**
 * The right column of the Tables tab: one row's fields in words, the graph
 * links it becomes (each kind counted, in words), and a way into the graph.
 * The row is read from `GET .../rows/{row_id}`; a row the table does not have
 * is said so plainly, and any other failure shows its own error and retry.
 */

import { ArrowRight } from 'lucide-react'

import { getRecord, type Schemas } from '../../api/client'
import { ApiError } from '../../api/http'
import {
  distinctFields,
  graphErrorWords,
  plainName,
  plainValue,
} from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { ErrorNote } from '../../components/error-note'
import { SkeletonBar } from '../../components/panel'
import { linkLines } from '../../design/relationships'
import { NEXT_STEP } from './explorer'
import { otherKinds } from './model'

const NOTE = 'text-sm text-text-secondary'

/**
 * The kind of record at the other end of a link of this type from a row of
 * `table`, when the graph schema names exactly one; otherwise nothing.
 */
function otherEnd(
  schema: Schemas['GraphSchema'] | null,
  table: string,
  type: string,
  direction: 'out' | 'in',
): string | undefined {
  const own = Object.entries(schema?.node_tables ?? {}).find(
    ([, name]) => name === table,
  )?.[0]
  if (schema === null || own === undefined) return undefined
  const kinds = otherKinds(schema, own, type, direction)
  return kinds.length === 1 ? kinds[0] : undefined
}

export function RecordDetail({
  datasetId,
  table,
  rowId,
  schema,
}: {
  datasetId: string
  table: string
  rowId: string | undefined
  /** The graph's schema, which names the kind of record at the other end of each link; null when it could not be read. */
  schema: Schemas['GraphSchema'] | null
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
  const lines = linkLines(record.edges ?? [], (type, direction) =>
    otherEnd(schema, table, type, direction),
  )
  return (
    <div className="space-y-5">
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
        {record.graph_node_id !== null && lines.length === 0 && (
          <p className={NOTE}>It has no links in the graph.</p>
        )}
        {lines.length > 0 && (
          <ul className="space-y-1 text-sm text-text-primary">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {record.graph_node_id !== null && (
          <a
            href={hrefFor('data-model', {
              tab: 'graph',
              node: record.graph_node_id,
            })}
            className={`${NEXT_STEP} mt-2`}
          >
            Open in the graph
            <ArrowRight aria-hidden size={16} />
          </a>
        )}
      </section>
      <dl className="space-y-3 border-t border-hairline pt-4 text-sm">
        {fields.map(([name, value]) => (
          <div key={name}>
            <dt className="text-text-muted">{plainName(name)}</dt>
            <dd className="break-words text-text-primary">
              {plainValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
