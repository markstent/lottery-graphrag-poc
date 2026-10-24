/** How scoring works, as docs/evaluation/scoring.md and statistics.md state it. */

import type { ReactNode } from 'react'

import { Section } from './section'

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {children}
    </div>
  )
}

export function Scoring() {
  return (
    <Section id="scoring">
      <Part title="Evidence found">
        <p>
          Evidence score runs from 0 to 1: 1 is all the needed evidence and
          nothing extra. Each question lists the claims a correct answer makes,
          and the records or documents that state them. The score balances the
          share of claims found against the share of items used that carry a
          claim. All three approaches get the same limits, 12 items and 2,000
          tokens by default. The anchor is left out, so finding it earns
          nothing. When no claim is left, the score reads Missing and the
          question counts for the answer only.
        </p>
      </Part>
      <Part title="Correct answer">
        <p>
          The answer score runs from 0 to 1. It is the mean of the checks
          written from the answer key. A name, a yes or no and a number are
          right or wrong, a set of ids earns partial credit, and a number earns
          half credit when the answer also states a contradicting number. The
          same checks apply to all three approaches.
        </p>
      </Part>
      <Part title="Judge">
        <p>
          A second model, from another family than the one that answers, scores
          five things from 0 to 2: correctness, completeness, faithfulness to
          the evidence shown, citation accuracy and appropriate abstention. It
          is not told which approach produced an answer. Its scores sit beside
          the checks and do not replace them.
        </p>
      </Part>
      <Part title="Intervals">
        <p>
          Two comparisons are made: Graph against Text search, and Graph +
          Ontology against Graph. Each shows the mean difference with a 95
          percent interval, from 10,000 resamples of the question groups. A
          difference is called significant only after correcting for the number
          of tests, at p below 0.05. A comparison with fewer than 10 pairs or 6
          groups says there are too few pairs to say.
        </p>
      </Part>
    </Section>
  )
}
