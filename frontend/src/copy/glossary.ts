/**
 * The plain words screens use in place of the project's working terms.
 * Keys are the banned terms (see `banned-words.test.ts`); values are what
 * product copy says instead. Help's glossary shows `GLOSSARY_TERMS` below.
 */
export const GLOSSARY = {
  seed: 'starting point',
  chunk: 'passage',
  rerank: 're-ordering',
  reranked: 're-ordered',
  telemetry: 'activity record',
  MAPS_TO: 'is an instance of concept',
  prototype: 'early version',
} as const satisfies Record<string, string>

/** One glossary entry: the plain meaning always, and a technical one where it adds something. */
export interface GlossaryTerm {
  term: string
  /** Plain words, held to the banned-word list. */
  meaning: string
  /** Shown after the plain meaning at the Technical level only. */
  technical?: string
}

/**
 * What Help's glossary shows: every term used anywhere in Help, in
 * alphabetical order. Each chapter lists the terms it uses (`terms` in its
 * copy), and a test checks that each one is here.
 */
export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  {
    term: 'Answer key',
    meaning:
      'The correct answer to a question, written down before any approach is run.',
    technical:
      "The instance's expected answer, written at grounding time from the world's data, or for a planted question from the truth ledger alone. The answer checks are derived from it.",
  },
  {
    term: 'Answer model',
    meaning:
      'The language model that writes each answer from the chosen evidence. All three approaches use the same one.',
    technical:
      'The generation model: GENERATION_MODEL, recorded as generation_model with its family, temperature, output cap and reasoning mode. Every call goes through the model gateway (backend/app/models/gateway.py).',
  },
  {
    term: 'Answer score',
    meaning:
      'How far an answer matches its answer key, from 0 to 1: the share of its checks that it passes.',
    technical:
      "The mean of the instance's deterministic checks (verdict, token, set and number; backend/app/evaluation/checks.py). An instance's value is the mean over its successful repeats.",
  },
  {
    term: 'Approach',
    meaning:
      'One of the three ways of finding evidence that the experiment compares: A, text search; B, graph; C, graph and ontology.',
    technical:
      'Called a pipeline in the code and in the run record (A, B and C).',
  },
  {
    term: 'Citation',
    meaning:
      'A number in an answer, such as [2], that points to the piece of evidence a statement comes from.',
    technical:
      'Parsed as [n] or [n, m]; a range such as [1-3] cites nothing. Citation accuracy is the share of cited blocks whose item carries one of the claims; a citation of a block that was not shown is dropped and does not count.',
  },
  {
    term: 'Claim',
    meaning:
      'One fact that a correct answer states, together with the records or passages that state it.',
    technical:
      'A claim statement and its carriers: the record ids and passage ids whose text states the fact. Carriers are computed at grounding time and frozen with the bank (backend/app/evaluation/claims.py).',
  },
  {
    term: "Cohen's kappa",
    meaning:
      'How far two ways of marking agree beyond what chance alone would give: 0 is chance, 1 is full agreement.',
    technical:
      'The agreement measure of the old method: "judge correctness is 2" against "answer score is at least 0.5", overall and for each approach, as in the official run v0.2.0. Shown only from 10 judged answers (D-086).',
  },
  {
    term: 'Concept',
    meaning:
      'One shared meaning in the ontology, such as a game family that each market names differently.',
    technical:
      'A node of ontology version 2.0.0 (schemas/ontology/ontology.yaml): 42 concepts under six roots, with 117 bindings from market codes to concepts.',
  },
  {
    term: 'Depth sweep',
    meaning:
      'A kind of run that asks the questions needing several links again, with the graph followed 0, 1, 2 and 3 steps.',
    technical:
      'Run kind sweep (make run-sweep): B and C on the H1 questions at graph depths 0 to 3. It reports intervals and runs no test. None had been run by 2026-10-28.',
  },
  {
    term: 'Detectable difference',
    meaning:
      'A difference between two approaches that passes the test, larger than chance would explain after allowing for how many comparisons were made at once, and whose margin of error leaves out zero.',
    technical:
      'A Holm-adjusted p-value below 0.05 from a two-sided Wilcoxon signed-rank test on the per-group mean differences, with the 95 percent interval wholly above or below 0, in a cell of at least 10 pairs and 6 groups (backend/app/evaluation/statistics.py).',
  },
  {
    term: 'Development run',
    meaning:
      'A run on world 2026 while the method is being built. It asks the configured models the questions, and it is not a result.',
    technical:
      'Run kind dev (make dev-run, or "Development run" on Results): seed 2026 only, with the gateway answer model and judge; its one headline says it is not a result (D-091).',
  },
  {
    term: 'Enterprise ontology',
    meaning:
      'The shared vocabulary that ties each market’s local terms to one concept.',
    technical:
      'Only C uses it: for term resolution, query expansion, three more relationship types and concept expansion (chapter 4).',
  },
  {
    term: 'Evidence',
    meaning:
      'The records and passages that state the facts a correct answer needs.',
  },
  {
    term: 'Evidence recall',
    meaning:
      'The share of the needed facts found: how many of the facts a correct answer needs are covered by the evidence an approach chose, from 0 to 1. Method v0.3 tests it.',
    technical:
      'The share of claims with at least one carrier selected, after the starting record is removed; undefined when no claim is left. The evidence metric of the tested family since method v0.3 (D-087).',
  },
  {
    term: 'Evidence score',
    meaning:
      'How much of the needed evidence an approach found without padding, from 0 to 1. The official run v0.2.0 tested it; method v0.3 shows it without a test.',
    technical:
      'F1: the harmonic mean of recall (the share of claims with at least one carrier selected) and precision (the share of selected items that carry a claim), after the starting record is removed. Undefined when no claim is left. Descriptive since method v0.3, because precision depends on how many items fit the budget (D-087).',
  },
  {
    term: 'Failure cause',
    meaning:
      'For an answer that scores below half, or whose evidence covers less than half the needed facts, the one reason Results gives.',
    technical:
      'The failure class (backend/app/evaluation/scoring.py): entity_resolution_failure when B or C did not resolve the starting record, else retrieval_failure when evidence recall is below 0.5, else generation_failure.',
  },
  {
    term: 'Graph rank',
    meaning:
      "A graph record's place in the graph's own order in B and C: starting points first, then records of a kind the question asks about, then the rest.",
    technical:
      'The 1-based position among the in-scope nodes not of an excluded label, ordered by tier (seed, target type, other), then composite score, then node id (D-083). Live Lab shows it on each graph record.',
  },
  {
    term: 'Graph walk',
    meaning:
      'Following links in the knowledge graph from the starting points to related records, up to a set number of steps.',
    technical:
      'Traversal: breadth-first and undirected, to graph_limits.depth hops, under the node and edge caps (backend/app/retrieval/graph/traversal.py).',
  },
  {
    term: 'Groundedness',
    meaning:
      'How far the codes, dates and numbers an answer states are backed by the pieces it cites, and how many appear in no piece shown to the model. Shown, not tested.',
    technical:
      'Supported and unsupported shares of checkable atoms per sentence, with no model (backend/app/evaluation/checks.py, D-088); descriptive and outside the Holm family. A v0.2.0 figure and a v0.3 one are not comparable.',
  },
  {
    term: 'Hidden truth',
    meaning:
      'The fact planted behind a story. Help shows it on the story cards at the Technical level, and no approach can see it.',
  },
  {
    term: 'Hybrid search',
    meaning:
      'A search that combines matching by meaning with matching by exact words.',
    technical:
      'A dense top-k (bge-m3) and a sparse top-k (Qdrant/bm25) fused on the client by reciprocal rank fusion with k = {rrf_k} (D-022).',
  },
  {
    term: 'Hypothesis',
    meaning:
      'A statement the experiment tests, such as "the graph finds more of the evidence when a question needs several links".',
    technical:
      'H1 to H7, from the overhaul design (docs/superpowers/specs/2026-10-18-overhaul-design.md, section 5.5) and docs/evaluation.md.',
  },
  {
    term: 'Instance',
    meaning:
      'One filled-in version of a question, about one record in one world. One question gives up to three instances in each world.',
    technical:
      'A grounded bank instance: one logical question with one anchor in one world, frozen with the bank (backend/app/evaluation/bank.py, D-030).',
  },
  {
    term: 'Interval',
    meaning:
      'The margin of error of a difference between two approaches: the range the difference most likely lies in, with 95 percent confidence.',
    technical:
      'A 95 percent paired bootstrap interval of the mean difference over question groups, from 10,000 resamples with a fixed seed of 2026 (backend/app/evaluation/statistics.py).',
  },
  {
    term: 'Judge',
    meaning:
      'A second language model, from another model family, that marks each answer from 0 to 2 on five counts. Its marks are a second opinion.',
    technical:
      'JUDGE_MODEL, judge prompt 1.2.0 now (D-096); 1.0.0 at D-031 and in the official run v0.2.0. It sees block text only, shuffled and renumbered, and no word of its prompt names an approach (D-031).',
  },
  {
    term: 'Kind of question',
    meaning:
      'A group of questions that tests one idea, such as single facts, or links followed across several records.',
    technical:
      'A stratum: H1 multi-hop, H2 ontology-dependent (anchored by id, with H2_name, anchored by a local name, as a sub-group), H3 single facts and H5 planted patterns.',
  },
  {
    term: 'Knowledge graph',
    meaning:
      'A store of how things are linked, such as which platform version an incident happened on, with where each fact came from.',
    technical:
      'Neo4j, with 29 node labels and 30 relationship types (backend/app/graph/statements.py). It sits over the tables and does not replace them (D-004).',
  },
  {
    term: 'Language model',
    meaning: 'An AI model that reads text and writes text.',
  },
  {
    term: 'Market',
    meaning:
      'One country the made-up company operates in: the United Kingdom, Greece, Austria or the Czech Republic.',
  },
  {
    term: 'Method',
    meaning:
      'The rules a run follows to choose the evidence and score the answers. Every run is labelled with its method: v0.3 now, or v0.2, the old method.',
    technical:
      'Recorded as method_version in every run; a record without one is 0.2.0 (D-092). Method v0.3 is the selection rule of D-083 and D-084 with evidence recall as the tested metric (D-087).',
  },
  {
    term: 'Model family',
    meaning:
      'A line of language models built by one group. The judge comes from a different family than the answer model.',
    technical:
      'Recorded as generation_model_family and judge_model_family; an official run refuses to start when the two are equal.',
  },
  {
    term: 'Official run',
    meaning:
      'A run over the whole question bank whose scores count as a result: every question asked of several worlds, and scored the same way for every approach.',
    technical:
      'Run kind official over the whole bank, with one repeat unless --repeats N asks more (D-097), and a gateway answer model and judge (make run-benchmark): for method v0.3 on the six unseen world seeds 2029 to 2034 (D-091); v0.2.0 used seeds 2026, 2027 and 2028.',
  },
  {
    term: 'Pair',
    meaning:
      'One question answered by two approaches, so that their scores can be compared directly.',
    technical:
      'One instance where both approaches have a value for the metric; its difference is the first approach minus the second.',
  },
  {
    term: 'Passage',
    meaning:
      'A short piece of a document. It is the unit that text search finds.',
    technical:
      'A chunk in the code: at most 160 words, split on sentence boundaries, with the last sentence repeated at the start of the next.',
  },
  {
    term: 'Planted story',
    meaning:
      'A pattern added to the made-up data on purpose, so its true answer is known.',
    technical:
      'A scenario (SCN-001 and so on) in backend/app/scenarios/; eight are enabled.',
  },
  {
    term: 'Point',
    meaning:
      'One hundredth of the 0 to 1 scale: a difference of 0.05 is 5 points.',
  },
  {
    term: 'Question bank',
    meaning:
      'The fixed list of questions the approaches are tested on, each with its answer key.',
    technical:
      'Bank 2.0.0 (backend/app/evaluation/bank.py): 22 logical questions, grounded to 50 instances in each world and frozen with their hashes.',
  },
  {
    term: 'Question group',
    meaning:
      'The versions of one question in one world, up to three. They are alike, so the statistics count each group once.',
    technical:
      'A cluster, keyed question id and world seed. The cluster is the unit of the interval and of the test (D-032).',
  },
  {
    term: 'Quick check',
    meaning:
      'A run that tests the scoring code with fixed programs in place of the answer model and the judge. Its numbers are not results.',
    technical:
      'Run kind smoke (make run-smoke), with FakeAnswerGenerator and FakeJudge, which write template text.',
  },
  {
    term: 'Re-ordering model',
    meaning:
      'The model that scores each passage and record text for how well it answers the question, so the best come first. It does not score graph records.',
    technical:
      'The re-ranker: one cross-encoder, BAAI/bge-reranker-v2-m3, run in process by fastembed (D-021). One instance serves A, B and C, on the document channel only since method v0.3 (D-083).',
  },
  {
    term: 'Reasoning',
    meaning:
      'Hidden thinking that some models do before they answer. It was switched off for the answer model and the judge in the official run.',
    technical:
      'GENERATION_REASONING and JUDGE_REASONING (default or off); the official run set both to off (D-076).',
  },
  {
    term: 'Record',
    meaning:
      "One row in the company's tables, such as one game, one incident or one support case.",
  },
  {
    term: 'Record text',
    meaning:
      'A short text written for each record in the main business tables, such as a game or an incident, so that text search can find it.',
    technical:
      'A record block, written by one template per table (backend/app/retrieval/standard/records.py, serialiser 2.1.0) and indexed beside the passages (D-028).',
  },
  {
    term: 'Repeat',
    meaning:
      'One of the times a question is asked. An official run now asks each question once unless told to ask more; a run can ask more than once, to see whether a model’s answer varies.',
    technical:
      'An official run takes one repeat unless --repeats N asks more (D-097; v0.2.0 took 3); a failed repeat has no score and is left out of every metric.',
  },
  {
    term: 'Starting point',
    meaning:
      'Where the graph walk begins, picked from the question’s words. Not the starting record.',
    technical:
      'A seed in the code: a record the question resolves to, or when none resolves, the graph node of the best record-text hit (D-027).',
  },
  {
    term: 'Starting record',
    meaning:
      'The record the question names. The evidence score leaves it out, because the approach was given it. Not the graph’s starting point.',
    technical: 'The anchor in the code and in docs/evaluation.md.',
  },
  {
    term: 'Subset run',
    meaning:
      'An official run over part of the questions only. It is labelled as such and is not a result.',
    technical: 'An official run with --strata, --questions or --limit (D-063).',
  },
  {
    term: 'Temperature',
    meaning:
      'A setting for how much a model varies its wording from one try to the next; 0 is the least.',
  },
  {
    term: 'Test',
    meaning:
      'A statistical check of whether a difference between two approaches is larger than chance would explain.',
    technical:
      "A two-sided Wilcoxon signed-rank test with Pratt's treatment of zeros on the per-group mean differences, Holm-corrected over the 14 tests of the family (D-032).",
  },
  {
    term: 'Text search',
    meaning:
      'Approach A: finding the passages and record texts whose words and meaning best match the question.',
    technical:
      'Conventional retrieval-augmented generation (RAG) over the hybrid index.',
  },
  {
    term: 'Token',
    meaning:
      'A small piece of text, the unit models count. Here, four characters count as one token.',
    technical:
      'Estimated as characters divided by four, rounded up, over the whole block the prompt shows (heading, title line, path line and text; block_tokens). The evidence must fit context_budget_tokens.',
  },
  {
    term: 'Truth ledger',
    meaning:
      'The record of what was planted in the data and where. Only the scoring reads it.',
    technical:
      'Written by backend/app/scenarios/ledger.py and loaded only by backend/app/evaluation/truth_ledger.py; backend/tests/test_truth_ledger_isolation.py enforces this.',
  },
  {
    term: 'Weighted kappa',
    meaning:
      'How far the judge and the answer score agree beyond chance, on three levels, where being one level apart counts as half a disagreement. Shown only from 10 compared answers.',
    technical:
      'Linearly weighted kappa of judge correctness 0, 1 or 2 against the answer score read as 0, between 0 and 1, or 1, separately for answered and abstaining answers (D-086). Below n = 10 it reads "too few to say".',
  },
  {
    term: 'World',
    meaning:
      'One copy of the made-up company, built by the system. Every world has the same markets and kinds of records, but the details differ. The same settings build the same world again.',
    technical:
      'Fixed by its profile, world seed and scenario seed, recorded in its _manifest.json; the official worlds are seeds 2029 to 2034 for method v0.3, and were 2026, 2027 and 2028 for v0.2.0.',
  },
]
