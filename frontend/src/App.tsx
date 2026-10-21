import { lazy, Suspense } from 'react'

import { SettingsProvider } from './app/settings'
import { useSettings } from './app/use-settings'
import { Shell } from './app/shell'
import { useRoute } from './app/router'
import { DataDictionary } from './views/data-dictionary'
import { ExperimentHome } from './views/experiment-home'
import { Help } from './views/help'
import { LiveLab } from './views/live-lab'
import { ResultsDashboard } from './views/results-dashboard'

function Routes() {
  const route = useRoute()
  switch (route.name) {
    case 'overview':
      return <ExperimentHome />
    case 'live-lab':
      return <LiveLab />
    case 'results':
      return <ResultsDashboard />
    case 'data-model':
      return <DataDictionary />
    case 'help':
      return <Help />
  }
}

/** Development pages, kept out of the production build. */
const GraphHarness =
  import.meta.env.MODE !== 'production'
    ? lazy(() => import('./dev/graph-harness'))
    : null

/** Applies the reduced-motion class around the whole tree (docs/ux/accessibility.md). */
function ThemedApp() {
  const { reducedMotion } = useSettings()
  return (
    <div className={reducedMotion ? 'reduced-motion' : ''}>
      {GraphHarness && window.location.hash.startsWith('#/__graph') ? (
        <Suspense fallback={null}>
          <GraphHarness />
        </Suspense>
      ) : (
        <Shell>
          <Routes />
        </Shell>
      )}
    </div>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      <ThemedApp />
    </SettingsProvider>
  )
}
