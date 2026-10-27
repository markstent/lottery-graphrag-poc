/** What each kind of benchmark run is called, on every screen that names one. */

import { plainName } from './plain-words'

export const KIND_WORDS: Record<string, string> = {
  official: 'Official run',
  dev: 'Development run',
  smoke: 'Quick check',
  sweep: 'Depth sweep',
}

/** The kind's name; a kind with no entry reads as its own words. */
export const kindWord = (kind: string): string =>
  KIND_WORDS[kind] ?? plainName(kind)
