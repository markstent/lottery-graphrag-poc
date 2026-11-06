/**
 * The sizes and tones Help's small pictures share, matching the approach and
 * evidence diagrams so every picture in Help reads the same.
 */

import type { PipelineId } from '../../../design/pipelines'

export const PAD = 8
export const GAP = 28
export const BOX_H = 40
/** The height of a box with two lines. */
export const BOX_H2 = 56
export const FONT = 14
export const SMALL = 12
/** The size of a pixel of text on the page: a picture is sized in em, so it grows with the screen's text. */
export const BASE_PX = 14

export interface Tone {
  fill: string
  stroke: string
  text: string
}

export const SHARED: Tone = {
  fill: 'var(--color-surface-raised)',
  stroke: 'var(--color-border)',
  text: 'var(--color-text-primary)',
}

/** Each approach's own boxes in its colours. */
export const TONES: Record<PipelineId, Tone> = {
  A: {
    fill: 'var(--color-pipeline-a-tint)',
    stroke: 'var(--color-pipeline-a)',
    text: 'var(--color-pipeline-a-strong)',
  },
  B: {
    fill: 'var(--color-pipeline-b-tint)',
    stroke: 'var(--color-pipeline-b)',
    text: 'var(--color-pipeline-b-strong)',
  },
  C: {
    fill: 'var(--color-pipeline-c-tint)',
    stroke: 'var(--color-pipeline-c)',
    text: 'var(--color-pipeline-c-strong)',
  },
}

/** A box wide enough for its text at 14 px. */
export const boxWidth = (text: string) =>
  Math.max(112, Math.ceil(text.length * 7.6) + 28)
