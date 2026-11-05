/**
 * The "About this" drawer content of an explorer tab: one layer's copy from
 * `about-copy.ts`, as plain headed lists.
 */

import type { AboutCopy } from './about-copy'

/** A layer's copy as plain content, for the "About this" drawer. */
export function AboutContent({ copy }: { copy: AboutCopy }) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-text-primary">{copy.title}</h3>
      {copy.groups.map(({ heading, points }) => (
        <section key={heading} aria-label={heading} className="space-y-2">
          <h4 className="text-base font-semibold text-text-primary">
            {heading}
          </h4>
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
