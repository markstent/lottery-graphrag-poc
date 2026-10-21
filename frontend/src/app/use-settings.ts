/**
 * The settings context and its hook, apart from the provider component so
 * the provider file exports components only (React fast refresh).
 */

import { createContext, useContext } from 'react'

/** The visible-node cap the graph canvas folds above, and its limits. */
export const NODE_CAP_DEFAULT = 24
export const NODE_CAP_MIN = 12
export const NODE_CAP_MAX = 60

export interface Settings {
  presentation: boolean
  togglePresentation: () => void
  reducedMotion: boolean
  toggleReducedMotion: () => void
  /** Graph nodes shown before the canvas groups the rest. */
  nodeCap: number
  setNodeCap: (cap: number) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
}

export const SettingsContext = createContext<Settings | null>(null)

export function useSettings(): Settings {
  const settings = useContext(SettingsContext)
  if (!settings)
    throw new Error('useSettings must be used inside SettingsProvider')
  return settings
}
