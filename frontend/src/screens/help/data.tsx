import { hrefFor } from '../../app/router'

const TOUR = [
  {
    tab: 'warehouse',
    name: 'Warehouse',
    line: 'The tables of players, tickets, games, incidents and documents, with their row counts.',
  },
  {
    tab: 'graph',
    name: 'Graph',
    line: 'The same records as nodes joined by relationships, each pointing back to its source row.',
  },
  {
    tab: 'ontology',
    name: 'Ontology',
    line: 'The shared concepts, and the local term each market uses for them.',
  },
  {
    tab: 'scenarios',
    name: 'Scenarios',
    line: 'The stories planted in the data, with how strongly each is planted.',
  },
] as const

export function DataTour() {
  return (
    <ul className="space-y-1">
      {TOUR.map(({ tab, name, line }) => (
        <li key={tab}>
          <a
            href={hrefFor('data-model', { tab })}
            className="font-semibold text-text-primary underline"
          >
            {name}
          </a>
          : {line}
        </li>
      ))}
    </ul>
  )
}
