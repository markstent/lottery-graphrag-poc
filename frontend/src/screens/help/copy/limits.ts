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
      'All three worlds are the same kind of company in the same four markets; only the random draws differ.',
    reason:
      'The official worlds are the dev profile with world seeds 2026, 2027 and 2028, from generator 0.2.0, so a difference between worlds is noise, not design.',
    cost: 'A result may not hold for a company with other markets, other languages, more systems or other links between them.',
    decision: 'OFFICIAL_SEEDS in backend/app/evaluation/official.py; D-001',
  },
  {
    id: 'evidence-limits',
    item: 'The evidence limits',
    plain:
      'The answer model sees at most {context.evidence_slots} pieces of evidence within {context_budget_tokens} tokens, the same for all three approaches.',
    reason:
      'Equal limits mean a difference comes from what each approach found, not from how much it could show; a model reads only so much at once.',
    cost: "Too tight a limit cuts facts an approach found: on 2026-10-25 the selection diagnostic found that the cut on places, not the token budget, kept 26 (B) and 53 (C) of the graph's claims out of the prompt. Too loose a limit can bury the fact that matters.",
    decision: 'D-023, D-081',
  },
  {
    id: 'graph-share',
    item: "The graph's share",
    plain:
      'In B and C, {context.graph_slots} of the {context.evidence_slots} places are kept for graph records. The share was fixed before it was measured, and no other share was tried.',
    reason:
      'The diagnostic of 2026-10-25 showed one shared cut dropped about half of the claims the graph found (26 of 55 for B, 53 of 88 for C). Half was chosen in advance so that it could not be tuned to the question bank.',
    cost: 'Another share might help or hurt B and C, and no run has measured one.',
    decision: 'D-081',
  },
  {
    id: 'reranker-graph-records',
    item: 'The re-ordering model scores graph records low',
    plain:
      'The model that ranks the evidence tends to score graph records low, so many of the facts the graph finds, about half when last measured, do not reach the answer model.',
    reason:
      "One re-ranker orders every candidate for A, B and C, so all three are chosen by the same rule (D-025, D-081). The diagnostic run once after D-081 (2026-10-25) still left 23 of 55 (B) and 51 of 88 (C) of the graph's claims out of the prompt, because within the graph places it ranked other graph records higher.",
    cost: "The experiment measures the re-ranker's view of record text as much as the graph's reach. A better selection could change the result either way.",
    decision: 'D-080, D-081; docs/evaluation/official-run-proposal.md',
  },
  {
    id: 'record-texts',
    item: 'Text search can read every record',
    plain:
      'A searches a short text written for each record in the main business tables, so it can find every fact the graph can show.',
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
      'Even at temperature 0 a model can vary between calls; {repeats} repeats average this out within a run time the owner accepted (about 9.5 hours estimated; the official run took 15 hours 39 minutes, about three of them with the machine asleep).',
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
    item: 'The judge and the rules often disagree',
    plain:
      'In the official run, the judge and the answer score agreed on whether an answer was right for 53 percent of answers, little better than chance.',
    reason:
      "Measured in the official run of 2026-10-26: agreement 53 percent on 1,348 judged answers, Cohen's kappa 0.07 (A 0.16, B 0.00, C 0.06).",
    cost: 'Neither measure of a right answer can be read alone: a check may be too strict, or the judge too lenient.',
    decision: 'docs/evaluation.md, "Status of results"',
  },
  {
    id: 'judge-blinding',
    item: 'The judge is not fully blind',
    plain:
      'The judge is not told which approach wrote an answer, but the form of some evidence can hint at it.',
    reason:
      "A graph node with no record text reaches the judge as '<Label> <id>', which can differ in form from the record text A shows for the same row.",
    cost: 'The judge could favour or penalise an approach it recognises.',
    decision: 'D-031; docs/evaluation.md, "The judge"',
  },
  {
    id: 'bank-size',
    item: 'A small question bank',
    plain:
      'There are 22 questions, each asked of three worlds in up to three forms: 150 in all.',
    reason:
      'Each question is written by hand with its checks and claims, and is grounded in each world from the data or the truth ledger.',
    cost: 'A small difference between approaches cannot be detected with this many questions.',
    decision: 'Bank 2.0.0, backend/app/evaluation/bank.py; D-030',
  },
  {
    id: 'question-groups',
    item: 'Few question groups per comparison',
    plain:
      'Each tested comparison rests on 12 groups of alike questions (24 for planted stories), so only a large difference can be detected.',
    reason:
      'Questions made from one question in one world share a template, so each group counts once (official run of 2026-10-26: 12 groups for H1, H2 and H3, 24 for H5).',
    cost: 'A modest effect of the graph or the ontology would read as "no detectable difference".',
    decision: 'D-032',
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
