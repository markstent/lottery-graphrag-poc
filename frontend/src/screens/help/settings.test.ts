import { describe, expect, it } from 'vitest'

import { fillSettings, settingValue } from './settings'

const NOW = { top_k: 20, context: { graph_slots: 6 }, judge_model: null }
const THEN = { top_k: 10, context: { graph_slots: 6 } }

describe('settingValue', () => {
  it('reads the setting now and in the run, and whether they differ', () => {
    expect(settingValue('top_k', NOW, THEN)).toEqual({
      current: '20',
      recorded: '10',
      differs: true,
    })
  })

  it('follows dots into nested settings', () => {
    expect(settingValue('context.graph_slots', NOW, THEN)).toEqual({
      current: '6',
      recorded: '6',
      differs: false,
    })
  })

  it('has no recorded value, and no difference, where the run did not record one', () => {
    expect(settingValue('judge_model', NOW, THEN)).toEqual({
      current: 'none',
      recorded: null,
      differs: false,
    })
    expect(settingValue('top_k', NOW, null).recorded).toBeNull()
  })

  it('has no current value without settings', () => {
    expect(settingValue('top_k', null, THEN).current).toBeNull()
  })
})

describe('fillSettings', () => {
  it('fills each placeholder from the settings now', () => {
    expect(
      fillSettings(
        'Up to {top_k} items, {context.graph_slots} for the graph.',
        NOW,
        THEN,
      ),
    ).toBe('Up to 20 items, 6 for the graph.')
  })

  it('falls back to the newest official run, then to "not available"', () => {
    expect(fillSettings('{top_k} and {nothing}', null, THEN)).toBe(
      '10 and not available',
    )
  })

  it('groups the thousands of a number of 1,000 or more, as the typed text does', () => {
    expect(
      fillSettings(
        '{context_budget_tokens} tokens',
        { context_budget_tokens: 2000 },
        null,
      ),
    ).toBe('2,000 tokens')
    expect(settingValue('budget', { budget: 12500 }, { budget: 999 })).toEqual({
      current: '12,500',
      recorded: '999',
      differs: true,
    })
  })

  it('leaves text without a placeholder alone', () => {
    expect(fillSettings('Use { braces } freely.', NOW, THEN)).toBe(
      'Use { braces } freely.',
    )
  })
})
