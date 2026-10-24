/**
 * Plain wording for identifiers the API returns, so the product never shows
 * a raw id or field name where a person reads it.
 */

import type { Schemas } from '../api/client'

type JsonValue = Schemas['JsonValue']

/** "dev-seed2026" reads "dev world, 2026"; an id of another shape reads as its words. */
export function datasetName(id: string): string {
  const match = /^(.+?)-seed(\d+)$/.exec(id)
  return match ? `${match[1]} world, ${match[2]}` : plainName(id)
}

/** "affected_systems" and "affectedSystems" read "affected systems"; a chunk reads as a passage. */
export function plainName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\bchunk(s?)\b/g, 'passage$1')
}

/** Text for a field value: lists as comma lists, nothing as "none". */
export function plainValue(value: JsonValue): string {
  if (value === null) return 'none'
  if (Array.isArray(value)) return value.map(plainValue).join(', ')
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([name, inner]) => `${plainName(name)}: ${plainValue(inner)}`)
      .join('; ')
  return String(value)
}

/**
 * The fields of a record without repeats: where several keys hold the same
 * text (a node's `id` and `source_record_id`, a row's own key repeated), one
 * is kept, the `id` if it is one of them, else the first. Numbers, booleans
 * and nothing never count as repeats. The order of the rest is kept.
 */
export function distinctFields(
  fields: Record<string, JsonValue>,
): [string, JsonValue][] {
  const entries = Object.entries(fields)
  const keeper = new Map<string, string>()
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || value === '') continue
    const kept = keeper.get(value)
    if (kept === undefined || (key === 'id' && kept !== 'id'))
      keeper.set(value, key)
  }
  return entries.filter(
    ([key, value]) => typeof value !== 'string' || keeper.get(value) === key,
  )
}
