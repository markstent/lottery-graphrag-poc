/** What the run was made with: its own settings, then each world's, so a result can be repeated. */

import type { Schemas } from '../../api/client'
import { reproFields } from '../../results/reproducibility'

type Fields = Schemas['ReproducibilityOut']['run']

function FieldList({
  record,
  worlds,
}: {
  record: Fields
  worlds?: readonly Fields[]
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-[minmax(0,20rem)_1fr]">
      {reproFields(record, worlds).map(({ key, value }) => (
        <div key={key} className="contents">
          <dt className="wrap-anywhere font-mono text-text-secondary md:wrap-normal">
            {key}
          </dt>
          <dd className="wrap-anywhere pl-4 font-mono text-text-primary md:break-words md:pl-0">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ReproPanel({
  runId,
  record,
}: {
  runId: string
  record: Schemas['ReproducibilityOut']
}) {
  return (
    <div className="space-y-4">
      <FieldList record={record.run} worlds={record.worlds} />
      {record.worlds.map((world, index) => (
        <details key={String(world.world_seed ?? index)}>
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">
            {`World ${String(world.world_seed ?? index + 1)}`}
          </summary>
          <div className="mt-2">
            <FieldList record={world} />
          </div>
        </details>
      ))}
      <a
        href={`/api/v1/benchmarks/${runId}`}
        className="text-sm text-text-secondary underline"
      >
        Raw record
      </a>
    </div>
  )
}
