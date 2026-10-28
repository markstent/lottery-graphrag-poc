/** The table twin of a chart: the same numbers, as text, in tabular numerals. */

import { ScrollBox } from '../components/scroll-box'

export interface DataTableRow {
  key: string
  label: string
  cells: readonly string[]
}

export function DataTable({
  caption,
  rowHeader,
  columns,
  rows,
}: {
  caption: string
  rowHeader: string
  columns: readonly string[]
  rows: readonly DataTableRow[]
}) {
  return (
    <ScrollBox label={caption}>
      <table className="w-full border-collapse text-sm text-text-primary">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-text-secondary">
            <th scope="col" className="py-2 pr-4 font-semibold">
              {rowHeader}
            </th>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 text-right font-semibold"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-hairline">
              <th
                scope="row"
                className="whitespace-nowrap py-2 pr-4 text-left font-normal"
              >
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td
                  key={columns[i]}
                  className="tabular whitespace-nowrap px-3 py-2 text-right"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  )
}
