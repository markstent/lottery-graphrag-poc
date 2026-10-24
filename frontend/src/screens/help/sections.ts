/** The eight sections of Help, in the order of spec 7.7: the anchor each has in the route, its link and its heading. */
export const SECTIONS = [
  { id: 'what', nav: 'What we are testing', title: '1. What we are testing' },
  { id: 'approaches', nav: 'The approaches', title: '2. The three approaches' },
  { id: 'data', nav: 'The data', title: '3. The data' },
  { id: 'stories', nav: 'The stories', title: '4. The planted stories' },
  { id: 'questions', nav: 'The questions', title: '5. The questions' },
  { id: 'scoring', nav: 'Scoring', title: '6. How scoring works' },
  { id: 'glossary', nav: 'Glossary', title: '7. Glossary' },
  { id: 'running', nav: 'Running it', title: '8. Running it' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']
