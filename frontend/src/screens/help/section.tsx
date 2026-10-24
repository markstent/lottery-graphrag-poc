/**
 * One Help section: an anchor the route can scroll to, in the Panel every
 * destination uses. A section that needs the question bank takes its load,
 * so it shows the loading and error states while the rest of Help reads.
 */

import type { ReactNode } from 'react'

import type { Load } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { SECTIONS, type SectionId } from './sections'

export function Section({
  id,
  load,
  children,
}: {
  id: SectionId
  load?: Load<unknown>
  children: ReactNode
}) {
  const { title } = SECTIONS.find((section) => section.id === id)!
  return (
    <div id={id} className="scroll-mt-4">
      <Panel
        title={title}
        state={load?.status ?? 'ready'}
        error={load?.status === 'error' ? load.error : undefined}
        onRetry={load?.retry}
      >
        <div className="space-y-3 text-base text-text-secondary [&>p]:max-w-4xl">
          {children}
        </div>
      </Panel>
    </div>
  )
}
