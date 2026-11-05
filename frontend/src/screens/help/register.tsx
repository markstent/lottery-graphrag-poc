/**
 * The assumptions and limits register of chapter 9. Plain shows each row's
 * name and its one-sentence meaning; Technical adds why it was chosen, what
 * it costs if wrong and the decision record or source behind it. A row may
 * hold `{setting_key}` placeholders, filled like any paragraph.
 */

import { REGISTER } from './copy/limits'
import { useHelpData } from './help-data'
import { fillSettings, useSettingValues } from './settings'
import { ScrollBox } from '../../components/scroll-box'

const CELL = 'border-b border-hairline px-3 py-2 align-top'

/** Keeps a decision id such as D-001 on one line: its hyphen becomes a non-breaking one. */
const keepIds = (text: string) => text.replace(/\bD-(\d)/g, 'D\u2011$1')

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
    <ScrollBox label="Assumptions and limits">
      <table
        // 48rem fits the chapter column beside the chapter list at 1440 px, so all five columns show without scrolling.
        className={`w-full text-left text-sm ${technical ? 'min-w-[48rem]' : 'min-w-[36rem]'}`}
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
                className={`${CELL} ${technical ? 'w-36' : 'w-48'} font-semibold text-text-primary`}
              >
                {fill(row.item)}
              </th>
              <td className={CELL}>{fill(row.plain)}</td>
              {technical && (
                <>
                  <td className={CELL}>{fill(row.reason)}</td>
                  <td className={CELL}>{fill(row.cost)}</td>
                  <td className={`${CELL} w-40 wrap-anywhere`}>
                    {row.decision ? keepIds(fill(row.decision)) : 'None'}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  )
}
