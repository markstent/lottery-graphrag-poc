/** The steps of each Data Model tab and the look of a next-step link (D-114). */

/** The look of a link that takes the reader on to the next step. */
export const NEXT_STEP =
  'inline-flex items-center gap-1.5 rounded-chip bg-text-primary px-4 py-2 text-sm font-semibold text-surface hover:opacity-90'

export const STEPS = {
  warehouse: [
    'Choose a table in one of the maps.',
    "Choose a row to open that record's details.",
    'Follow the record into the graph to see what it links to.',
  ],
  graph: [
    'Choose a kind of record in the map for its details and a sample.',
    'Open the sample record in the graph.',
    'Choose any record around it to move there, one link at a time.',
  ],
  ontology: [
    'Choose a concept in the tree on the left.',
    'Read its names in four languages and the broader idea it sits under.',
    "See each country's own terms for it on the right, and pick a country to narrow them.",
  ],
  scenarios: [
    'Pick a story card below.',
    'Read the story for what happened, in plain words.',
    'See its questions, the test questions that ask about it.',
  ],
} as const satisfies Record<string, readonly [string, string, string]>
