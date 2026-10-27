import type { ChapterCopy } from '../chapters'

export const stories: ChapterCopy = {
  plain: [
    'A planted story is a pattern put into the data on purpose, such as one platform version that breaks checkout in three markets. Because it was planted, the correct answer is known before any approach runs.',
    'There are eight. Each tests a different kind of question: some need links followed across several records, two need the shared dictionary to match things across markets, and one sets an out-of-date document against the current record. Each story has one question in the question bank (chapter 10).',
    'What was planted, the hidden truth, is kept where no approach can see it. Only the scoring reads it, to write the answer keys and to mark the answers. Help is the one screen that shows it.',
    'Each card gives a story and its hidden truth. The cross-market platform incident is the worked example.',
    { kind: 'component', name: 'stories' },
  ],
  technical: [
    'The engine is backend/app/scenarios/. Eight scenarios are enabled in catalogue.py, each with an injector that plant.py maps to it. engine.py runs them in catalogue order, each from its own random stream keyed by the scenario seed and the scenario id, so one plant does not shift another. Seven more (SCN-004, 005, 006, 008, 012, 013 and 014) are registered with enabled=False and have no injector, and no bank question depends on them.',
    'The signals each scenario leaves in the data (docs/scenarios.md and the injectors):',
    [
      "SCN-001, app release conversion failure: one market's app release breaks checkout for one device family. The cohort's sessions abandon or fail, support contacts rise, and an incident and a release note follow.",
      'SCN-002, shared device cluster: eight accounts connect through three shared devices, with purchases close together in time.',
      'SCN-003, shared payment cluster: six accounts share two rarely used payment instruments, with normal spend per account.',
      'SCN-007, cross-market platform incident: one platform version degrades checkout in three markets with graded severity, and the fourth market deferred that version. No incident report names a sibling market.',
      "SCN-009, payment provider degradation: one payment provider used across markets fails on alternating days in the three markets where it holds the most payment methods, and no incident is raised. No market-level row names the provider: the link shows only through the players' payment methods, and a later corporate post-incident review names it.",
      'SCN-010, game mechanic affinity: one engaged segment over-indexes on the game built on one mechanic in three markets. Each market calls the mechanic and the segment by its own name, and the reviews use local names only.',
      "SCN-011, transferable campaign: a cross-sell campaign for one market's retail instant game succeeds. A second market has the same structure under its own names, and nothing is planted there.",
      "SCN-015, document and structured conflict: a superseded rules leaflet states an out-of-date price that contradicts the game's authoritative price.",
    ],
    'SCN-010 and SCN-011 were added for the ontology: the local names differ in each market, so the pattern is visible only through the shared concept. SCN-007 and SCN-009 run on platforms and payment providers, which are shared across markets, so they are graph stories.',
    "Strength and noise. Strength (0.2 subtle, 0.5 moderate, 0.8 strong, 1.0 obvious) scales how many rows are planted: the larger of a fixed minimum and share × strength × the market's daily volume (backend/app/scenarios/planter.py). Five scenarios run at 0.8 and SCN-009, SCN-010 and SCN-011 at 0.5. The noise level (low or moderate) is a label in the catalogue, recorded in the manifest and the ledger; no injector reads it. The noise around a plant is the generated world itself, because planted rows sit among ordinary rows of the same shape. Data Model's Scenarios tab lists each plant's strength, noise level and row counts in the loaded world.",
    'Rules that keep a plant from showing by its form: targets (markets, releases, providers, mechanics, segments, games) are drawn from the scenario seed among eligible candidates (D-016); a planted row takes the next id in its table and carries no scenario marker (D-014); injectors do not edit the daily KPIs, which are derived after planting (D-015); planted documents take the shapes of ordinary documents and do not name their sibling incidents; and failing sessions and complaints share one shape across scenarios.',
    "The truth ledger records what was planted. backend/app/scenarios/ledger.py writes it once per generation (version 2): data/truth/ledger.json for world 2026 and data/truth/dev-seed<seed>.json for 2027 and 2028, under schemas/benchmark/truth-ledger.schema.json. For each scenario it holds the strength and noise level, the start date and duration, the affected markets, games and segments, the expected signals, the record ids that carry the truth, and the scenario's own answer fields with the planted ids per table. The bank grounds the eight planted questions (L15 to L22) from the ledger alone, so their expected answers and claims come from nothing else.",
    'The isolation rule: retrieval code never imports, queries or reads the ledger (AGENTS.md), and only backend/app/evaluation/truth_ledger.py loads it. backend/tests/test_truth_ledger_isolation.py enforces this:',
    [
      'no module in retrieval, api, datasets, graph, ontology, scenarios, config, events, observability, persistence or models, nor lab.py, imports app.evaluation or names the ledger path;',
      'only the two API modules that publish evaluator output, benchmarks.py and scoring.py, import app.evaluation (D-035), and neither names the ledger;',
      'a test in a separate process checks that loading the lab and every retrieval module loads no evaluation module;',
      'the scenario package writes the ledger but does not import its loader;',
      "the manifest of a generated world names none of the ledger's fields.",
    ],
    "The hidden truths on the story cards come from GET /api/v1/benchmarks/questions, which reads the evaluator's output after the fact.",
  ],
}
