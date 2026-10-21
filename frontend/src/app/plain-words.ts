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

/** "affected_systems" and "affectedSystems" read "affected systems". */
export function plainName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
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
