/**
 * What the chapters read from the API besides their own copy: the question
 * bank, the scores' state, the story a link marked, the settings now and the
 * newest official run's recorded settings. Help provides it once.
 */

import { createContext, useContext } from 'react'

import type { Schemas } from '../../api/client'
import type { Load } from '../../app/use-load'
import type { Bank, ScoreState } from './bank'
import type { Level } from './level'

export interface HelpData {
  level: Level
  bank: Load<Bank>
  scores: ScoreState
  /** The story a link pointed at, to mark. */
  story: string | null
  settings: Load<Schemas['ExperimentSettings']>
  /** The newest official run's record of its settings, or null when there is none. */
  recorded: Load<Record<string, unknown> | null>
}

export const HelpDataContext = createContext<HelpData | null>(null)

export function useHelpData(): HelpData {
  const data = useContext(HelpDataContext)
  if (!data) throw new Error('useHelpData must be used inside Help')
  return data
}
