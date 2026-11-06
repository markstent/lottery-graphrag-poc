/** Chapter 10, the glossary: every term used in Help (src/copy/glossary.ts). */

import type { ChapterCopy } from '../chapters'

export const glossary: ChapterCopy = {
  plain: [
    'Every term Help uses, with its meaning in plain words.',
    { kind: 'heading', text: 'Terms from A to Z' },
    { kind: 'component', name: 'glossary' },
  ],
  plainHint:
    'The Technical level adds, where it helps, the name the code uses and where the term is defined.',
  technical: [],
}
