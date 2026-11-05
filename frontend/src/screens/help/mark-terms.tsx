/** Finds the first use of each glossary term in a chapter's body text and draws it as a `Term`. */

import type { ReactNode } from 'react'

import type { Block } from './chapters'
import { Term } from './term'

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The body text of blocks that term marks apply to, in reading order. */
export function bodyTexts(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block): string[] => {
    if (typeof block === 'string') return [block]
    if (!('kind' in block)) return [...block]
    if (block.kind === 'key') return [block.text]
    if (block.kind === 'steps') return [...block.items]
    if (block.kind === 'more') return bodyTexts(block.blocks)
    return []
  })
}

/**
 * `text` with the first whole-word, case-insensitive occurrence of each of
 * `terms` that is not in `used` drawn as a `Term`; a trailing "s" belongs to
 * the word. Terms marked here are added to `used`. The text itself is unchanged.
 */
export function markTerms(
  text: string,
  terms: readonly string[],
  used: Set<string>,
): ReactNode {
  const found = terms
    .filter((term) => !used.has(term))
    .flatMap((term) => {
      const match = new RegExp(`\\b${escapeRegExp(term)}s?\\b`, 'i').exec(text)
      return match
        ? [{ term, start: match.index, end: match.index + match[0].length }]
        : []
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const parts: ReactNode[] = []
  let position = 0
  for (const { term, start, end } of found) {
    if (start < position) continue
    used.add(term)
    parts.push(text.slice(position, start))
    parts.push(
      <Term key={term} term={term}>
        {text.slice(start, end)}
      </Term>,
    )
    position = end
  }
  if (parts.length === 0) return text
  parts.push(text.slice(position))
  return parts
}
