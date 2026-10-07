/**
 * Global presentation and accessibility settings (docs/06 sections 17-18).
 * Presentation mode changes density and chrome only, never routes.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

interface Settings {
  presentation: boolean
  togglePresentation: () => void
  reducedMotion: boolean
  toggleReducedMotion: () => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
}

const SettingsContext = createContext<Settings | null>(null)

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

export function useSettings(): Settings {
  const settings = useContext(SettingsContext)
  if (!settings)
    throw new Error('useSettings must be used inside SettingsProvider')
  return settings
}
