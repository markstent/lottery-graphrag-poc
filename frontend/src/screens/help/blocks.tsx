/**
 * Draws the blocks of a chapter: paragraphs and lists with their settings
 * filled in, headings, tables of text, the settings table, the pictures and
 * the live components.
 */

import type { ReactElement } from 'react'

import type {
  Block,
  ComponentName,
  DiagramName,
  SettingKey,
  TableBlock,
} from './chapters'
import { DataTour } from './data'
import { ApproachDiagram } from './diagrams/approach-diagram'
import { CountriesDiagram } from './diagrams/countries-diagram'
import { EvidenceDiagram } from './diagrams/evidence-diagram'
import { FoundDiagram } from './diagrams/found-diagram'
import { IntervalDiagram } from './diagrams/interval-diagram'
import { MarkingDiagram } from './diagrams/marking-diagram'
import { TestDiagram } from './diagrams/test-diagram'
import { WorldDiagram } from './diagrams/world-diagram'
import { Glossary } from './glossary'
import { useHelpData } from './help-data'
import { Questions } from './questions'
import { Running } from './running'
import { Register } from './register'
import {
  fillSettings,
  NOT_AVAILABLE,
  NOT_RECORDED,
  settingValue,
  useSettingValues,
} from './settings'
import { Stories } from './stories'
import { ScrollBox } from '../../components/scroll-box'
import { markTerms } from './mark-terms'

const DIAGRAMS: Record<DiagramName, ReactElement> = {
  approachA: <ApproachDiagram id="A" />,
  approachB: <ApproachDiagram id="B" />,
  approachC: <ApproachDiagram id="C" />,
  evidence: <EvidenceDiagram />,
  test: <TestDiagram />,
  world: <WorldDiagram />,
  countries: <CountriesDiagram />,
  found: <FoundDiagram />,
  marking: <MarkingDiagram />,
  interval: <IntervalDiagram />,
}

const COMPONENTS: Record<ComponentName, ReactElement> = {
  dataTour: <DataTour />,
  stories: <Stories />,
  register: <Register />,
  questions: <Questions />,
  glossary: <Glossary />,
  running: <Running />,
}

const CELL = 'border-b border-hairline px-3 py-2 align-top'

function SettingsTable({ keys }: { keys: readonly SettingKey[] }) {
  const { settings, recorded: recordedRun } = useHelpData()
  const { current, recorded } = useSettingValues()
  const errors = [settings, recordedRun].flatMap((load) =>
    load.status === 'error' ? [load.error.message] : [],
  )
  return (
    <>
      <ScrollBox label="Settings now and in the newest official run">
        <table className="w-full min-w-[36rem] text-left text-sm">
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
                    {recordedRun.status === 'loading'
                      ? 'Loading'
                      : recordedRun.status === 'error'
                        ? NOT_AVAILABLE
                        : (value.recorded ?? NOT_RECORDED)}
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
      </ScrollBox>
      {errors.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
          <button
            type="button"
            onClick={() => {
              if (settings.status === 'error') settings.retry()
              if (recordedRun.status === 'error') recordedRun.retry()
            }}
            className="rounded-chip border border-border px-3 py-1 text-text-primary hover:bg-surface-raised"
          >
            Retry loading settings
          </button>
        </div>
      )}
    </>
  )
}

function TextTable({ caption, columns, rows }: Omit<TableBlock, 'kind'>) {
  return (
    <ScrollBox label={caption}>
      <table className="w-full min-w-[48rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
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
          {rows.map(([name, ...cells]) => (
            <tr key={name}>
              <th
                scope="row"
                className={`${CELL} font-semibold text-text-primary`}
              >
                {name}
              </th>
              {cells.map((cell, position) => (
                <td key={position} className={`${CELL} tabular`}>
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

const NO_MARKS: ReadonlyMap<string, readonly string[]> = new Map()

/**
 * `plan` says which terms to mark in which body text (see `planTerms`); a
 * text is found by `path`, the block indexes joined by dots.
 */
export function Blocks({
  blocks,
  path = 'b',
  plan = NO_MARKS,
}: {
  blocks: readonly Block[]
  path?: string
  plan?: ReadonlyMap<string, readonly string[]>
}) {
  const values = useSettingValues()
  const fill = (text: string, at: string) =>
    markTerms(fillSettings(text, values), plan.get(at) ?? [], new Set())
  return blocks.map((block, index) => {
    const at = `${path}.${index}`
    if (typeof block === 'string') return <p key={index}>{fill(block, at)}</p>
    if (!('kind' in block))
      return (
        <ul key={index} className="list-disc space-y-1 pl-6">
          {block.map((item, position) => (
            <li key={position}>{fill(item, `${at}.${position}`)}</li>
          ))}
        </ul>
      )
    if (block.kind === 'key')
      return (
        <div
          key={index}
          className="rounded-chip border-l-4 border-text-primary bg-surface-raised px-3 py-2"
        >
          <b className="text-text-primary">In one line:</b>{' '}
          {fill(block.text, at)}
        </div>
      )
    if (block.kind === 'steps')
      return (
        <ol key={index} className="list-decimal space-y-1 pl-6">
          {block.items.map((item, position) => (
            <li key={position}>{fill(item, `${at}.${position}`)}</li>
          ))}
        </ol>
      )
    if (block.kind === 'more')
      return (
        <details
          key={index}
          className="rounded-chip border border-border px-3 py-2"
        >
          <summary className="cursor-pointer font-semibold text-text-primary">
            {block.summary || 'More detail'}
          </summary>
          <div className="mt-2 space-y-3">
            <Blocks blocks={block.blocks} path={at} plan={plan} />
          </div>
        </details>
      )
    if (block.kind === 'heading')
      return (
        <h3
          key={index}
          className="pt-2 text-base font-semibold text-text-primary"
        >
          {block.text}
        </h3>
      )
    if (block.kind === 'table') return <TextTable key={index} {...block} />
    if (block.kind === 'settings')
      return <SettingsTable key={index} keys={block.keys} />
    if (block.kind === 'diagram')
      return <div key={index}>{DIAGRAMS[block.name]}</div>
    return <div key={index}>{COMPONENTS[block.name]}</div>
  })
}
