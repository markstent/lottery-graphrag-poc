/**
 * Global presentation and accessibility settings. Presentation mode changes
 * density and chrome only, never routes; it lives in the URL (`?present=1`)
 * so a reload keeps it. The other preferences live in the browser.
 */

import { useEffect, useState, type ReactNode } from 'react'

import {
  ActiveReplayContext,
  presentationFromUrl,
  useActiveReplayRegistry,
  writePresentationToUrl,
} from './presentation'
import { parseBoolean, usePersisted } from './persisted'
import {
  NODE_CAP_DEFAULT,
  NODE_CAP_MAX,
  NODE_CAP_MIN,
  SettingsContext,
  type Settings,
} from './use-settings'

const clampCap = (cap: number) =>
  Math.min(NODE_CAP_MAX, Math.max(NODE_CAP_MIN, Math.round(cap)))

function parseCap(stored: string): number | undefined {
  const cap = Number(stored)
  return Number.isFinite(cap) && stored.trim() !== ''
    ? clampCap(cap)
    : undefined
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [presentation, setPresentation] = useState(presentationFromUrl)
  const [manualReducedMotion, setManualReducedMotion] = usePersisted(
    'reduced-motion',
    false,
    parseBoolean,
  )
  const [nodeCap, storeNodeCap] = usePersisted(
    'visible-node-cap',
    NODE_CAP_DEFAULT,
    parseCap,
  )
  const [sidebarCollapsed, setSidebarCollapsed] = usePersisted(
    'sidebar-collapsed',
    false,
    parseBoolean,
  )
  const [mediaReducedMotion, setMediaReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const registerReplay = useActiveReplayRegistry(presentation)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) =>
      setMediaReducedMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('presentation', presentation)
    return () => document.documentElement.classList.remove('presentation')
  }, [presentation])

  const value: Settings = {
    presentation,
    togglePresentation: () => {
      writePresentationToUrl(!presentation)
      setPresentation(!presentation)
    },
    reducedMotion: manualReducedMotion || mediaReducedMotion,
    toggleReducedMotion: () => setManualReducedMotion(!manualReducedMotion),
    nodeCap,
    setNodeCap: (cap) => storeNodeCap(clampCap(cap)),
    sidebarCollapsed,
    toggleSidebar: () => setSidebarCollapsed(!sidebarCollapsed),
    settingsOpen,
    setSettingsOpen,
  }

  return (
    <SettingsContext.Provider value={value}>
      <ActiveReplayContext.Provider value={registerReplay}>
        {children}
      </ActiveReplayContext.Provider>
    </SettingsContext.Provider>
  )
}
