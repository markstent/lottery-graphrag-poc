import type { ChapterCopy } from '../chapters'

/**
 * Each planted story in plain words, by scenario id, as the Plain level of a
 * story card tells it: what was planted, in which countries, and what a
 * correct answer must find. Each is written from the hidden truth and the
 * answer key of world 2026, the world Help's question bank is grounded in,
 * and from docs/scenarios.md; a test checks that each names exactly the
 * countries whose codes that hidden truth and answer key hold. The hidden
 * truth itself, with its record codes, shows at Technical.
 */
export const PLAIN_STORIES: Readonly<Record<string, string>> = {
  'SCN-001':
    'In Greece, a new release of the mobile app broke checkout for players on iOS devices. After the release, more of their app sessions were abandoned or failed, and more players contacted support. An incident was logged, with a release note and an incident report. A correct answer must trace the incident back to that app release.',
  'SCN-002':
    'Eight player accounts in Greece used the same three devices. Together they bought 24 tickets for one game within 120 minutes, from 20:00 on 31 May 2025. This is an unusual cluster worth a closer look. On its own it does not prove fraud. A correct answer must find the other seven players who share a device with one of them.',
  'SCN-003':
    'Six player accounts in the Czech Republic share two payment methods that few other accounts use. Each account spends a normal amount. What is unusual is how the accounts are linked. A correct answer, given one of the accounts, must find the others that share a payment method with it. The answer key also counts two accounts in the United Kingdom that share a payment method with that account. How such extra accounts should be scored is still open (chapter 9).',
  'SCN-007':
    'One version of the payments platform caused checkout incidents in three countries: Greece, the main market affected, and Austria and the Czech Republic. The United Kingdom was not affected, because it had put off that update. No incident report mentions the other countries. A correct answer must name the other countries with incidents on that platform version, and the one that was not affected. Finding them means following the links from one incident to the platform version and on to the others.',
  'SCN-009':
    'One payment provider, used in several countries, kept failing on and off. It failed on 7 days between 19 and 31 August 2025, in the United Kingdom, Greece and Austria. No incident was raised. No country’s own records, such as its incidents or daily figures, name the provider. The link shows only through the payment methods players used, and a later company review names it. A correct answer must find the provider behind a support case, and the countries it affected.',
  'SCN-010':
    'Engaged players, who play often and recently, favour quick pick games more than other players do. In a quick pick game the system picks the player’s numbers at random. The pattern was planted in one game in each of Austria, Greece and the United Kingdom. The Czech Republic was left as it was, for comparison. Each country has its own name for the game mechanic and for the engaged players. So the three are one pattern only through the shared dictionary, the ontology. A correct answer must find the matching games in the other countries.',
  'SCN-011':
    'In Greece, a campaign aimed at engaged players worked well. It promoted an instant game sold in shops. Austria has the same kind of game and the same kind of players, under its own local names. Nothing was planted in Austria. So running the campaign there is a reasonable suggestion, with moderate confidence, not a certainty. A correct answer must name the Austrian game as the best place to run the campaign next.',
  'SCN-015':
    'An old rules leaflet for one game in Austria states a ticket price of 1.50 euros. The game’s own record, the trusted source, says 2.50 euros. The leaflet’s end date shows it is out of date. A correct answer must give the current price from the record, and say that the leaflet is no longer valid.',
}

export const stories: ChapterCopy = {
  plain: [
    'A planted story is a pattern put into the data on purpose, such as one version of a platform breaking checkout in three countries.',
    {
      kind: 'key',
      text: 'Because each story was planted, its correct answer is known before any approach runs.',
    },
    { kind: 'heading', text: 'Eight stories, eight kinds of question' },
    'There are eight. Each tests a different kind of question:',
    [
      'some need links followed across several records;',
      'two need the shared dictionary, the ontology, to match things across countries;',
      'one sets an out-of-date document against the current record.',
    ],
    'Each story has one question in the question bank, the fixed list of test questions (Questions and answers).',
    { kind: 'heading', text: 'The hidden truth' },
    'What was planted is called the hidden truth. It is kept where no approach can see it. Only the scoring reads it, to write the answer keys and to mark the answers.',
    'Help is the one screen that shows it, on the story cards at the Technical level.',
    { kind: 'heading', text: 'The story cards' },
    'Each card tells one story as it was planted in world 2026, the world the questions in Questions and answers use. It says what was planted, where, and what a correct answer must find. The platform incident across three countries is the worked example.',
    { kind: 'component', name: 'stories' },
  ],
  plainHint:
    'Choose Technical at the top of Help to see each hidden truth exactly as the scoring holds it, with the reference codes of its records.',
  technical: [
    { kind: 'heading', text: 'The engine' },
    'The engine is backend/app/scenarios/. Eight scenarios are enabled in catalogue.py, each with an injector that plant.py maps to it. engine.py runs them in catalogue order, each from its own random stream keyed by the scenario seed and the scenario id, so one plant does not shift another. Seven more (SCN-004, 005, 006, 008, 012, 013 and 014) are registered with enabled=False and have no injector, and no bank question depends on them.',
    { kind: 'heading', text: 'The signals each story leaves' },
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
    { kind: 'heading', text: 'Strength and noise' },
    "Strength (0.2 subtle, 0.5 moderate, 0.8 strong, 1.0 obvious) scales how many rows are planted: the larger of a fixed minimum and share × strength × the market's daily volume (backend/app/scenarios/planter.py). Five scenarios run at 0.8 and SCN-009, SCN-010 and SCN-011 at 0.5. The noise level (low or moderate) is a label in the catalogue, recorded in the manifest and the ledger; no injector reads it. The noise around a plant is the generated world itself, because planted rows sit among ordinary rows of the same shape. Data Model's Stories tab lists each plant's strength, noise level and row counts in the loaded world.",
    { kind: 'heading', text: 'What keeps a plant from showing' },
    'Rules that keep a plant from showing by its form: targets (markets, releases, providers, mechanics, segments, games) are drawn from the scenario seed among eligible candidates (D-016); a planted row takes the next id in its table and carries no scenario marker (D-014); injectors do not edit the daily KPIs, which are derived after planting (D-015); planted documents take the shapes of ordinary documents and do not name their sibling incidents; and failing sessions and complaints share one shape across scenarios.',
    { kind: 'heading', text: 'The truth ledger' },
    "The truth ledger records what was planted. backend/app/scenarios/ledger.py writes it once per generation (version 2): data/truth/ledger.json for world 2026 and data/truth/dev-seed<seed>.json for 2027 and 2028, under schemas/benchmark/truth-ledger.schema.json. For each scenario it holds the strength and noise level, the start date and duration, the affected markets, games and segments, the expected signals, the record ids that carry the truth, and the scenario's own answer fields with the planted ids per table. The bank grounds the eight planted questions (L15 to L22) from the ledger alone, so their expected answers and claims come from nothing else.",
    { kind: 'heading', text: 'The isolation rule' },
    'The isolation rule: retrieval code never imports, queries or reads the ledger (AGENTS.md), and only backend/app/evaluation/truth_ledger.py loads it. backend/tests/test_truth_ledger_isolation.py enforces this:',
    [
      'no module in retrieval, api, datasets, graph, ontology, scenarios, config, events, observability, persistence or models, nor lab.py, imports app.evaluation or names the ledger path;',
      'only the two API modules that publish evaluator output, benchmarks.py and scoring.py, import app.evaluation (D-035), and neither names the ledger;',
      'a test in a separate process checks that loading the lab and every retrieval module loads no evaluation module;',
      'the scenario package writes the ledger but does not import its loader;',
      "the manifest of a generated world names none of the ledger's fields.",
    ],
    { kind: 'heading', text: 'On the story cards' },
    "The hidden truths on the story cards come from GET /api/v1/benchmarks/questions, which reads the evaluator's output after the fact. At this level each card shows its scenario id and that hidden truth verbatim, after the plain story, and the worked example shows its question and answer key as the bank holds them; at Plain the answer key writes its market codes as countries.",
  ],
  terms: [
    'Answer key',
    'Concept',
    'Hidden truth',
    'Market',
    'Planted story',
    'Question bank',
    'Truth ledger',
    'World',
  ],
}
