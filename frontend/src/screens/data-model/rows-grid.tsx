/**
 * Sample rows of one table, fifty to a page, with the total, a filter on one
 * column and paging that keeps the filter. The server casts the typed value to
 * the column's own type, so a timestamp copied from a row finds that row; a
 * value that does not fit the type comes back as a message, shown as it is.
 * A row opens as a record in the evidence drawer (the caller's `onOpenRow`).
 */

import { useState } from 'react'

import { getRows, type Schemas } from '../../api/client'
import { plainValue } from '../../app/plain-words'
import { useLoad } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { count } from './model'

export const PAGE_SIZE = 50

interface Filter {
  column: string
  value: string
}

/** How the server reads a filter value for each column type, in words. */
const TYPE_WORDS: Record<string, string> = {
  VARCHAR: 'text',
  INTEGER: 'a whole number',
  DOUBLE: 'a number',
  'DECIMAL(12,2)': 'a number',
  BOOLEAN: 'true or false',
  DATE: 'a date',
  TIMESTAMP: 'a timestamp',
}

const button =
  'rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50'
const field =
  'rounded-chip border border-border bg-surface px-2 py-1 text-sm text-text-primary'

interface RowsGridProps {
  datasetId: string
  schema: Schemas['TableSchemaOut']
  /** Called with the row's key when a row is opened. */
  onOpenRow: (rowId: string) => void
}

export function RowsGrid({ datasetId, schema, onOpenRow }: RowsGridProps) {
  const [offset, setOffset] = useState(0)
  const [applied, setApplied] = useState<Filter | null>(null)
  const [column, setColumn] = useState(schema.primary_key)
  const [value, setValue] = useState('')

  const load = useLoad(
    (signal) =>
      getRows(
        datasetId,
        schema.table,
        { offset, limit: PAGE_SIZE, ...applied },
        signal,
      ),
    `${datasetId}/${schema.table}/${offset}/${applied?.column}/${applied?.value}`,
  )
  const page = load.status === 'ready' ? load.data : null
  const empty = page !== null && page.rows.length === 0
  const end = page ? offset + page.rows.length : 0

  const apply = (next: Filter | null) => {
    setApplied(next)
    setOffset(0)
  }
  const typeOf = schema.columns.find((c) => c.name === column)?.type

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          apply(value === '' ? null : { column, value })
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Column
          <select
            className={field}
            value={column}
            onChange={(event) => setColumn(event.target.value)}
          >
            {schema.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Value
          <input
            className={`${field} w-72`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-describedby="rows-filter-hint"
          />
        </label>
        <button type="submit" className={button}>
          Filter
        </button>
        <button
          type="button"
          className={button}
          disabled={applied === null && value === ''}
          onClick={() => {
            setValue('')
            apply(null)
          }}
        >
          Clear filter
        </button>
        <p id="rows-filter-hint" className="text-sm text-text-muted">
          {`Matches the whole value as ${TYPE_WORDS[typeOf ?? ''] ?? 'text'}.`}
        </p>
      </form>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className={button}
          disabled={offset === 0 || load.status === 'loading'}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous page
        </button>
        <button
          type="button"
          className={button}
          disabled={page === null || empty || end >= page.total}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next page
        </button>
        {page && !empty && (
          <p className="tabular text-sm text-text-secondary">
            {`Rows ${count(offset + 1)} to ${count(end)} of ${count(page.total)}`}
          </p>
        )}
      </div>

      <Panel
        title="Rows"
        state={empty ? 'empty' : load.status}
        message={
          applied
            ? `No row has ${applied.column} equal to ${applied.value}.`
            : 'This table has no rows.'
        }
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      >
        {page && (
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-surface-raised">
                <tr>
                  {schema.columns.map((c) => (
                    <th
                      key={c.name}
                      scope="col"
                      className="px-2 py-1.5 font-semibold whitespace-nowrap text-text-primary"
                    >
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, position) => {
                  const key = String(row[schema.primary_key])
                  return (
                    <tr
                      key={`${offset}/${position}`}
                      onClick={() => onOpenRow(key)}
                      className="cursor-pointer border-t border-hairline hover:bg-surface-raised"
                    >
                      {schema.columns.map((c, index) => (
                        <td
                          key={c.name}
                          className="px-2 py-1.5 whitespace-nowrap text-text-primary"
                        >
                          {index === 0 ? (
                            <button
                              type="button"
                              aria-label={`Open ${key}`}
                              className="underline"
                            >
                              {key}
                            </button>
                          ) : (
                            plainValue(row[c.name])
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
