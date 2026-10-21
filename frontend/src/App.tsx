import { lazy, Suspense } from 'react'

import { SettingsProvider } from './app/settings'
import { useSettings } from './app/use-settings'
import { Shell } from './app/shell'
import { useRoute } from './app/router'
import { BenchmarkRunner } from './views/benchmark-runner'
import { DataDictionary } from './views/data-dictionary'
import { EvidenceExplorer } from './views/evidence-explorer'
import { ExperimentHome } from './views/experiment-home'
import { Help } from './views/help'
import { LiveLab } from './views/live-lab'
import { ResultsDashboard } from './views/results-dashboard'
import { ScenarioLab } from './views/scenario-lab'
import { SemanticLayer } from './views/semantic-layer'

function Routes() {
  const route = useRoute()
  switch (route.name) {
    case 'lab':
      return <LiveLab />
    case 'experiment':
      return <ExperimentHome />
    case 'scenarios':
      return <ScenarioLab />
    case 'evidence':
      return <EvidenceExplorer evidenceId={route.params.get('evidence')} />
    case 'benchmark':
      return <BenchmarkRunner />
    case 'results':
      return <ResultsDashboard />
    case 'semantic':
      return <SemanticLayer />
    case 'help':
      return <Help />
    case 'dictionary':
      return <DataDictionary />
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
