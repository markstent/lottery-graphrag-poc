/**
 * One line under a run's headlines: how many tested comparisons have an
 * interval that leaves out zero but fail the test, and where to see them.
 * The headlines stay as the harness wrote them; this line adds the count.
 */

import { plural } from '../charts/scale'

export function DisagreementNote({
  count,
  href,
}: {
  /** From `intervalTestDisagreements`; nothing is drawn for 0. */
  count: number
  /** Where the paired differences are, when they are on another screen. */
  href?: string
}) {
  if (count === 0) return null
  const target = 'Paired differences'
  return (
    <p className="text-sm text-text-secondary">
      {plural(count, 'tested comparison')} whose interval excludes zero failed
      the test; see{' '}
      {href ? (
        <a
          href={href}
          aria-label={`${target}, on Results`}
          className="text-text-primary underline"
        >
          {target}
        </a>
      ) : (
        target
      )}
      .
    </p>
  )
}
