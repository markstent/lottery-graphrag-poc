import { describe, expect, it } from 'vitest'

import { OFFICIAL, PILOT } from './results.fixtures'
import { REPRO_KEYS, reproFields } from './reproducibility'

describe('reproFields', () => {
  it('older run renders with missing fields', () =>
    expect(
      reproFields({ git_sha: 'abc' }).find((f) => f.key === 'git_dirty')?.value,
    ).toBe('Not recorded'))
  it('lists every known field in order, whatever the record holds', () => {
    expect(reproFields({}).map((f) => f.key)).toEqual([...REPRO_KEYS])
    const fields = reproFields({ git_sha: 'abc', repeats: 3 })
    expect(fields.find((f) => f.key === 'git_sha')).toEqual({
      key: 'git_sha',
      value: 'abc',
    })
  })
  it('shows null as not recorded', () =>
    expect(reproFields({ git_dirty: null })[1]?.value).toBe('Not recorded'))
  it('puts unknown keys after the known ones, by their own name', () => {
    const fields = reproFields({ git_sha: 'abc', zeta_field: 1 })
    expect(fields.at(-1)).toEqual({
      key: 'zeta_field',
      value: '1',
    })
  })
  it('writes booleans, lists and groups as words', () => {
    const value = (record: Record<string, unknown>, key: string) =>
      reproFields(record).find((f) => f.key === key)?.value
    expect(value({ git_dirty: true }, 'git_dirty')).toBe('Yes')
    expect(value({ git_dirty: false }, 'git_dirty')).toBe('No')
    expect(value({ excluded_labels: [] }, 'excluded_labels')).toBe('None')
    expect(
      value({ relationship_types_b: ['A', 'B'] }, 'relationship_types_b'),
    ).toBe('A, B')
    expect(value({ graph_limits: { depth: 2 } }, 'graph_limits')).toBe(
      'depth: 2',
    )
  })
  it('names every field a current run records', () => {
    const keys = Object.keys(OFFICIAL.reproducibility.run)
    expect(
      keys.filter((k) => !(REPRO_KEYS as readonly string[]).includes(k)),
    ).toEqual([])
  })
  it('an older pilot record has only fields that exist, the rest not recorded', () => {
    const fields = reproFields(PILOT.reproducibility.run)
    expect(fields.find((f) => f.key === 'git_dirty')?.value).toBe(
      'Not recorded',
    )
    expect(fields.find((f) => f.key === 'git_sha')?.value).not.toBe(
      'Not recorded',
    )
  })
  it('leaves out of the run list a field only the worlds record', () => {
    const run = { git_sha: 'abc' }
    const worlds = [{ bank_hash: 'h1', world_dir: '/w1', git_sha: 'abc' }]
    const keys = (fields: { key: string }[]) => fields.map((f) => f.key)
    expect(keys(reproFields(run, worlds))).not.toContain('bank_hash')
    expect(keys(reproFields(run, worlds))).not.toContain('world_dir')
    expect(keys(reproFields(run, worlds))).toContain('git_dirty')
    expect(
      reproFields(worlds[0], worlds).find((f) => f.key === 'bank_hash'),
    ).toEqual({
      key: 'bank_hash',
      value: 'h1',
    })
  })
})
