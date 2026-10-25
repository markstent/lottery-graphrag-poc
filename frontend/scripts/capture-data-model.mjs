// Captures the Data Model answers of a running API into e2e/fixtures/data-model-world.json,
// which the e2e mock API serves: the dictionary, the graph schema and statistics, and
// the world's real row counts, and rows of every table. A table above the cap (and not
// in FULL) is sampled in blocks spread across its ordered rows, so ids and timestamps
// keep the world's spread; the mock shows the real counts and refuses a page or a filter
// the sample cannot answer. Usage: node scripts/capture-data-model.mjs
// [http://localhost:8000]. Run it against a read-only dev world; it ingests nothing.
// It also captures the ontology, the members of every concept (all markets, and each
// market the concept is bound in) and the scenarios into e2e/fixtures/ontology-world.json.
import { writeFileSync } from 'node:fs'

const API = `${process.argv[2] ?? 'http://localhost:8000'}/api/v1`
const CAP = 600
const BLOCK = 50
/**
 * Tables no spec reads a row of or follows into the graph, so a short sample
 * is enough (their real counts are still captured). The other tables keep the
 * longer sample because the focus node of the graph specs, GAME_UK_01, has its
 * neighbours worked out from the rows that point at it.
 */
const UNREAD = [
  'sessions',
  'accounts',
  'payment_methods',
  'player_device',
  'player_payment_method',
  'prizes',
]
const UNREAD_CAP = 120
const UNREAD_BLOCK = 20
/**
 * Tables captured in full, so a filter on them has the world's own total:
 * devices repeat their first-seen timestamps widely, so a copied one has pages.
 */
const FULL = ['devices']

const get = async (path) => {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}

const [datasets, schema, stats] = await Promise.all([
  get('/datasets'),
  get('/graph/schema'),
  get('/graph/stats'),
])
const world = datasets.find((d) => d.active)
const dictionary = await get(`/datasets/${world.dataset_id}/dictionary`)

const rows = {}
for (const { table } of dictionary) {
  const total = world.row_counts[table]
  const unread = UNREAD.includes(table)
  const cap = FULL.includes(table) ? total : unread ? UNREAD_CAP : CAP
  const block = unread ? UNREAD_BLOCK : BLOCK
  const page = async (offset, limit) =>
    (
      await get(
        `/datasets/${world.dataset_id}/tables/${table}/rows?offset=${offset}&limit=${limit}`,
      )
    ).rows
  rows[table] = []
  if (total <= cap) {
    for (let offset = 0; offset < total; offset += 200)
      rows[table].push(...(await page(offset, 200)))
  } else {
    const blocks = Math.ceil(cap / block)
    const step = Math.floor((total - block) / (blocks - 1))
    for (let b = 0; b < blocks; b++)
      rows[table].push(...(await page(b * step, block)))
  }
}

writeFileSync(
  new URL('../e2e/fixtures/data-model-world.json', import.meta.url),
  JSON.stringify({
    dataset_id: world.dataset_id,
    row_counts: world.row_counts,
    dictionary,
    schema,
    stats,
    rows,
  }),
)
console.log(
  Object.entries(rows)
    .map(([table, list]) => `${table} ${list.length}`)
    .join('\n'),
)

const ontology = await get('/ontology')
const members = {}
for (const { concept_id: id, binding_counts: bound } of ontology.concepts) {
  const markets = Object.keys(bound).filter((m) => m !== 'shared')
  members[id] = { all: await get(`/ontology/concepts/${id}/members`) }
  for (const market of markets)
    members[id][market] = await get(
      `/ontology/concepts/${id}/members?market=${market}`,
    )
}
writeFileSync(
  new URL('../e2e/fixtures/ontology-world.json', import.meta.url),
  JSON.stringify({ ontology, members, scenarios: await get('/scenarios') }),
)
console.log(`ontology: ${ontology.concepts.length} concepts`)
