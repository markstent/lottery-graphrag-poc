/** Finds the first use of each glossary term in a chapter's body text and draws it as a `Term`. */

import type { ReactNode } from 'react'

import type { Block } from './chapters'
import { glossaryEntry } from '../../copy/glossary'
import { Term } from './term'

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One piece of body text of a chapter, found by its path, and whether it sits inside a "more" block. */
interface BodyText {
  path: string
  text: string
  inMore: boolean
}

/** The body texts of `blocks` in document order; a path is the block indexes joined by dots, as `Blocks` builds them. */
function bodyTexts(
  blocks: readonly Block[],
  prefix: string,
  inMore = false,
): BodyText[] {
  return blocks.flatMap((block, index): BodyText[] => {
    const path = `${prefix}.${index}`
    if (typeof block === 'string') return [{ path, text: block, inMore }]
    if (!('kind' in block))
      return block.map((text, item) => ({
        path: `${path}.${item}`,
        text,
        inMore,
      }))
    if (block.kind === 'key') return [{ path, text: block.text, inMore }]
    if (block.kind === 'steps')
      return block.items.map((text, item) => ({
        path: `${path}.${item}`,
        text,
        inMore,
      }))
    if (block.kind === 'more') return bodyTexts(block.blocks, path, true)
    return []
  })
}

/**
 * Which terms are marked in which body text, decided before drawing. A term
 * is marked at its first use outside any "more" block, in document order;
 * a term used only inside "more" blocks is marked at its first use there,
 * so a reader meets help on a visible word whenever there is one.
 * Keys are paths from `bodyTexts`; `blocks` are the blocks shown, in order.
 */
export function planTerms(
  blocks: ReadonlyMap<string, readonly Block[]>,
  terms: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const known = terms.filter((term) => glossaryEntry(term))
  const texts = [...blocks].flatMap(([prefix, list]) => bodyTexts(list, prefix))
  const plan = new Map<string, string[]>()
  const used = new Set<string>()
  for (const inMore of [false, true])
    for (const body of texts.filter((entry) => entry.inMore === inMore)) {
      const before = new Set(used)
      markTerms(body.text, known, used)
      const added = [...used].filter((term) => !before.has(term))
      if (added.length > 0) plan.set(body.path, added)
    }
  return plan
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
    .filter((term) => !used.has(term) && glossaryEntry(term))
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
