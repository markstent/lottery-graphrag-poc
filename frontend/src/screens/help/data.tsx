import { hrefFor } from '../../app/router'

const TOUR = [
  {
    tab: 'overview',
    name: 'Overview',
    line: 'Where the screen opens: the three layers side by side, and one record followed through all of them.',
  },
  {
    tab: 'tables',
    name: 'Tables',
    line: 'The tables of players, tickets, games, incidents and documents, with how many records each holds.',
  },
  {
    tab: 'graph',
    name: 'Graph',
    line: 'The same records as points joined by links, each pointing back to the row it came from.',
  },
  {
    tab: 'concepts',
    name: 'Concepts',
    line: 'The shared concepts, and the local term each market uses for them.',
  },
  {
    tab: 'stories',
    name: 'Stories',
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
