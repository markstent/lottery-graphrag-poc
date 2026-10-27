/**
 * Chapter 5, how evidence is chosen. It describes the selection rule the
 * code runs now (D-081), and it is the only chapter that does, so a change
 * of rule rewrites this file and nothing else.
 */

import type { ChapterCopy } from '../chapters'

export const evidence: ChapterCopy = {
  plain: [
    'The answer model does not read everything the search finds. It is given at most {context.evidence_slots} pieces of evidence, and together they must fit a budget of {context_budget_tokens} tokens. A token is a small piece of text, counted here as four characters.',
    'One re-ordering model reads the question beside every piece found and gives each a score for how well it answers the question. The pieces are taken in score order while places and budget last. When two passages say nearly the same thing, only the first is taken.',
    'In A, every evidence place can go to a passage or a record text. In B and C, {context.graph_slots} of the {context.evidence_slots} places are kept for records the graph reached, and the rest go to passages and record texts. A graph place that no graph record fills goes to a passage or record text, but a passage place is not given to a graph record.',
    { kind: 'diagram', name: 'evidence' },
    'Why a limit at all: a model can read only so much at once, and more text is slower and can bury the fact that matters. The limit is the same for all three approaches, so a difference in their answers comes from what each found, not from how much each could show.',
    "What happened in practice: the graph reaches many of the facts a correct answer needs, but most of them do not get a place. A check on 2026-10-25 found that the re-ordering model scores the graph's records low, so most of them ranked too low to get a place. The graph was given its own places the same day. That helped a little, but within those places the model still often picked other graph records than the ones the answer needed. The official run of 2026-10-26 to 2026-10-27 is consistent with this: the choice of evidence, not the graph's reach, is the likely limit on B and C.",
  ],
  technical: [
    'The settings in this chapter, now and in the newest official run:',
    {
      kind: 'settings',
      keys: [
        'context.evidence_slots',
        'context.graph_slots',
        'context_budget_tokens',
        'context.dedupe_threshold',
        'selection_rule',
      ],
    },
    'The re-ranker is one cross-encoder, BAAI/bge-reranker-v2-m3, run in process by fastembed (D-021; RERANK_MODEL, default in backend/app/config/__init__.py; every run records it as reranker). A cross-encoder reads the question and one candidate together and returns a relevance score. One instance serves A, B and C. It scores every candidate against the question as asked, in one call per question; ties break on id, and it makes no cut of its own. A hands it its search hits; B and C hand it their search hits and every graph candidate together.',
    "What it reads: a graph node is judged on its row's record text, byte for byte the text A would judge for that row; a concept node in C on its ontology text; any other node on '<Label> <id>' (D-028). The facts from the source tables stay attached to the node for citations and the screens, and enter neither the judged text nor the prompt.",
    "The selection (backend/app/retrieval/standard/context.py, recorded as selection rule {selection_rule}, D-081). Before the walk, the first {context.graph_slots} graph nodes in the re-ranker's order whose own tokens fit the whole budget are each given a graph place. The walk then takes every candidate in that order, and the first check a candidate fails is its discard reason:",
    [
      'superseded_by_structured_fact: a record text whose graph node holds a graph place. The node is the authoritative copy, so one fact does not take two places.',
      'context_budget: its tokens do not fit what is left of the {context_budget_tokens}-token budget. Tokens are estimated as characters divided by four, rounded up, over the text only, not the title. A smaller candidate later in the list may still fit.',
      'slot_limit: no place is left for its kind. A graph node without a graph place is refused here, and a passage or record text is admitted only while the items selected, plus the graph places still waiting for their node, leave room within {context.evidence_slots}.',
      "duplicate: a passage whose set of words overlaps a selected passage's by a Jaccard index of {context.dedupe_threshold} or more. Record texts and graph nodes are distinct rows and are not compared.",
    ],
    'A Document node that a question resolved to may start the walk but is set aside before it as excluded_label (D-026).',
    'The share goes one way. A graph place that no node fills goes to the documents, but a document place that no document fills is not given to a node, so B and C can show fewer than {context.evidence_slots} items while nodes are refused. A node that holds a place but does not fit the remaining budget is refused as context_budget and releases its place to the documents after it. The walk makes one pass and does not revisit a decision, so a document refused as slot_limit earlier stays refused even if a place frees up later; this is a known limitation, and the budget rarely binds. A graph node refused by the share leaves its record text, if the search found it, to compete as a document, exactly as in A. A has no graph nodes, so its selection is the same as under the earlier rule.',
    "The selected items stay in the re-ranker's order whatever their kind, and that one list is what the prompt numbers (chapter 6). backend/tests/test_context_budget_v2.py tests the walk, and test_lab_fairness.py checks that the same selected evidence gives the same prompt in A, B and C.",
    'How the rule came about. Each figure below has its date and its source.',
    [
      'Until 2026-10-25 the rule was D-025: one cut at 12 places across both kinds of candidate, recorded as shared-reranker-12-slots. The pilot runs of 2026-10-19 and the four recorded Live Lab runs used it.',
      "The selection diagnostic of 2026-10-25 (make diagnose-selection, D-080; output data/evaluation/diagnostics/20261025T180223Z-selection/, not in git; summarised in docs/evaluation/official-run-proposal.md) ran retrieval with no answer model over the 38 seed 2026 bank instances that have claims, 122 claims in all. A claim is one fact a correct answer states (chapter 7). The graph's candidates held 55 claims for B and 88 for C; the search hits held 72 for A and B and 69 for C; the prompt received 43 for A, 38 for B and 39 for C. Every claim the graph found that the prompt left out was cut as slot_limit, 26 for B and 53 for C, at re-ranker ranks 13 to 63 for B and 13 to 94 for C. The token budget was not the limit: prompts in the pilot used about 1,130 of 2,000 tokens.",
      'D-081 (2026-10-25, approved with CP3 on 2026-10-26) gave the graph its share. The share was fixed at half before the new rule was measured, and no other value has been tried. The diagnostic reads the answer key, so it may not be used to choose a value.',
      "The diagnostic ran once after the change, on 2026-10-25 (data/evaluation/diagnostics/20261025T200934Z-selection/): 43 claims reached the prompt for A, 41 for B and 43 for C, and 23 (B) and 51 (C) of the graph's claims were still left out, because within the graph's places the re-ranker ranked other graph records higher.",
      'The dry run of 2026-10-26 (four questions; data/evaluation/runs/dry-run-2026-10-26/, summarised in docs/evaluation/official-run-proposal.md) showed the same on one question: on the multi-hop question L05, the graph places of B and C went to the incident the question names and to support cases, and the record that carries the needed claim did not reach the prompt.',
      'The official run v0.2.0 (2026-10-26 to 2026-10-27; docs/evaluation.md) found no detectable difference between the approaches (chapter 1). Read with the diagnostic, the result points at selection: the graph reaches many of the facts, and the re-ranker and the 12 places keep most of them from the answer model.',
    ],
  ],
  terms: [
    'Answer model',
    'Claim',
    'Evidence place',
    'Passage',
    'Re-ordering model',
    'Record text',
    'Token',
  ],
}
