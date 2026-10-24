/** The per-question table: which rows a filter keeps, in what order, and whether a row can be opened in Live Lab. */

import type { Schemas } from '../api/client'
import { hrefFor } from '../app/router'
import { STRATUM_ORDER } from './strata'

type Row = Schemas['InstanceResultOut']

export type QuestionFilter = {
  stratum: string | null
  failure: { pipeline: string; cls: string } | null
  world: number | null
}

/** The stratum a row is reported under: name-anchored H2 questions are their own group. */
const stratumOf = (row: Row) =>
  row.stratum === 'H2' && row.sub_stratum === 'name_anchored'
    ? 'H2_name'
    : row.stratum

const rank = (row: Row) => STRATUM_ORDER.indexOf(stratumOf(row))

/** The rows that pass every set filter, by stratum order, then question id, then world. */
export function filterInstances(rows: Row[], f: QuestionFilter): Row[] {
  return rows
    .filter(
      (row) =>
        (f.stratum === null || stratumOf(row) === f.stratum) &&
        (f.world === null || row.world_seed === f.world) &&
        (f.failure === null ||
          (row.pipelines[f.failure.pipeline]?.failure_classes[f.failure.cls] ??
            0) > 0),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.question_id.localeCompare(b.question_id) ||
        a.world_seed - b.world_seed,
    )
}

/** A link into Live Lab only for the loaded world, otherwise the reason there is none. */
export function liveLabLink(
  row: Row,
  activeWorldSeed: number | null,
): { href: string } | { reason: string } {
  if (activeWorldSeed === null) return { reason: 'No world is loaded' }
  if (row.world_seed !== activeWorldSeed)
    return { reason: `Loaded world is ${activeWorldSeed}` }
  return { href: hrefFor('live-lab', { question: row.instance_id }) }
}
