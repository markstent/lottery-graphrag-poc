/**
 * Why the graph and the ontology are built the way they are (D-101), in plain
 * words above each tab's map. The counts and limits come from the API, so the
 * text follows the model it describes.
 */

import { Panel } from '../../components/panel'

function Points({ points }: { points: readonly string[] }) {
  return (
    <ul className="list-disc gap-x-10 pl-5 text-base text-text-primary lg:columns-2">
      {points.map((point) => (
        <li key={point} className="mb-2 break-inside-avoid">
          {point}
        </li>
      ))}
    </ul>
  )
}

export function GraphWhy({ caps }: { caps: Record<string, number> }) {
  return (
    <Panel title="Why the graph is built this way" state="ready">
      <Points
        points={[
          'It sits on top of the company tables and does not replace them. Every record in it points back to the table row it came from, so each fact can be traced.',
          'It holds the things people ask about, such as games, incidents, platform versions, campaigns and players, and the links between them: this incident ran on that platform version, this game belongs to that family.',
          'Bulk detail, such as single tickets, sessions and daily sales, stays in the tables. Copied in, it would bury the links a search needs.',
          `A search follows only chosen kinds of link, at most ${caps.max_depth} steps and ${caps.max_total_nodes} records, so it stays on topic.`,
          'Graph and Graph + Ontology search the same graph. Graph may not use the ontology links, so the gap between them measures the ontology alone.',
        ]}
      />
    </Panel>
  )
}

export function OntologyWhy({
  concepts,
  bindings,
}: {
  concepts: number
  bindings: number
}) {
  return (
    <Panel title="Why the ontology is built this way" state="ready">
      <Points
        points={[
          "Each country names the same things in its own way and language: the UK's National Draw is Austria's Zahlenziehung. Nothing in the tables says they are the same kind of game.",
          `The ontology is one shared dictionary of ${concepts} business ideas, such as kinds of game, incident and player group, each named in English, Greek, German and Czech.`,
          `${bindings} links tie each country's own codes to those ideas, so a question about one country can reach the matching things in the others.`,
          'It is written in one file, apart from the test questions and the planted stories, and a test checks it cannot read them.',
          'It is kept separate so its value can be measured on its own: Graph + Ontology uses it and Graph does not.',
        ]}
      />
    </Panel>
  )
}
