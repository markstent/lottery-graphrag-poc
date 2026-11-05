/**
 * Data Model: what the three approaches search, in five tabs (D-115). The tab
 * is in the route (`#/data-model?tab=graph`), so a tab and what it shows are a
 * link and the back button works. A tab is one entry in `TABS`; each takes the
 * rest of the route's parameters, such as the table or node it shows. The
 * tab ids of D-114 still open their tab, through `TAB_ALIASES`.
 */

import type { ReactNode } from 'react'

import { hrefFor, useRoute } from '../../app/router'
import { useSettings } from '../../app/use-settings'
import { Screen } from '../screen'
import { GraphTab } from './graph-tab'
import { OntologyTab } from './ontology-tab'
import { OverviewTab } from './overview-tab'
import { ScenariosTab } from './scenarios-tab'
import { Warehouse } from './warehouse'

type TabId = 'overview' | 'tables' | 'graph' | 'concepts' | 'stories'

interface Tab {
  id: TabId
  label: string
  render: (params: URLSearchParams, scale: number) => ReactNode
}

/**
 * The five tabs, in order. Overview opens when the address names no tab.
 * Tables, Concepts and Stories show the views of D-114 until each is rebuilt
 * on the explorer layout.
 */
const TABS: readonly Tab[] = [
  {
    id: 'overview',
    label: 'Overview',
    render: (_params, scale) => <OverviewTab scale={scale} />,
  },
  {
    id: 'tables',
    label: 'Tables',
    render: (params, scale) => <Warehouse params={params} scale={scale} />,
  },
  {
    id: 'graph',
    label: 'Graph',
    render: (params, scale) => <GraphTab params={params} scale={scale} />,
  },
  {
    id: 'concepts',
    label: 'Concepts',
    render: (params) => <OntologyTab params={params} />,
  },
  {
    id: 'stories',
    label: 'Stories',
    render: () => <ScenariosTab />,
  },
]

/** The tab ids before D-115, kept so old links and Help's links still open their tab. */
const TAB_ALIASES: Readonly<Record<string, TabId>> = {
  warehouse: 'tables',
  ontology: 'concepts',
  scenarios: 'stories',
}

function tabFor(id: string | null): Tab {
  const resolved = id === null ? undefined : (TAB_ALIASES[id] ?? id)
  return TABS.find((t) => t.id === resolved) ?? TABS[0]
}

/** Presentation mode raises the type in the maps by this factor. */
const PRESENTATION_SCALE = 1.4

export function DataModel() {
  const { params } = useRoute()
  const { presentation } = useSettings()
  const tab = tabFor(params.get('tab'))
  return (
    <Screen destination="data-model">
      <nav
        aria-label="Data Model sections"
        className="flex gap-2 border-b border-hairline"
      >
        {TABS.map((t) => (
          <a
            key={t.id}
            href={hrefFor('data-model', { tab: t.id })}
            aria-current={t.id === tab.id ? 'page' : undefined}
            className="px-3 py-2 text-sm font-medium text-text-secondary aria-[current=page]:font-semibold aria-[current=page]:text-text-primary aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[10px]"
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab.render(params, presentation ? PRESENTATION_SCALE : 1)}
    </Screen>
  )
}
