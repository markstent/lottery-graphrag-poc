import { describe, expect, it } from 'vitest'

import { evidenceMetric, methodBadge } from './method'

describe('the method a run was made under', () => {
  it('reads as a badge that names an old method as old', () => {
    expect(methodBadge('0.3.0')).toBe('Method v0.3')
    expect(methodBadge('0.2.0')).toBe('Method v0.2 (old method)')
  })

  it('decides the compared evidence metric: F1 under v0.2, recall from v0.3', () => {
    expect(evidenceMetric('0.2.0')).toBe('evidence_f1')
    expect(evidenceMetric('0.3.0')).toBe('evidence_recall')
  })
})
