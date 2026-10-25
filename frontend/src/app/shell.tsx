/**
 * Application shell: a left sidebar with the five destinations, a header
 * with the product name, active dataset, model status, presentation toggle
 * and Settings, and the Settings drawer (spec 7.1). Presentation mode hides
 * the sidebar.
 */

import {
  BookOpen,
  ChartColumn,
  Check,
  CircleCheck,
  CircleX,
  Database,
  FlaskConical,
  LayoutDashboard,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { listDatasets } from '../api/client'
import { datasetName } from './plain-words'
import { DESTINATIONS, hrefFor, useRoute, type RouteName } from './router'
import { SettingsDrawer } from './settings-drawer'
import { useLoad } from './use-load'
import { useReadiness, type ModelStatus } from './use-readiness'
import { useSettings } from './use-settings'

const ICONS: Record<RouteName, LucideIcon> = {
  overview: LayoutDashboard,
  'live-lab': FlaskConical,
  results: ChartColumn,
  'data-model': Database,
  help: BookOpen,
}

const BUTTON =
  'flex items-center gap-2 rounded-chip border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary'

function Sidebar() {
  const route = useRoute()
  const { sidebarCollapsed, toggleSidebar } = useSettings()
  const descriptions = useId()
  const Toggle = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col self-start border-r border-hairline bg-surface ${
        sidebarCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      <nav aria-label="Primary" className="flex-1 p-2">
        <ul className="space-y-1">
          {DESTINATIONS.map(({ name, label, purpose }) => {
            const Icon = ICONS[name]
            const active = route.name === name
            return (
              <li key={name}>
                <a
                  href={hrefFor(name)}
                  title={sidebarCollapsed ? `${label}: ${purpose}` : purpose}
                  aria-current={active ? 'page' : undefined}
                  aria-describedby={`${descriptions}-${name}`}
                  className={`flex items-center gap-3 rounded-chip border-l-4 px-3 py-2 text-sm ${
                    active
                      ? 'border-text-primary bg-surface-raised font-semibold text-text-primary'
                      : 'border-transparent text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                  } ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
                >
                  <Icon aria-hidden size={18} className="shrink-0" />
                  <span className={sidebarCollapsed ? 'sr-only' : undefined}>
                    {label}
                  </span>
                </a>
                <span id={`${descriptions}-${name}`} hidden>
                  {purpose}
                </span>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="border-t border-hairline p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : undefined}
          className={`${BUTTON} w-full ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
        >
          <Toggle aria-hidden size={18} className="shrink-0" />
          <span className={sidebarCollapsed ? 'sr-only' : undefined}>
            {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </span>
        </button>
      </div>
    </aside>
  )
}

const STATUS_WORDS: Record<ModelStatus, string> = {
  checking: 'Checking',
  ready: 'Ready',
  starting: 'Starting',
  'not-ready': 'Not ready',
}

const STATUS_DOT: Record<ModelStatus, string> = {
  checking: 'bg-grey-400',
  ready: 'bg-success',
  starting: 'bg-warning',
  'not-ready': 'bg-error',
}

const CHECK_LABELS: Record<string, string> = {
  lab: 'Retrieval lab',
  index: 'Search index',
  graph: 'Graph database',
  model: 'Answer model',
  embedding: 'Embedding model',
}

function ModelStatusMenu() {
  const { status, checks } = useReadiness()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Models: ${STATUS_WORDS[status]}`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
        className={BUTTON}
      >
        <span
          aria-hidden
          className={`size-2.5 rounded-full ${STATUS_DOT[status]}`}
        />
        {STATUS_WORDS[status]}
      </button>
      {open && (
        <div
          id={listId}
          className="absolute right-0 top-full z-20 mt-1 w-96 rounded-card border border-border bg-surface p-3 shadow-overlay"
        >
          {checks ? (
            <ul aria-label="Readiness checks" className="space-y-2">
              {Object.entries(checks).map(([name, check]) => {
                const Icon = check.ok ? CircleCheck : CircleX
                return (
                  <li key={name} className="flex items-start gap-2 text-sm">
                    <Icon
                      aria-hidden
                      size={16}
                      className={`mt-0.5 shrink-0 ${check.ok ? 'text-success' : 'text-error'}`}
                    />
                    <span>
                      <span className="font-medium text-text-primary">
                        {CHECK_LABELS[name] ?? name}
                      </span>
                      <span className="block text-text-secondary">
                        {check.ok ? 'Ready' : 'Not ready'}: {check.detail}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">
              {status === 'checking'
                ? 'Checking the models.'
                : 'The server did not answer.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ActiveDataset() {
  const load = useLoad(listDatasets, 'datasets')
  if (load.status === 'loading') return null
  const active =
    load.status === 'ready' ? load.data.find((dataset) => dataset.active) : null
  return (
    <p className="text-sm text-text-secondary">
      {active ? datasetName(active.dataset_id) : 'No active dataset'}
    </p>
  )
}

function Header() {
  const { presentation, togglePresentation, setSettingsOpen } = useSettings()
  return (
    <header className="flex items-center gap-6 border-b border-hairline bg-surface px-4 py-2.5">
      <a
        href={hrefFor('overview')}
        className="text-base font-semibold tracking-tight text-text-primary"
      >
        Semantic Context Lab
      </a>
      <ActiveDataset />
      <div className="ml-auto flex items-center gap-2">
        <ModelStatusMenu />
        <button
          type="button"
          aria-pressed={presentation}
          aria-label="Presentation mode"
          onClick={togglePresentation}
          className={
            presentation
              ? 'flex items-center gap-2 rounded-chip border border-text-primary bg-text-primary px-3 py-1.5 text-sm font-medium text-surface'
              : BUTTON
          }
        >
          <Presentation aria-hidden size={16} />
          Presentation mode
          {presentation ? (
            <span className="flex items-center gap-1 border-l border-surface/40 pl-2">
              <Check aria-hidden size={14} />
              On
            </span>
          ) : null}
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
          className={BUTTON}
        >
          <SettingsIcon aria-hidden size={16} />
          Settings
        </button>
      </div>
    </header>
  )
}

const WIDE_DESTINATIONS: readonly RouteName[] = ['live-lab', 'data-model']

export function Shell({ children }: { children: ReactNode }) {
  const { presentation } = useSettings()
  // Live Lab draws a graph beside three panels and Data Model draws maps of
  // tables and of the graph; both want the room. The other destinations are
  // read in a column, except in presentation mode, where larger type needs the
  // room too (a figure sized in em would otherwise be squeezed back).
  const wide = presentation || WIDE_DESTINATIONS.includes(useRoute().name)

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        onClick={(event) => {
          // The hash is the route, so the link must not change it.
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-chip focus:bg-surface-raised focus:px-3 focus:py-1.5"
      >
        Skip to content
      </a>
      {!presentation && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main
          id="main"
          tabIndex={-1}
          className={`mx-auto w-full flex-1 px-4 py-6 ${wide ? 'max-w-[110rem]' : 'max-w-7xl'}`}
        >
          {children}
        </main>
      </div>
      <SettingsDrawer />
    </div>
  )
}
