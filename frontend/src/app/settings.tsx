/**
 * Global presentation and accessibility settings (docs/06 sections 17-18).
 * Presentation mode changes density and chrome only, never routes.
 */

import { useEffect, useState, type ReactNode } from 'react'

import { SettingsContext, type Settings } from './use-settings'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [presentation, setPresentation] = useState(false)
  const [manualReducedMotion, setManualReducedMotion] = useState(false)
  const [mediaReducedMotion, setMediaReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) =>
      setMediaReducedMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const value: Settings = {
    presentation,
    togglePresentation: () => setPresentation((current) => !current),
    reducedMotion: manualReducedMotion || mediaReducedMotion,
    toggleReducedMotion: () => setManualReducedMotion((current) => !current),
    settingsOpen,
    setSettingsOpen,
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
