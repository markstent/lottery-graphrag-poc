import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

import {
  DICTIONARY,
  EXAMPLE,
  ROW_COUNTS,
  graphNode,
  isSampled,
  neighboursOf,
  recordOf,
  rowsOf,
} from './mock-data-model'

/* The mock for the Data Model routes never invents a number: counts are the
   world's, and a page or filter the captured rows cannot answer is an error. */

const MANIFEST = new URL(
  '../../data/generated/dev-seed2026/_manifest.json',
  import.meta.url,
)

test('every row count the mock shows is the real count of the world', () => {
  expect(Object.keys(ROW_COUNTS).sort()).toEqual(
    DICTIONARY.map((t) => t.table).sort(),
  )
  test.skip(!existsSync(MANIFEST), 'the generated world is not on this machine')
  const real = JSON.parse(readFileSync(MANIFEST, 'utf8')).row_counts
  expect(ROW_COUNTS).toEqual(real)
})

test('an unfiltered page reports the real total', () => {
  const page = rowsOf('players', new URLSearchParams({ limit: '50' }))
  expect(page.status).toBe(200)
  expect((page.body as { total: number }).total).toBe(ROW_COUNTS.players)
})

test('a page beyond the captured rows is a mock-only error, never invented rows', () => {
  expect(isSampled('players')).toBe(true)
  const page = rowsOf('players', new URLSearchParams({ offset: '5000' }))
  expect(page.status).toBe(501)
  expect(JSON.stringify(page.body)).toContain('mock only')
})

test('a filter on a sampled table is a mock-only error, a filter on a full one is exact', () => {
  const sampled = rowsOf(
    'players',
    new URLSearchParams({ column: 'market_id', value: 'MKT_UK' }),
  )
  expect(sampled.status).toBe(501)
  expect(isSampled('devices')).toBe(false)
  const full = rowsOf(
    'devices',
    new URLSearchParams({ column: 'device_family', value: 'IOS', limit: '1' }),
  )
  expect(full.status).toBe(200)
  expect((full.body as { total: number }).total).toBeGreaterThan(0)
})

test('the example is an incident the captured rows hold', () => {
  const record = recordOf('incidents', EXAMPLE.incident_id!)
  expect(record.status).toBe(200)
})

test("a node's link counts are the record's, and the neighbours behind them", () => {
  const id = EXAMPLE.incident_id!
  const node = graphNode(id)!
  const record = recordOf('incidents', id).body as { edges: unknown[] }
  expect(node.edges).toEqual(record.edges)
  for (const { type, direction, count } of node.edges) {
    const page = neighboursOf(
      id,
      new URLSearchParams({ type, direction, limit: '100' }),
    ).body as { items: { rel_type: string; direction: string }[] }
    expect(page.items).toHaveLength(count)
    expect(
      page.items.every((i) => i.rel_type === type && i.direction === direction),
    ).toBe(true)
  }
})

test("a country's code is matched to its concept, which no table row makes", () => {
  const page = neighboursOf(
    'ITYPE_GR_PLIROMES',
    new URLSearchParams({ type: 'MAPS_TO' }),
  ).body as {
    items: { direction: string; node: { node_id: string; labels: string[] } }[]
  }
  expect(page.items).toEqual([
    expect.objectContaining({
      direction: 'out',
      node: expect.objectContaining({
        node_id: 'CONCEPT_PAYMENT_INCIDENT',
        labels: ['BusinessConcept'],
      }),
    }),
  ])
  expect(graphNode('CONCEPT_PAYMENT_INCIDENT')?.provenance).toBeNull()
})
