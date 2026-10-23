/**
 * The frame every destination sits in: its purpose sentence first, then its
 * heading, then the content. Both come from the destination table (spec 7.1),
 * so no screen writes its own. Type sizes use the design tokens, which
 * presentation mode raises.
 */

import type { ReactNode } from 'react'

import { DESTINATIONS, type Destination, type RouteName } from '../app/router'

const BY_NAME = Object.fromEntries(
  DESTINATIONS.map((destination) => [destination.name, destination]),
) as Record<RouteName, Destination>

export function Screen({
  destination,
  children,
}: {
  destination: RouteName
  children: ReactNode
}) {
  const { label, purpose } = BY_NAME[destination]
  return (
    <div data-testid="screen" className="space-y-4">
      <p className="text-sm text-text-secondary">{purpose}</p>
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">
        {label}
      </h1>
      {children}
    </div>
  )
}
