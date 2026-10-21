/**
 * Application shell: header (experiment metadata, presentation toggle),
 * primary navigation and the settings drawer (docs/06 sections 3 and 18).
 */

import { useEffect, useRef, type ReactNode } from 'react'

import { hrefFor, useRoute, type RouteName } from './router'
import { useSettings } from './use-settings'
import { EXPERIMENT } from '../mock/content'

const NAV_GROUPS: Array<{
  label: string
  items: Array<{
    name: RouteName
    label: string
    matches?: readonly RouteName[]
  }>
}> = [
  {
    label: 'Experiment',
    items: [
      { name: 'lab', label: 'Live Lab', matches: ['lab', 'evidence'] },
      { name: 'results', label: 'Results', matches: ['results', 'benchmark'] },
      { name: 'semantic', label: 'Semantic Layer' },
      {
        name: 'experiment',
        label: 'Setup',
        matches: ['experiment', 'scenarios'],
      },
    ],
  },
  {
    label: 'Learn',
    items: [
      { name: 'help', label: 'Help' },
      { name: 'dictionary', label: 'Data Dictionary' },
    ],
  },
]

function SettingsDrawer() {
  const {
    settingsOpen,
    setSettingsOpen,
    reducedMotion,
    toggleReducedMotion,
    presentation,
    togglePresentation,
  } = useSettings()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!settingsOpen) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, setSettingsOpen])

  if (!settingsOpen) return null

  return (
    <div
      role="dialog"
      aria-label="Settings"
      className="fixed inset-y-0 right-0 z-40 w-80 border-l border-border bg-surface p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg">Settings</h2>
        <button
          ref={closeRef}
          type="button"
          onClick={() => setSettingsOpen(false)}
          className="rounded-chip border border-border px-2 py-1 text-sm text-text-secondary hover:text-text-primary"
        >
          Close
        </button>
      </div>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-text-muted">Provider</dt>
          <dd className="text-text-secondary">{EXPERIMENT.provider}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Model</dt>
          <dd className="text-text-secondary">{EXPERIMENT.model}</dd>
        </div>
      </dl>
      <label className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={reducedMotion}
          onChange={toggleReducedMotion}
        />
        Reduce motion
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={presentation}
          onChange={togglePresentation}
        />
        Presentation mode
      </label>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute()
  const { presentation, togglePresentation, setSettingsOpen } = useSettings()

  return (
    <div className={`min-h-screen ${presentation ? 'presentation' : ''}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-chip focus:bg-surface-raised focus:px-3 focus:py-1.5"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a
            href={hrefFor('lab')}
            className="text-base font-semibold tracking-tight text-text-primary transition-colors duration-micro hover:text-graph"
            aria-label="Semantic Context Lab home"
          >
            {EXPERIMENT.name}
          </a>
          <p className="text-xs text-text-muted">
            {EXPERIMENT.dataset} · {EXPERIMENT.markets.length} markets ·{' '}
            {EXPERIMENT.model} · {EXPERIMENT.embedding}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={togglePresentation}
              aria-pressed={presentation}
              className={`rounded-chip border px-3 py-1 text-xs transition-colors duration-micro ${
                presentation
                  ? 'border-graph bg-graph/15 text-graph'
                  : 'border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              Presentation mode
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-haspopup="dialog"
              className="rounded-chip border border-border px-3 py-1 text-xs text-text-secondary hover:text-text-primary"
            >
              Settings
            </button>
          </div>
        </div>
        <nav aria-label="Primary" className="mx-auto max-w-7xl px-4">
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 pb-2">
            {NAV_GROUPS.map((group, groupIndex) => (
              <li key={group.label} className="flex items-center gap-1">
                {groupIndex > 0 && (
                  <span aria-hidden className="mx-2 h-4 w-px bg-border" />
                )}
                <span className="sr-only">{group.label}:</span>
                {group.items.map((item) => {
                  const active = (item.matches ?? [item.name]).includes(
                    route.name,
                  )
                  return (
                    <a
                      key={item.name}
                      href={hrefFor(item.name)}
                      aria-current={
                        route.name === item.name
                          ? 'page'
                          : active
                            ? 'true'
                            : undefined
                      }
                      className={`inline-block rounded-chip px-3 py-1.5 text-sm transition-colors duration-micro ${
                        active
                          ? 'bg-surface-raised font-medium text-text-primary'
                          : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                      }`}
                    >
                      {item.label}
                    </a>
                  )
                })}
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
      <SettingsDrawer />
    </div>
  )
}
