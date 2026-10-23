import { lazy, Suspense } from 'react'

import { SettingsProvider } from './app/settings'
import { Shell } from './app/shell'
import { useRoute, type RouteName } from './app/router'
import { ErrorBoundary } from './components/error-boundary'
import { Panel } from './components/panel'

// One chunk per destination, fetched when its route is first shown.
const ExperimentHome = lazy(() =>
  import('./views/experiment-home').then((m) => ({
    default: m.ExperimentHome,
  })),
)
const LiveLab = lazy(() =>
  import('./views/live-lab').then((m) => ({ default: m.LiveLab })),
)
const Results = lazy(() =>
  import('./screens/results/results').then((m) => ({ default: m.Results })),
)
const DataDictionary = lazy(() =>
  import('./views/data-dictionary').then((m) => ({
    default: m.DataDictionary,
  })),
)
const Help = lazy(() =>
  import('./views/help').then((m) => ({ default: m.Help })),
)

function Page({ name }: { name: RouteName }) {
  switch (name) {
    case 'overview':
      return <ExperimentHome />
    case 'live-lab':
      return <LiveLab />
    case 'results':
      return <Results />
    case 'data-model':
      return <DataDictionary />
    case 'help':
      return <Help />
  }
}

/** A failed destination clears when the reader moves to another one (the key). */
function Routes() {
  const { name } = useRoute()
  return (
    <ErrorBoundary key={name} title="This page">
      <Suspense fallback={<Panel state="loading" title="This page" />}>
        <Page name={name} />
      </Suspense>
    </ErrorBoundary>
  )
}

/** Development pages (graph harness, gallery), kept out of the production build. */
const DevPage =
  import.meta.env.MODE !== 'production' ? lazy(() => import('./dev')) : null

const DEV_HASH = /^#\/__(graph|gallery)/

function ThemedApp() {
  return (
    <>
      {DevPage && DEV_HASH.test(window.location.hash) ? (
        <Suspense fallback={null}>
          <DevPage />
        </Suspense>
      ) : (
        <Shell>
          <Routes />
        </Shell>
      )}
    </>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      <ThemedApp />
    </SettingsProvider>
  )
}
