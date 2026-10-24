/**
 * The plain words screens use in place of the project's working terms.
 * Keys are the banned terms (see `banned-words.test.ts`); values are what
 * product copy says instead. Help's glossary shows `GLOSSARY_TERMS` below.
 */
export const GLOSSARY = {
  seed: 'starting point',
  chunk: 'passage',
  rerank: 're-ordering',
  reranked: 're-ordered',
  telemetry: 'activity record',
  MAPS_TO: 'is an instance of concept',
  prototype: 'early version',
} as const satisfies Record<string, string>

/** What Help's glossary shows: twelve terms, about twelve words each. */
export const GLOSSARY_TERMS: readonly { term: string; meaning: string }[] = [
  {
    term: 'Answer key',
    meaning:
      'The correct answer to a question, written down before any approach is run.',
  },
  {
    term: 'Concept',
    meaning:
      'One shared meaning in the ontology, such as a game family that each market names differently.',
  },
  {
    term: 'Enterprise ontology',
    meaning:
      'The shared vocabulary that ties each market’s local terms to one concept.',
  },
  {
    term: 'Evidence score',
    meaning:
      'How much of the needed evidence an approach found without padding, from 0 to 1.',
  },
  {
    term: 'Hidden truth',
    meaning:
      'The fact planted behind a story. Help shows it, and no approach can see it.',
  },
  {
    term: 'Interval',
    meaning:
      'The range a difference between two approaches most likely lies in, with 95 percent confidence.',
  },
  {
    term: 'Official run',
    meaning:
      'Every question run on three worlds, three times each, scored identically for all approaches.',
  },
  {
    term: 'Passage',
    meaning:
      'A short piece of a document. It is the unit that text search finds.',
  },
  {
    term: 'Planted story',
    meaning:
      'A pattern added to the synthetic data on purpose, so its true answer is known.',
  },
  {
    term: 'Re-ordering',
    meaning:
      'Ranking found items again so the most useful ones fill the limited space.',
  },
  {
    term: 'Starting point',
    meaning:
      'Where the graph walk begins, picked from the question’s words. Not the starting record.',
  },
  {
    term: 'Starting record',
    meaning:
      'The record the question names, which the evidence must start from. Not the graph’s starting point.',
  },
]
