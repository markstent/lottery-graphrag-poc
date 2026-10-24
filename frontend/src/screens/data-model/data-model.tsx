/**
 * Data Model: what the three approaches search. The tab is in the route
 * (`#/data-model?tab=graph`), so a tab and what it shows are a link and the
 * back button works. A tab is one entry in `TABS`; each takes the rest of the
 * route's parameters, such as the table or node it shows.
 */

import type { ReactNode } from 'react'

import { hrefFor, useRoute } from '../../app/router'
import { useSettings } from '../../app/use-settings'
import { Screen } from '../screen'
import { GraphTab } from './graph-tab'
import { Warehouse } from './warehouse'

interface Tab {
  id: string
  label: string
  render: (params: URLSearchParams, scale: number) => ReactNode
}

const TABS: readonly Tab[] = [
  {
    id: 'warehouse',
    label: 'Warehouse',
    render: (params, scale) => <Warehouse params={params} scale={scale} />,
  },
  {
    id: 'graph',
    label: 'Graph',
    render: (params, scale) => <GraphTab params={params} scale={scale} />,
  },
]

/** Presentation mode raises the type in the maps by this factor. */
const PRESENTATION_SCALE = 1.4

export function DataModel() {
  const { params } = useRoute()
  const { presentation } = useSettings()
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0]
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
