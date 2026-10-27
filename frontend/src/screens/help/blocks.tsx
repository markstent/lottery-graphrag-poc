/**
 * Draws the blocks of a chapter: paragraphs and lists with their settings
 * filled in, the settings table, the pictures and the live components.
 */

import type { ReactElement } from 'react'

import { FlowDiagram } from '../../components/flow-diagram'
import { ApproachCards } from './approaches'
import type { Block, ComponentName, DiagramName, SettingKey } from './chapters'
import { DataTour } from './data'
import { Glossary } from './glossary'
import { useHelpData } from './help-data'
import { Questions } from './questions'
import { Running } from './running'
import { ScoringParts } from './scoring'
import {
  fillSettings,
  NOT_AVAILABLE,
  NOT_RECORDED,
  settingValue,
} from './settings'
import { Stories } from './stories'

const DIAGRAMS: Record<DiagramName, ReactElement> = { flow: <FlowDiagram /> }

const COMPONENTS: Record<ComponentName, ReactElement> = {
  dataTour: <DataTour />,
  approachCards: <ApproachCards />,
  stories: <Stories />,
  scoringParts: <ScoringParts />,
  questions: <Questions />,
  glossary: <Glossary />,
  running: <Running />,
}

const CELL = 'border-b border-hairline px-3 py-2 align-top'

function SettingsTable({ keys }: { keys: readonly SettingKey[] }) {
  const { settings, recorded } = useHelpData()
  const current = settings.status === 'ready' ? settings.data.values : null
  return (
    <>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Settings now and in the newest official run
        </caption>
        <thead className="text-text-muted">
          <tr>
            {['Setting', 'Now', 'Newest official run'].map((name) => (
              <th key={name} scope="col" className={CELL}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const value = settingValue(key, current, recorded)
            return (
              <tr key={key}>
                <th
                  scope="row"
                  className={`${CELL} font-mono font-normal text-text-primary`}
                >
                  {key}
                </th>
                <td className={`${CELL} font-mono text-text-primary`}>
                  {settings.status === 'loading'
                    ? 'Loading'
                    : (value.current ?? NOT_AVAILABLE)}
                </td>
                <td className={`${CELL} font-mono text-text-primary`}>
                  {value.recorded ?? NOT_RECORDED}
                  {value.differs && (
                    <span className="ml-2 rounded-chip border border-border px-1.5 py-0.5 font-sans text-xs font-semibold">
                      Differs
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {settings.status === 'error' && (
        <p className="flex flex-wrap items-center gap-3">
          <span>{settings.error.message}</span>
          <button
            type="button"
            onClick={settings.retry}
            className="rounded-chip border border-border px-3 py-1 text-text-primary hover:bg-surface-raised"
          >
            Retry loading settings
          </button>
        </p>
      )}
    </>
  )
}

export function Blocks({ blocks }: { blocks: readonly Block[] }) {
  const { settings, recorded } = useHelpData()
  const current = settings.status === 'ready' ? settings.data.values : null
  const fill = (text: string) => fillSettings(text, current, recorded)
  return blocks.map((block, index) => {
    if (typeof block === 'string') return <p key={index}>{fill(block)}</p>
    if (!('kind' in block))
      return (
        <ul key={index} className="list-disc space-y-1 pl-6">
          {block.map((item, position) => (
            <li key={position}>{fill(item)}</li>
          ))}
        </ul>
      )
    if (block.kind === 'settings')
      return <SettingsTable key={index} keys={block.keys} />
    if (block.kind === 'diagram')
      return <div key={index}>{DIAGRAMS[block.name]}</div>
    return <div key={index}>{COMPONENTS[block.name]}</div>
  })
}
