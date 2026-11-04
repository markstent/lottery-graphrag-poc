/**
 * How each layer of the data model is built, in plain words above each tab's
 * map (D-101, D-113): what is in it, where it comes from and how a search
 * uses it. The counts and limits come from the API, so the text follows the
 * model it describes.
 */

import { Panel } from '../../components/panel'

interface Group {
  heading: string
  points: readonly string[]
}

function Groups({ groups }: { groups: readonly Group[] }) {
  return (
    <div className="grid gap-x-10 gap-y-4 lg:grid-cols-3">
      {groups.map(({ heading, points }) => (
        <section key={heading} aria-label={heading} className="space-y-2">
          <h3 className="text-base font-semibold text-text-primary">
            {heading}
          </h3>
          <ul className="list-disc space-y-2 pl-5 text-base text-text-primary">
            {points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function WarehouseWhy() {
  return (
    <Panel title="What the warehouse is" state="ready">
      <Groups
        groups={[
          {
            heading: 'What is in it',
            points: [
              "The company's own data: the tables of seven systems, such as sales, app releases, incidents, support and documents.",
              'All of it is made up for this test, by a program that builds the same world every time.',
            ],
          },
          {
            heading: 'How to read the maps',
            points: [
              'Each box is a table, with how many rows it has.',
              'An arrow means a column in one table names a row in the other: a game names its family, so games point to game families.',
              'Choose a table to see its rows.',
            ],
          },
          {
            heading: 'How the approaches use it',
            points: [
              'Text search reads the main tables, such as games, incidents and support cases, written out as short sentences beside the documents. Bulk tables such as tickets are left out.',
              'Graph and Graph + Ontology read the same sentences, and also walk the graph, which is built from these tables.',
            ],
          },
        ]}
      />
    </Panel>
  )
}

export function GraphWhy({ caps }: { caps: Record<string, number> }) {
  return (
    <Panel title="How the graph is built" state="ready">
      <Groups
        groups={[
          {
            heading: 'What is in it',
            points: [
              'A map drawn over the warehouse tables. Each record in it, such as a game, an incident or a player, comes from one table row and points back to it.',
              'Bulk detail, such as single tickets, sessions and daily sales, stays in the tables. Copied in, it would bury the links a search needs.',
            ],
          },
          {
            heading: 'Where the links come from',
            points: [
              'The kinds of link were designed up front, from the questions people ask: each step a person takes from one record to the next became a kind of link.',
              'No AI model makes them. A program builds every link from the tables when the graph is loaded, in one of three ways.',
              'Copied from a column: an incident row names its platform version, so the incident is linked to that version.',
              'Counted from bulk rows: a player is linked to each game they bought tickets for, with the number of tickets on the link.',
              "Worked out by a rule: the ontology links each country's own code to the shared idea it stands for, and each game to the most alike games in other countries.",
              "So most links are the warehouse's own column links, made walkable. What the graph adds is the walking, plus the counted, worked-out and ontology links the tables do not hold.",
              'The table below says which way each kind of link is made.',
            ],
          },
          {
            heading: 'How a search uses them',
            points: [
              `A search starts at the records a question names and moves along links, at most ${caps.max_depth} steps and ${caps.max_total_nodes} records.`,
              'For "which other markets had incidents on the same platform version?", it goes from the incident to its platform version, then to the other incidents on that version, which name their markets.',
              'Some kinds of link are left out so a search stays on topic. The table below says which, and why.',
              'Graph and Graph + Ontology search the same graph. Graph may not follow the ontology links, so the gap between them measures the ontology alone.',
            ],
          },
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
    <Panel title="How the ontology is built" state="ready">
      <Groups
        groups={[
          {
            heading: 'The problem it solves',
            points: [
              "Each country names the same things in its own way and language: the UK's National Draw is Austria's Zahlenziehung.",
              'Nothing in the tables says they are the same kind of game, so a search about one country cannot find the matching things in the others.',
            ],
          },
          {
            heading: 'What is in it',
            points: [
              `A shared dictionary of ${concepts} business ideas, called concepts, such as kinds of game, incident and player group, written by hand in one file.`,
              'Each idea has a name in English, Greek, German and Czech, the other names people use for it, and a broader idea it sits under: a national draw is a kind of draw game, which is a kind of lottery product.',
              `${bindings} entries match each country's own codes to an idea. Choose a concept on the left to see each country's terms for it on the right.`,
            ],
          },
          {
            heading: 'How a search uses it',
            points: [
              "In the graph, each entry becomes a link from the country's code to the shared idea, so a search can cross from one country to the others.",
              'Only Graph + Ontology may follow these links. Graph may not, so the gap between them measures the ontology alone.',
              'The file is kept apart from the test questions and the planted stories, and a test checks it cannot read them.',
            ],
          },
        ]}
      />
    </Panel>
  )
}

export function ScenariosWhy() {
  return (
    <Panel title="What the planted stories are" state="ready">
      <Groups
        groups={[
          {
            heading: 'What a story is',
            points: [
              'A pattern hidden in the made-up world on purpose, such as an app release that breaks checkout on one kind of device.',
              'Because we planted it, we know what there is to find, so we can tell whether an approach found it.',
              'The record of what was planted is kept where no approach can read it.',
            ],
          },
          {
            heading: 'How to read a card',
            points: [
              'Strength: how clear the signal is, from 0.2 subtle to 1.0 obvious. A stronger story plants a bigger signal.',
              'Noise level: how much ordinary activity surrounds the signal, as the story was designed.',
              'Rows added: how many rows the story put into each table.',
            ],
          },
          {
            heading: 'Where to go next',
            points: [
              '"Read the story" tells what happened, in plain words.',
              '"See its questions" lists the test questions that ask about it.',
            ],
          },
        ]}
      />
    </Panel>
  )
}
