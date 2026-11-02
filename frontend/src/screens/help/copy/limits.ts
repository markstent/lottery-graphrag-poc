/**
 * Chapter 9, assumptions and limits: a short framing and the register. Each
 * row says what was assumed or what limits the result, why, what it costs
 * if wrong, and the decision record or source behind it. Plain shows `item`
 * and `plain`; Technical adds the rest (register.tsx).
 */

import type { ChapterCopy } from '../chapters'

export interface RegisterRow {
  /** A stable id, used by the row's anchor (`#limit-<id>`) and by tests. */
  id: string
  /** The assumption or limit, in a few words. */
  item: string
  /** What it means, in one plain sentence. */
  plain: string
  /** Why it was made. */
  reason: string
  /** What it costs if it is wrong. */
  cost: string
  /** The decision record or the source that holds it. */
  decision?: string
}

export const REGISTER: readonly RegisterRow[] = [
  {
    id: 'synthetic-data',
    item: 'Made-up data',
    plain:
      "The company and its data are made up, so the results describe this data and not an actual operator's.",
    reason:
      'Questions need answers known in advance, stories can be planted only in generated data, and no private data may be used (AGENTS.md).',
    cost: "Data from a working operator is messier: inconsistent ids, missing links and free text. The graph's advantage or disadvantage there is not measured.",
    decision: 'AGENTS.md, "Synthetic Data"; chapter 2',
  },
  {
    id: 'one-company-shape',
    item: 'One company shape',
    plain:
      'Every world, or copy of the made-up company, is the same kind of company in the same four markets. Only the random draws differ.',
    reason:
      'The official worlds are the dev profile with one generator: seeds 2029 to 2034, so a difference between worlds is noise, not design.',
    cost: 'A result may not hold for a company with other markets, other languages, more systems or other links between them.',
    decision:
      'OFFICIAL_SEEDS in backend/app/evaluation/official.py; D-001, D-091',
  },
  {
    id: 'evidence-limits',
    item: 'The evidence budget',
    plain:
      'The answer model sees what fits in {context_budget_tokens} tokens, a token being about four characters. The budget is the same for all three approaches, with no limit on the number of pieces.',
    reason:
      'An equal budget means a difference comes from what each approach found, not from how much it could show; a model reads only so much at once.',
    cost: 'Too small a budget cuts facts an approach found; too large a one lets A show almost all it found, so its order stops mattering, and can bury the fact that matters. No other budget was tried.',
    decision: 'D-023, D-084',
  },
  {
    id: 'graph-order',
    item: "The graph's own order",
    plain:
      'In B and C, the graph puts its records in its own order, with records of a kind the question asks about first. They take turns with the passages. A gets no such help.',
    reason:
      'Each approach ranks with what it has: text relevance for passages, connection to the question for graph records. Taking turns one for one leaves no proportion to tune, and the kinds a question asks about are matched by fixed word lists, with no model.',
    cost: 'Common words such as "market" or "game" name broad kinds, so the first group may hold many records and add little; this cue is a declared difference that A does not have.',
    decision: 'D-083, D-084',
  },
  {
    id: 'record-texts',
    item: "Text search can read every fact the graph's records show",
    plain:
      "A searches a short text written for each record in the main business tables, so it can find every fact the graph's records can show.",
    reason:
      'The graph should add links and meaning, not facts A could not have retrieved, so A is given a record text for every row whose facts the graph can show (equal access).',
    cost: 'It narrows what the graph can add to finding the right rows. A company whose records cannot be searched as text would leave A weaker than here, which favours the graph; this design does not measure that.',
    decision: 'D-028',
  },
  {
    id: 'graph-depth',
    item: 'A fixed graph walk',
    plain:
      'The graph is followed at most {graph_limits.depth} links from where it starts, and other depths have not been tried.',
    reason:
      'Every run but the depth sweep uses depth {graph_limits.depth}, inside fixed node and edge caps, so the walk stays bounded and comparable.',
    cost: 'H1 asks how evidence changes with depth; the depth sweep that tests it had not been run by 2026-10-28.',
    decision: 'docs/evaluation.md, "Run kinds"',
  },
  {
    id: 'reasoning-off',
    item: 'Reasoning off',
    plain:
      'The answer model and the judge answer without first thinking in hidden text.',
    reason:
      'In the first local pilot (2026-10-19), with reasoning on, 159 of 198 answers and every judge call came back empty, because the models spent their output caps thinking.',
    cost: 'The run measures these models without the reasoning that might have used the evidence better.',
    decision: 'D-076',
  },
  {
    id: 'answer-model',
    item: 'One local answer model',
    plain:
      'Every answer comes from one language model run on one local machine. It is smaller than the largest models that providers run online.',
    reason:
      'The owner chose the local models at CP3 on 2026-10-26: they run with no network or account. The hosted option, a larger Qwen3 235B model on OpenRouter, was not run.',
    cost: 'A larger model might use the same evidence better and change the gap between approaches. H7, which compares two answer models, has no result yet.',
    decision: 'HITL_STATUS.md, CP3; docs/evaluation/official-run-proposal.md',
  },
  {
    id: 'repeats',
    item: 'One try per question',
    plain:
      'Each question is asked once, because asking again gave the same answer.',
    reason:
      'At temperature 0 the answer model gave the same answer, word for word, each time a question was asked again, so each extra try adds run time and nothing else.',
    cost: 'If a model or setting is not deterministic, one try hides how much its answers vary. The judge already varies a little between tries of the same answer. A run with REPEATS=N shows the variance.',
    decision: 'D-097; docs/evaluation.md, "Reproducibility"',
  },
  {
    id: 'judge-is-a-model',
    item: 'The judge is a model',
    plain:
      'The judge is itself a language model and can be wrong, so its marks sit beside the fixed-rule scores and do not replace them.',
    reason:
      'Fixed rules cannot mark completeness or faithfulness to the evidence; a judge from another model family can, as a second opinion.',
    cost: 'Judge errors or a bias toward some style of answer would skew its marks, though not the scores.',
    decision: 'D-031',
  },
  {
    id: 'judge-agreement',
    item: 'The judge and the rules disagree on "unknown"',
    plain:
      'In the official run, the judge and the answer score agreed on 88 percent of the answers that answered. They agreed on only 70 percent of those that said "unknown". Once chance is allowed for, that is weak agreement.',
    reason:
      'Measured in the official run of 2026-10-29 on three levels: answered, 88 percent of 637, weighted kappa 0.77; said "unknown", 70 percent of 263, weighted kappa 0.25 (A 0.38, B 0.21, C 0.17). Judge prompt 1.2.0 reads the whole answer and was not checked against hand labels; the hand-label check was made on a sample of answers, with labels from one model labeller and none from a person (D-094, D-096).',
    cost: 'Neither measure of a right answer can be read alone, least of all for answers that said "unknown": a check may be too strict, or the judge too lenient.',
    decision: 'D-086, D-094, D-096; docs/evaluation.md, "Status of results"',
  },
  {
    id: 'judge-blinding',
    item: 'The judge is not fully blind',
    plain:
      'The judge is not told which approach wrote an answer, but the form of some evidence can hint at it.',
    reason:
      "B and C show how a graph record was reached, a line A never shows; a graph node with no record reaches the judge as '<Label> <id>'; and C's concept records show their ontology text.",
    cost: 'The judge could favour or penalise an approach it recognises.',
    decision: 'D-031, D-085; docs/evaluation.md, "The judge"',
  },
  {
    id: 'bank-size',
    item: 'A small question bank',
    plain:
      'There are 22 questions. Each is asked of each world in up to three forms: 300 in all over the six worlds of the official run.',
    reason:
      'Each question is written by hand with its checks and claims, and is grounded in each world from the data or the truth ledger.',
    cost: 'A small difference between approaches cannot be detected with this many questions.',
    decision: 'Bank 2.0.0, backend/app/evaluation/bank.py; D-030',
  },
  {
    id: 'question-groups',
    item: 'Few question groups per comparison',
    plain:
      'In the official run each tested comparison rested on 24 groups of alike questions, and 48 for planted stories. So a difference had to be large to be detected. An average difference of 18.9 points in evidence recall, C against B on questions that need the ontology, did not pass.',
    reason:
      'Questions made from one question in one world share a template, so each group counts once (official run of 2026-10-29: 24 groups for H1, H2 and H3, 48 for H5).',
    cost: 'A modest effect of the graph or the ontology would read as "no detectable difference".',
    decision: 'D-032, D-091',
  },
  {
    id: 'interval-and-test',
    item: 'An interval and the test can disagree',
    plain:
      'In the official run five tested comparisons have an interval, or margin of error, that leaves out zero, but do not pass the test. Under the rule set before the run, they are not findings.',
    reason:
      'The interval looks at one comparison alone, through its mean; the test ranks group differences (Wilcoxon on group means) and allows for 14 comparisons made at once (Holm), so it asks for more. For one of the five, planted-story answers, the test fails even before that allowance (unadjusted p 0.14). The rule written before the run is the test (official run of 2026-10-29: H2 C against B on evidence and on answers, H1 B against A on answers, H5 B against A on evidence and on answers).',
    cost: 'Some of the five may be real differences this many questions cannot confirm, and the one finding may still be chance: the test keeps the chance of any false finding among the 14 at or below 5 percent, not at zero.',
    decision: 'D-032, D-087; docs/evaluation.md, "Statistics"',
  },
  {
    id: 'scorer-reads-text',
    item: 'The answer score reads words, not meaning',
    plain:
      'The answer score checks which names an answer contains. It accepts "United Kingdom" but not "UK", and it gives credit for naming the right thing even in an answer that says it does not know. In the official run this moved some scores up and some down, and most of text search\'s lead on planted-pattern answers comes from it (chapter 12).',
    reason:
      'Fixed checks keep the answer score deterministic and the same for A, B and C (D-030, scorer 2.2.1). A review of 2026-11-02 found that the L18 check for the unaffected market has "United Kingdom" as the only alias of MKT_UK, so B in three worlds and C in one answered correctly with "UK" and scored 0.5; and that token and set checks read the whole answer, so "unknown" answers that name expected items score (A on L19; B and C on L20 and L09). With "UK" accepted, a check made after the run, L18 moves from 0.75 to 1.00 for B and to 0.92 for C, and the planted-pattern answer gap of A over B from 8.0 to 4.9 points.',
    cost: "Answer scores on some questions are off in either direction, so a small answer difference between approaches can be the scorer's; the judge's marks sit beside them as a check.",
    decision: 'Not changed after the result; disclosed (2026-11-02)',
  },
  {
    id: 'bank-authors',
    item: 'Questions written by the builders',
    plain:
      'The people who built the system also wrote the questions and their answer keys, which may favour what they expected.',
    reason:
      'No outside question set exists for a made-up company. Every question maps to a planted story or a base fact of the world, and the planted answers come from the truth ledger alone.',
    cost: 'The choice of questions shapes the result, in either direction.',
    decision: 'docs/evaluation.md, "The question bank"',
  },
  {
    id: 'open-scoring-rules',
    item: 'Three questions with open scoring rules',
    plain:
      'The owner has not yet settled how three questions are scored. Two expect extra linked players. One gives half marks for also quoting an old price.',
    reason:
      'L16 and L17 expect every player linked to the shared devices or payment instruments, baseline players included; L22 scores 0.5 when an answer also quotes the stale price.',
    cost: 'Answer scores on those three questions could move if the owner rules otherwise.',
    decision: 'D-030; HITL_STATUS.md, CP1 open owner questions',
  },
]

export const limits: ChapterCopy = {
  plain: [
    'Every experiment rests on choices. Each row below is one assumption or one known limit, including those that cut against the graph. The Technical level adds why each was made, what it costs if it is wrong, and the decision record behind it.',
    { kind: 'component', name: 'register' },
  ],
  technical: [
    'The decision records (D-0xx) are in DECISIONS.md. A row that cites a run gives its date; the figures of the official run are in chapter 8.',
  ],
  terms: [
    'Answer key',
    'Answer model',
    'Graph walk',
    'Judge',
    'Language model',
    'Question bank',
    'Question group',
    'Reasoning',
    'Record text',
    'Repeat',
    'World',
  ],
}
