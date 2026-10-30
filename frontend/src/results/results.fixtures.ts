/**
 * The captured and generated Results API answers, typed, for the tests of this folder and the Results screen.
 * JSON imports are inferred per value (a class absent from one row is `undefined`), so the casts go through unknown.
 */

import type { Schemas } from '../api/client'
import officialInstances from '../../e2e/fixtures/results-official-instances.json'
import officialSummary from '../../e2e/fixtures/results-official-summary.json'
import pilotInstances from '../../e2e/fixtures/results-pilot-instances.json'
import pilotSummary from '../../e2e/fixtures/results-pilot-summary.json'
import runsJson from '../../e2e/fixtures/results-runs.json'
import smokeSummary from '../../e2e/fixtures/results-smoke-summary.json'
import v03Instances from '../../e2e/fixtures/results-v03-instances.json'
import v03Summary from '../../e2e/fixtures/results-v03-summary.json'

export const RUNS = runsJson as Schemas['BenchmarkRunOut'][]
export const PILOT = (pilotSummary as Schemas['BenchmarkSummary']).summary
export const PILOT_INSTANCES =
  pilotInstances as unknown as Schemas['InstanceResultOut'][]
export const OFFICIAL = (officialSummary as Schemas['BenchmarkSummary']).summary
export const OFFICIAL_INSTANCES =
  officialInstances as unknown as Schemas['InstanceResultOut'][]
export const SMOKE = (smokeSummary as Schemas['BenchmarkSummary']).summary
/** A method v0.3 run: the report tests' synthetic run through `summarize` (test values). */
export const V03_RUN = v03Summary as Schemas['BenchmarkSummary']
export const V03 = V03_RUN.summary
export const V03_INSTANCES =
  v03Instances as unknown as Schemas['InstanceResultOut'][]
