import { SettingsProvider, useSettings } from './app/settings'
import { Shell } from './app/shell'
import { useRoute } from './app/router'
import { BenchmarkRunner } from './views/benchmark-runner'
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
  }
}

/** Applies the reduced-motion class around the whole tree (docs/ux/accessibility.md). */
function ThemedApp() {
  const { reducedMotion } = useSettings()
  return (
    <div className={reducedMotion ? 'reduced-motion' : ''}>
      <Shell>
        <Routes />
      </Shell>
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
