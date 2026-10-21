#!/usr/bin/env node
/**
 * Builds the 200-node graph fixture for the canvas end-to-end test
 * (e2e/graph-canvas-200.spec.ts) from the recorded run in
 * src/run/fixtures/run-abc.json.
 *
 * It is a test fixture, not product data. The original configuration C graph
 * events are kept as recorded. More nodes are then added by repeating the
 * recorded event shapes (a node discovered, the relationship that reached it,
 * the reranker's verdict and the discard) under new ids, until the graph
 * holds NODES nodes. The seed is shared, so the copies hang off the same
 * starting point. Copies are never selected, so the recorded evidence paths
 * stay the only ones.
 *
 * Usage: node scripts/make-graph-200.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NODES = 200
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(
  readFileSync(join(root, 'src/run/fixtures/run-abc.json'), 'utf8'),
)

const originals = source.events
  .filter((e) => e.pipeline === 'C' && e.event_type.startsWith('graph.'))
  .sort((a, b) => a.sequence - b.sequence)
const seeds = new Set(
  originals
    .filter((e) => e.event_type === 'graph.seed.selected')
    .map((e) => e.payload.node_id),
)

/** The node an event is about, or null for an event that is about the run. */
const subject = (e) =>
  ({
    'graph.node.discovered': e.payload.node_id,
    'graph.relationship.traversed': e.payload.to_id,
    'graph.candidate.reranked': e.payload.candidate_id,
    'graph.candidate.discarded': e.payload.node_id,
  })[e.event_type] ?? null

const nodeIds = [
  ...new Set(
    originals
      .filter((e) => e.event_type === 'graph.node.discovered')
      .map((e) => e.payload.node_id)
      .filter((id) => !seeds.has(id)),
  ),
]
/** Every graph node id an event names (a reranked chunk or record is not a node). */
const named = (e) =>
  e.payload.kind !== undefined && e.payload.kind !== 'node'
    ? []
    : ['node_id', 'to_id', 'from_id', 'candidate_id', 'concept_id', 'entity_id']
        .map((key) => e.payload[key])
        .filter((id) => typeof id === 'string')
const known = new Set(originals.flatMap(named))

const copyable = nodeIds.filter(
  (id) =>
    !originals.some(
      (e) =>
        e.event_type === 'graph.candidate.selected' && e.payload.node_id === id,
    ),
)

const t0 = originals[0].t_ms
const span = originals.at(-1).t_ms - t0 + 50
const rename = (id, copy) => (seeds.has(id) ? id : `${id}_x${copy}`)

const events = originals.map((e) => ({ ...e }))
let copy = 1
while (known.size < NODES) {
  const chosen = new Set(copyable.slice(0, NODES - known.size))
  for (const e of originals) {
    const id = subject(e)
    if (id === null || seeds.has(id) || !chosen.has(id)) continue
    const payload = { ...e.payload }
    for (const key of ['node_id', 'to_id', 'from_id', 'candidate_id'])
      if (typeof payload[key] === 'string')
        payload[key] = rename(payload[key], copy)
    // A step from a node that was not copied would leave the copy hanging.
    if (
      e.event_type === 'graph.relationship.traversed' &&
      !seeds.has(e.payload.from_id) &&
      !chosen.has(e.payload.from_id)
    )
      payload.from_id = [...seeds][0]
    const copied = {
      ...e,
      event_id: `${e.event_id}-x${copy}`,
      t_ms: e.t_ms + copy * span,
      payload,
    }
    named(copied).forEach((id) => known.add(id))
    events.push(copied)
  }
  copy += 1
}
events.forEach((e, i) => (e.sequence = i + 1))

const original = source.results.results.C
const node_evidence = [
  ...original.node_evidence,
  ...Array.from({ length: copy - 1 }, (_, i) => i + 1).flatMap((c) =>
    original.node_evidence
      .filter((n) => copyable.includes(n.node_id))
      .map((n) => ({
        ...n,
        node_id: rename(n.node_id, c),
        path: n.path.map((id) => rename(id, c)),
        selected: false,
      })),
  ),
]

writeFileSync(
  join(root, 'src/dev/fixtures/graph-200.json'),
  `${JSON.stringify({ nodes: NODES, events, results: { results: { C: { node_evidence } } } })}\n`,
)
console.log(`${events.length} events, ${known.size} nodes`)
