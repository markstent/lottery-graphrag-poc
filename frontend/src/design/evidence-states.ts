import {
  ArrowRight,
  Check,
  CircleMinus,
  FileText,
  LocateFixed,
  Search,
  Shapes,
  type LucideIcon,
} from 'lucide-react'
import { TOKENS } from './tokens'

export type EvidenceState =
  | 'seed'
  | 'traversed'
  | 'candidate'
  | 'selected'
  | 'discarded'
  | 'concept'
  | 'source_record'

export type EvidenceShape =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'hexagon'
  | 'pill'
  | 'dashed-circle'
  | 'document'

export interface EvidenceStateDesign {
  label: string
  icon: LucideIcon
  shape: EvidenceShape
  fill: string
  stroke: string
}

/*
 * Every state differs from every other in both shape and icon, so colour is
 * never the only cue. "Set aside" is grey and dashed: it is not an error.
 * A concept belongs to the ontology layer, so it wears pipeline C's tones.
 */
export const EVIDENCE_STATES: Record<EvidenceState, EvidenceStateDesign> = {
  seed: {
    label: 'Starting point',
    icon: LocateFixed,
    shape: 'circle',
    fill: TOKENS['color-state-seed-fill'],
    stroke: TOKENS['color-state-seed-stroke'],
  },
  traversed: {
    label: 'Followed',
    icon: ArrowRight,
    shape: 'square',
    fill: TOKENS['color-state-traversed-fill'],
    stroke: TOKENS['color-state-traversed-stroke'],
  },
  candidate: {
    label: 'Considered',
    icon: Search,
    shape: 'diamond',
    fill: TOKENS['color-state-candidate-fill'],
    stroke: TOKENS['color-state-candidate-stroke'],
  },
  selected: {
    label: 'Used as evidence',
    icon: Check,
    shape: 'hexagon',
    fill: TOKENS['color-state-selected-fill'],
    stroke: TOKENS['color-state-selected-stroke'],
  },
  discarded: {
    label: 'Set aside',
    icon: CircleMinus,
    shape: 'dashed-circle',
    fill: TOKENS['color-state-discarded-fill'],
    stroke: TOKENS['color-state-discarded-stroke'],
  },
  concept: {
    label: 'Ontology concept',
    icon: Shapes,
    shape: 'pill',
    fill: TOKENS['color-state-concept-fill'],
    stroke: TOKENS['color-state-concept-stroke'],
  },
  source_record: {
    label: 'Source record',
    icon: FileText,
    shape: 'document',
    fill: TOKENS['color-state-source-record-fill'],
    stroke: TOKENS['color-state-source-record-stroke'],
  },
}
