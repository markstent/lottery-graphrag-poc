/**
 * The plain words screens use in place of the project's working terms.
 * Keys are the banned terms (see `banned-words.test.ts`); values are what
 * product copy says instead. Help's glossary renders from this map.
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
