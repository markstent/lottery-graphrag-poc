/**
 * The settings context and its hook, apart from the provider component so
 * the provider file exports components only (React fast refresh).
 */

import { createContext, useContext } from 'react'

export interface Settings {
  presentation: boolean
  togglePresentation: () => void
  reducedMotion: boolean
  toggleReducedMotion: () => void
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
