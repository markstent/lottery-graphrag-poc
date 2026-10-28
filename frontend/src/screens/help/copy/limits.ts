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
      'Every world is the same kind of company in the same four markets; only the random draws differ.',
    reason:
      'The official worlds are the dev profile with one generator: seeds 2029 to 2034 for method v0.3, and 2026, 2027 and 2028 in v0.2.0, so a difference between worlds is noise, not design.',
    cost: 'A result may not hold for a company with other markets, other languages, more systems or other links between them.',
    decision:
      'OFFICIAL_SEEDS in backend/app/evaluation/official.py; D-001, D-091',
  },
  {
    id: 'evidence-limits',
    item: 'The evidence budget',
    plain:
      'The answer model sees what fits in {context_budget_tokens} tokens, the same for all three approaches, with no limit on the number of pieces.',
    reason:
      'An equal budget means a difference comes from what each approach found, not from how much it could show; a model reads only so much at once. In v0.2.0 a limit of 12 pieces decided what the model saw, and the budget never did.',
    cost: 'Too small a budget cuts facts an approach found; too large a one lets A show almost all it found, so its order stops mattering, and can bury the fact that matters. No other budget was tried.',
    decision: 'D-023, D-084',
  },
  {
    id: 'graph-order',
    item: "The graph's own order",
    plain:
      "In B and C the graph's records are ordered by the graph, records of a kind the question asks about first, and they take turns with the passages; A gets no such help.",
    reason:
      'Each approach ranks with what it has: text relevance for passages, connection to the question for graph records. Taking turns one for one leaves no proportion to tune, and the kinds a question asks about are matched by fixed word lists, with no model.',
    cost: 'Common words such as "market" or "game" name broad kinds, so the first group may hold many records and add little; this cue is a declared difference that A does not have.',
    decision: 'D-083, D-084',
  },
  {
    id: 'method-after-result',
    item: 'The method was changed after a result',
    plain:
      'Method v0.3 was made after the v0.2.0 result was seen, in which the graph did not help; every v0.3 result says so.',
    reason:
      "In v0.2.0 the re-ordering model scored graph records low, and the limit on pieces kept about half of the graph's facts from the answer model (diagnostic of 2026-10-25: 23 of 55 for B, 51 of 88 for C). Every rule of v0.3 was written down before it was measured, development uses world 2026 only, and the official run uses six worlds no one has looked at.",
    cost: 'The guards limit what the change could have been fitted to but do not remove the doubt. v0.3 is published whatever it shows, and v0.2.0 stays as published.',
    decision: 'D-091, D-092, D-093; docs/evaluation/v0.3-method-proposal.md',
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
    cost: 'H1 asks how evidence changes with depth; the depth sweep that tests it had not been run by 2026-10-27.',
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
      'Every answer comes from one language model run on one local machine, smaller than the largest hosted models.',
    reason:
      'The owner chose the local models at CP3 on 2026-10-26: they run with no network or account, and the pilot kept the answer format in 324 of 324 answers. The hosted option, a larger Qwen3 235B model on OpenRouter, was not run.',
    cost: 'A larger model might use the same evidence better and change the gap between approaches. H7, which compares two answer models, has no result yet.',
    decision: 'HITL_STATUS.md, CP3; docs/evaluation/official-run-proposal.md',
  },
  {
    id: 'repeats',
    item: 'A few repeats',
    plain:
      'Each question is asked {repeats} times and the scores are averaged, because a model can answer differently each time.',
    reason:
      'Even at temperature 0 a model can vary between calls; {repeats} repeats average this out within a run time the owner accepted (about 9.5 hours estimated; the official run v0.2.0 took 15 hours 39 minutes, about three of them with the machine asleep).',
    cost: '{repeats} tries may not settle an answer that varies a lot, which adds noise to the answer score.',
    decision: 'docs/evaluation.md, "Reproducibility"',
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
    item: 'The judge and the rules often disagreed',
    plain:
      'In the official run v0.2.0, the judge and the answer score agreed on whether an answer was right for 53 percent of answers, little better than chance.',
    reason:
      "Measured in the official run of 2026-10-26 with the old yes-or-no rule: agreement 53 percent on 1,348 judged answers, Cohen's kappa 0.07 (A 0.16, B 0.00, C 0.06). The judge marked 290 abstentions correct and a correct date with a time scored 0; v0.3 fixes both and compares three levels, separately for answers and abstentions.",
    cost: 'Neither measure of a right answer can be read alone: a check may be too strict, or the judge too lenient.',
    decision: 'D-086; docs/evaluation.md, "Status of results"',
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
      'There are 22 questions, each asked of each world in up to three forms: 150 in all over the three worlds of v0.2.0.',
    reason:
      'Each question is written by hand with its checks and claims, and is grounded in each world from the data or the truth ledger.',
    cost: 'A small difference between approaches cannot be detected with this many questions.',
    decision: 'Bank 2.0.0, backend/app/evaluation/bank.py; D-030',
  },
  {
    id: 'question-groups',
    item: 'Few question groups per comparison',
    plain:
      'In v0.2.0 each tested comparison rested on 12 groups of alike questions (24 for planted stories), so only a large difference could be detected.',
    reason:
      'Questions made from one question in one world share a template, so each group counts once (official run of 2026-10-26: 12 groups for H1, H2 and H3, 24 for H5). The v0.3 official run uses six worlds to double the groups without writing new questions after seeing results.',
    cost: 'A modest effect of the graph or the ontology would read as "no detectable difference".',
    decision: 'D-032, D-091',
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
      'The owner has not yet settled how three questions are scored: two expect extra linked players, and one gives half marks for also quoting an old price.',
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
    'Re-ordering model',
    'Reasoning',
    'Record text',
    'Repeat',
    'World',
  ],
}
