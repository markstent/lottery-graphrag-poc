/** The two judges' combined mark of a run, tested as its own group (D-105). */

import { percent } from '../../app/score-words'
import { IntervalPlot } from '../../charts/interval-plot'
import { plural } from '../../charts/scale'
import { DisagreementNote } from '../../components/disagreement-note'
import { ScrollBox } from '../../components/scroll-box'
import { pipeline } from '../../design/pipelines'
import {
  disagreeRows,
  JUDGES,
  markRows,
  markTiles,
  type JudgesMark,
} from '../../results/judges'
import { QUESTION_HEADS } from '../../results/labels'
import { SECOND_JUDGE } from '../../results/second-judge'
import { intervalTestDisagreements } from '../../results/strata'
import { RunBadge } from './run-badge'

function DisagreeTable({ combined }: { combined: JudgesMark }) {
  const heads = [
    QUESTION_HEADS.question,
    QUESTION_HEADS.approach,
    SECOND_JUDGE.first,
    SECOND_JUDGE.title,
  ]
  return (
    <ScrollBox label={JUDGES.disagree} axis="y" className="max-h-96">
      <table className="w-full border-collapse text-sm text-text-primary">
        <caption className="sr-only">{JUDGES.disagree}</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-text-secondary">
            {heads.map((head) => (
              <th key={head} scope="col" className="py-2 pr-4 font-semibold">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {disagreeRows(combined).map((row) => (
            <tr key={row.key} className="border-b border-hairline align-top">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {row.question}
              </th>
              <td className="whitespace-nowrap py-2 pr-4">{row.approach}</td>
              <td className="py-2 pr-4">{row.first}</td>
              <td className="py-2 pr-4">{row.second}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  )
}

export function JudgesVerdict({
  combined,
  badge,
}: {
  combined: JudgesMark
  badge?: string
}) {
  const { counts } = combined
  return (
    <div className="space-y-6">
      <RunBadge label={badge} />
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {markTiles(combined).map(({ pipeline: id, mean }) => (
          <div key={id} className="space-y-1">
            <dt className="text-sm text-text-secondary">{`${JUDGES.mark}: ${pipeline(id).label}`}</dt>
            <dd className="tabular text-2xl font-semibold text-text-primary">
              {percent(mean)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1">
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
          {combined.headlines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
        <DisagreementNote
          count={intervalTestDisagreements(combined.comparisons)}
        />
      </div>
      <IntervalPlot
        title={`Paired differences in ${JUDGES.mark.toLowerCase()}`}
        rows={markRows(combined)}
        unit={`${JUDGES.mark.toLowerCase()} points`}
        zero
        badge={badge}
      />
      <p className="tabular text-sm text-text-primary">
        {`Same verdict on ${counts.agreed.toLocaleString('en-GB')} of ${plural(counts.both_judged, 'answer')}; opposite verdicts on ${counts.disagreements.toLocaleString('en-GB')}.`}
      </p>
      {counts.disagreements > 0 && (
        <section aria-labelledby="judges-disagree" className="space-y-2">
          <h3
            id="judges-disagree"
            className="text-sm font-semibold text-text-primary"
          >
            {JUDGES.disagree}
          </h3>
          <DisagreeTable combined={combined} />
        </section>
      )}
    </div>
  )
}
