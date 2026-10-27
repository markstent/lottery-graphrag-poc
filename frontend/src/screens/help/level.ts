/**
 * The reading level of Help. The URL says it first (`?level=`), so a link
 * opens at the right level; then the level this browser remembers, which
 * presentation mode ignores so a talk always starts at Plain; then Plain.
 */

import { hrefFor, useRoute } from '../../app/router'
import { readStored, writeStored } from '../../app/persisted'
import { useSettings as useAppSettings } from '../../app/use-settings'

export type Level = 'plain' | 'technical'

const KEY = 'help-level'
const DEEP_LINK_PARAMS = ['section', 'story', 'stratum']

const asLevel = (text: string | null): Level | null =>
  text === 'plain' || text === 'technical' ? text : null

export function useLevel(): [Level, (level: Level) => void] {
  const { params } = useRoute()
  const { presentation } = useAppSettings()
  // A link from another screen names a section, story or kind: it opens at Plain, whatever this browser remembers.
  const deepLink = DEEP_LINK_PARAMS.some((name) => params.has(name))
  const level =
    asLevel(params.get('level')) ??
    (presentation || deepLink ? null : asLevel(readStored(KEY))) ??
    'plain'
  const setLevel = (next: Level) => {
    writeStored(KEY, next)
    window.location.hash = hrefFor('help', {
      ...Object.fromEntries(params),
      level: next,
    })
  }
  return [level, setLevel]
}

/** A Help link that keeps the level when the address names one. */
export const helpHref = (
  params: URLSearchParams,
  next: Record<string, string>,
): string => {
  const level = params.get('level')
  return hrefFor('help', level ? { ...next, level } : next)
}
