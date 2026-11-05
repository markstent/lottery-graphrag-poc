# Scenarios and the truth ledger

This page describes the eight patterns planted into each synthetic world, how they are planted, and the truth ledger that records what was planted.
The world they are planted into is in [data.md](data.md).
The questions that test them are in [evaluation.md](evaluation.md).

## Purpose

A planted scenario gives the benchmark a known hidden truth.
The signal is placed in the structured data, the support records, the sessions and the documents.
The truth ledger holds the answer, and only the evaluator may read it.
A pipeline that finds the pattern has found it in the data, because the ledger is out of its reach.

Planted patterns are produced only by the scenario system.
No benchmark dataset is patched by hand to make a demonstration work.

## The eight scenarios

| Scenario | Signal planted | Questions that test it |
|---|---|---|
| SCN-001 app release conversion failure | One market's app release breaks checkout for one device family. Cohort sessions abandon or fail, support contacts rise, and an incident and a release note follow. | L15 |
| SCN-002 shared device cluster | Eight accounts connect through three shared devices with coordinated purchases. | L16 |
| SCN-003 shared payment cluster | Six accounts share two rarely used payment instruments with normal spend. | L17 |
| SCN-007 cross-market platform incident | One platform version degrades checkout in three markets with graded severity, and the fourth market deferred it. No report names a sibling market. | L18 |
| SCN-009 payment provider degradation | One cross-market payment provider fails intermittently on alternating days in three markets, with no incident raised. Only the payment-method links reveal it. | L19 |
| SCN-010 game mechanic affinity | One engaged segment over-indexes on the product built on one mechanic in three markets. Reviews use local names only. | L20 |
| SCN-011 transferable campaign | A cross-sell campaign for one market's retail instant game succeeds. A second market has the same structure, with nothing planted there. | L21 |
| SCN-015 document and structured conflict | A superseded rules leaflet states a stale price that contradicts the authoritative game price. | L22 |

SCN-010 and SCN-011 need the ontology.
The local mechanic, family and segment names differ in each market, so the affinity or the transfer target is visible only through the canonical concept.
That is why they were added: they give the ontology work that the graph relationships alone cannot do (design section 5.3).

What each scenario plants in the seed 2026 development world, from its manifest:

| Scenario | Strength | Noise | Rows planted |
|---|---|---|---|
| SCN-001 | 0.8 | moderate | 5 devices, 5 player-device links, 150 sessions, 8 support cases, 1 incident, 2 incident-game links, 2 documents with 2 chunks |
| SCN-002 | 0.8 | low | 3 devices, 16 player-device links, 24 tickets |
| SCN-003 | 0.8 | low | 12 player-payment-method links |
| SCN-007 | 0.8 | moderate | 3 incidents, 6 incident-game links, 52 sessions, 18 support cases, 4 documents with 4 chunks |
| SCN-009 | 0.5 | moderate | 196 sessions, 12 support cases, 1 document with 1 chunk |
| SCN-010 | 0.5 | low | 24,449 tickets, 3 documents with 3 chunks |
| SCN-011 | 0.5 | low | 1 campaign, 1 campaign-game link, 40 exposures, 1 document with 1 chunk |
| SCN-015 | 0.8 | low | 1 document with 1 chunk |

The strength numbers are 0.2 subtle, 0.5 moderate, 0.8 strong and 1.0 obvious.

### Not planted

Seven further scenarios are registered in `backend/app/scenarios/catalogue.py` with `enabled=False`, and have no injector: SCN-004 promotion-driven product migration, SCN-005 product cannibalisation, SCN-006 jackpot halo effect, SCN-008 campaign audience mismatch, SCN-012 support complaint precursor, SCN-013 retailer regional anomaly and SCN-014 digital adoption shift.
The archived catalogue still describes them as designs.
The published bank has no question that depends on one of them.

## Architecture

### Planting

The engine is `backend/app/scenarios/`.

- `catalogue.py` holds the static configuration: id, type, description, strength, noise level and the signals a pipeline could observe.
- `plant.py` maps each enabled scenario to its injector.
- `engine.py` runs the enabled injectors in catalogue order.
  Each uses its own random stream, keyed by the scenario seed and the scenario id, so one scenario's draws never shift another's.
- `planter.py` gives injectors the shared lookups, and hands out ids.
- `inject_*.py` are the injectors: checkout and release (SCN-001, SCN-009), topology (SCN-002, SCN-003), operations (SCN-007), ontology (SCN-010, SCN-011) and documents (SCN-015).
- `ledger.py` builds and writes the truth ledger.

An injector writes rows into the already generated world.
After all injectors have run, the engine re-derives the daily KPIs from the final rows, refreshes the manifest's row counts, and the world is validated as a whole.
The manifest records which scenarios were applied with their strength, noise level and planted row counts, and never where or why.

Rules that keep the plants from being detectable by their form:

- Targets (markets, releases, providers, mechanics, segments, games) are drawn from the scenario seed among eligible candidates (D-016).
  Different scenario seeds plant different targets, and the same seed reproduces the same plant.
- A planted row takes the next id in its table's sequence and carries no scenario marker (D-014).
  Scenario membership is recorded in the ledger only.
- Injectors never edit `kpi_daily`, because KPIs are derived after planting (D-015).
- Planted documents take the same shape as baseline documents.
  They do not name their sibling incidents in other markets.
- Planted failing sessions and complaints share one shape across scenarios (session length, hours a complaint stays open, sentiment range), so scenarios do not differ by how their rows look.

### The truth ledger

The ledger is written once per generation, to `data/truth/ledger.json` for the development world, `data/truth/dev-seed<seed>.json` for the other two benchmark worlds and `data/truth/ledger-demo.json` for the demo world.
`ledger.py` is the only sanctioned writer.
The loader is in `backend/app/evaluation/truth_ledger.py`, and only the evaluation package may import it.
The schema is `schemas/benchmark/truth-ledger.schema.json`.

A ledger has a version (currently 2), the scenario seed, the world it belongs to (profile, world seed, generator version) and one record for each planted scenario:

| Field | Meaning |
|---|---|
| `scenario_id`, `scenario_type`, `enabled` | Which scenario |
| `strength`, `noise_level` | How strong the signal is and how much noise surrounds it |
| `start_date`, `duration_days` | When the planted behaviour starts and how long it lasts |
| `affected_markets`, `affected_games`, `affected_segments` | What the plant touched |
| `expected_signals` | The observable signals, in words |
| `benchmark_questions` | The catalogue's example questions |
| `required_evidence` | The record ids that carry the truth |
| `truth` | The scenario's own answer fields, plus `planted_ids` per table |

The `truth` fields differ by scenario.
For example SCN-001 holds the app version, the device family, the incident and its report, and SCN-007 holds the root cause entity, the primary and related markets, the required path and the explanation for the unaffected market.

The ledger feeds only the evaluator.
The benchmark grounds the planted questions (L15 to L22) from it and takes their expected answers and their claims from nothing else.
The Help screen shows the planted stories' hidden truths, served by `GET /api/v1/benchmarks/questions`, which reads evaluator output after the fact.

## Operation

Scenarios are planted whenever a world is generated (`make generate-dev-data`).
`--no-scenarios` generates a baseline world without them, and `--scenario-seed` sets the scenario seed, which defaults to 2026.
In a benchmark run the scenario seed equals the world seed.

The Stories tab of the Data Model screen lists each enabled scenario with its strength, noise level and planted row counts, read from the active dataset's manifest.
A scenario that is not in the active world reads "Not planted in this world".
The tab shows what was planted and never where, because the ledger is not read there.

## Configuration

The scenarios have no environment variables.
The catalogue is code, and the seeds are command-line options of the generator.
The ledger's location is set by `TRUTH_LEDGER_PATH`, which only `app.evaluation` reads.

## Testing

- `test_scenarios_v2.py`: each planted pattern, its ledger metadata and its determinism.
- `test_golden_world.py`: a golden hash over the world and the ledger across processes.
- `test_truth_ledger_isolation.py`: the isolation rules (see [architecture.md](architecture.md)).
- `test_benchmark_grounding.py`: grounding of the bank, including the planted questions, into a world and its ledger.

## Extension points

To plant a new pattern:

1. write an injector in a `scenarios/inject_*.py` module, taking a `ScenarioPlanter`;
2. register it in `plant.py`;
3. set the catalogue entry to enabled (flipping the flag without an injector makes the engine fail);
4. add a bank question that needs it, and a ledger-based grounder, in `app/evaluation/`;
5. regenerate the golden fixture, because the world changes.

A change to a plant changes every world generated from then on, so a benchmark must be re-run on the new worlds.

## Failure modes

| Failure | What happens |
|---|---|
| A scenario is enabled with no injector | `RuntimeError` naming the scenario, at generation. |
| A planted world fails validation | Nothing is written. |
| A ledger is read for another world | Grounding refuses a ledger whose world seed differs from the world's manifest. |
| A ledger value reaches retrieval | A critical defect. The isolation tests exist to catch it. |

The archived catalogue is [reference/04-scenario-catalogue.md](reference/04-scenario-catalogue.md).
