/**
 * The size of each node on the canvas. Height and type size are the same for
 * every node; the width fits the longer of the label and the identifier, so
 * an identifier is never cut short.
 */

import { EVIDENCE_STATES, type EvidenceShape } from '../design/evidence-states'
import { countedLabel, nodeLabel } from '../design/node-labels'

export interface NodeSize {
  width: number
  height: number
  /** Label type size in px at 100 percent zoom. */
  font: number
}

/** The part of a size every node shares; the width is worked out per node. */
export interface TypeSize {
  height: number
  font: number
  minWidth: number
  /**
   * The smallest type size on screen, in px, that fit view may zoom to: 14 in
   * both modes. Presentation mode sets the type larger (22 px), so a small
   * graph shows larger, and an evidence path as wide as a three-step one still
   * fits a 1920 by 1080 screen whole rather than at the edge (D-112).
   */
  minPx: number
}

export const TYPE_SIZE: TypeSize = {
  height: 70,
  font: 16,
  minWidth: 220,
  minPx: 14,
}
export const PRESENTATION_TYPE_SIZE: TypeSize = {
  height: 100,
  font: 22,
  minWidth: 300,
  minPx: 14,
}

/** The share of the width a shape leaves for text. */
export const TEXT_SPAN: Record<EvidenceShape, number> = {
  circle: 0.72,
  square: 0.92,
  diamond: 0.56,
  hexagon: 0.78,
  pill: 0.86,
  'dashed-circle': 0.72,
  document: 0.84,
}

/** Average glyph widths as a share of the font size: bold words, and capitals with underscores. */
const WORD_WIDTH = 0.6
const ID_WIDTH = 0.66
/** The icon, its gap and a little to spare. */
const ICON_ALLOWANCE = 1.8
const ROUND = 10

const roundUp = (width: number) => Math.ceil(width / ROUND) * ROUND

/** The width that holds the label and the identifier of a node in its shape. */
export function nodeWidth(
  node: { id: string; label: string; state: keyof typeof EVIDENCE_STATES },
  type: TypeSize,
): number {
  const words = nodeLabel(node.label).length * WORD_WIDTH + ICON_ALLOWANCE
  const id = node.id.length * ID_WIDTH
  const text = Math.max(words, id) * type.font
  return Math.max(
    type.minWidth,
    roundUp(text / TEXT_SPAN[EVIDENCE_STATES[node.state].shape]),
  )
}

/** The width of a group node: its icon and its count and label. */
export function groupWidth(
  group: { count: number; label: string },
  type: TypeSize,
): number {
  const text =
    (countedLabel(group.count, group.label).length * WORD_WIDTH +
      ICON_ALLOWANCE) *
    type.font
  return Math.max(type.minWidth, roundUp(text + 40))
}
