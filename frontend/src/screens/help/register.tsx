/**
 * The assumptions and limits register of chapter 9. Plain shows each row's
 * name and its one-sentence meaning; Technical adds why it was chosen, what
 * it costs if wrong and the decision record or source behind it. A row may
 * hold `{setting_key}` placeholders, filled like any paragraph.
 */

import { REGISTER } from './copy/limits'
import { useHelpData } from './help-data'
import { fillSettings, useSettingValues } from './settings'

const CELL = 'border-b border-hairline px-3 py-2 align-top'

const PLAIN_COLUMNS = ['Assumption or limit', 'What it means'] as const
const TECHNICAL_COLUMNS = [
  'Why',
  'Cost if wrong',
  'Decision or source',
] as const

export function Register() {
  const { level } = useHelpData()
  const values = useSettingValues()
  const fill = (text: string) => fillSettings(text, values)
  const technical = level === 'technical'
  const columns = technical
    ? [...PLAIN_COLUMNS, ...TECHNICAL_COLUMNS]
    : PLAIN_COLUMNS
  return (
    <div className="relative overflow-x-auto">
      <table
        className={`w-full text-left text-sm ${technical ? 'min-w-[64rem]' : 'min-w-[36rem]'}`}
      >
        <caption className="sr-only">Assumptions and limits</caption>
        <thead className="text-text-muted">
          <tr>
            {columns.map((name) => (
              <th key={name} scope="col" className={CELL}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REGISTER.map((row) => (
            <tr key={row.id} id={`limit-${row.id}`}>
              <th
                scope="row"
                className={`${CELL} w-48 font-semibold text-text-primary`}
              >
                {fill(row.item)}
              </th>
              <td className={CELL}>{fill(row.plain)}</td>
              {technical && (
                <>
                  <td className={CELL}>{fill(row.reason)}</td>
                  <td className={CELL}>{fill(row.cost)}</td>
                  <td className={`${CELL} w-40`}>
                    {row.decision ? fill(row.decision) : 'None'}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
