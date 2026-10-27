import { describe, expect, it } from 'vitest'

import { GLOSSARY_TERMS } from '../../copy/glossary'
import settingsFixture from '../../test/settings.fixture.json'
import { CHAPTER_COPY } from './copy'
import { REGISTER } from './copy/limits'
import { settingValue, fillSettings } from './settings'
import type { Block } from './chapters'

const values = settingsFixture.values as Record<string, unknown>

const PLACEHOLDER = /\{([a-z0-9_.]+)\}/g

const placeholders = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER)].map((match) => match[1])

/** Every text Help fills and every key its settings tables list. */
function usedKeys(): { where: string; key: string }[] {
  const used: { where: string; key: string }[] = []
  const add = (where: string, text: string) =>
    used.push(...placeholders(text).map((key) => ({ where, key })))
  const addBlocks = (where: string, blocks: readonly Block[]) => {
    for (const block of blocks) {
      if (typeof block === 'string') add(where, block)
      else if (!('kind' in block)) block.forEach((item) => add(where, item))
      else if (block.kind === 'settings')
        used.push(
          ...block.keys.map((key) => ({ where: `${where} table`, key })),
        )
    }
  }
  for (const [id, copy] of Object.entries(CHAPTER_COPY)) {
    addBlocks(`${id} plain`, copy.plain)
    addBlocks(`${id} technical`, copy.technical)
  }
  for (const row of REGISTER)
    for (const text of [
      row.item,
      row.plain,
      row.reason,
      row.cost,
      row.decision,
    ])
      add(`register ${row.id}`, text ?? '')
  for (const { term, meaning, technical } of GLOSSARY_TERMS) {
    add(`glossary ${term}`, meaning)
    add(`glossary ${term}`, technical ?? '')
  }
  return used
}

describe('the setting keys Help uses', () => {
  it('finds a good number of them, so the check below checks something', () => {
    expect(usedKeys().length).toBeGreaterThan(40)
  })

  it('all resolve against the settings the API serves', () => {
    const unresolved = usedKeys().filter(
      ({ key }) => settingValue(key, values, null).current === null,
    )
    expect(unresolved).toEqual([])
  })

  it('fill a typed sentence without writing "not available"', () => {
    const filled = usedKeys().map(({ key }) =>
      fillSettings(`{${key}}`, {
        current: values,
        recorded: null,
        loading: false,
      }),
    )
    expect(filled.filter((text) => text === 'not available')).toEqual([])
  })
})
