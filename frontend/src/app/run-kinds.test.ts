import { describe, expect, it } from 'vitest'

import { kindWord, KIND_WORDS } from './run-kinds'

describe('kindWord', () => {
  it('names each kind of run one way, for every screen', () => {
    expect(KIND_WORDS).toEqual({
      official: 'Official run',
      dev: 'Development run',
      smoke: 'Quick check',
      sweep: 'Depth sweep',
    })
    expect(kindWord('smoke')).toBe('Quick check')
    expect(kindWord('dev')).toBe('Development run')
  })

  it('reads a kind it does not know as its own words', () => {
    expect(kindWord('model_comparison')).toBe('model comparison')
  })
})
