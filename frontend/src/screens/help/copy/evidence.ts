/**
 * Chapter 5, how evidence is chosen. It describes the selection rule the
 * code runs now, method v0.3 (D-083, D-084), and it is the only chapter that
 * does, so a change of rule rewrites this file and nothing else. The rule of
 * the old method, which the official run v0.2.0 used, is history here, with
 * its dates.
 */

import type { ChapterCopy } from '../chapters'

export const evidence: ChapterCopy = {
  plain: [
    'The answer model does not read everything the searches find. What it is given must fit a budget of {context_budget_tokens} tokens, the same for all three approaches. A token is a small piece of text, counted here as four characters. There is no other limit on the number of pieces.',
    'The passages and record texts are put in order by the re-ordering model, which reads the question beside each one and scores how well it answers it. A takes them in that order until the budget is full. When two passages say nearly the same thing, only the first is taken.',
    "In B and C there is a second list: the records the graph reached, in the graph's own order. The starting points come first, then the records of a kind the question asks about, such as incidents when it asks about incidents, then the rest. Within each group, a record that is closer to the starting point, linked more strongly and more like the question comes first. Each record's place in this order is its graph rank. The re-ordering model does not score graph records.",
    'The two lists take turns: one passage or record text, then one graph record, then a passage again, until the budget is full. A record already in the evidence is not taken again, and when one list runs out the other carries on alone.',
    { kind: 'diagram', name: 'evidence' },
    'Why one budget: a model can read only so much at once, and more text is slower and can bury the fact that matters. The budget is the same for all three approaches, so a difference in their answers comes from what each found, not from how much each could show. Taking turns, one for one, gives the graph room with no proportion that had to be tuned.',
    'This is method v0.3, in use since 2026-10-27. The official run v0.2.0 used the old method: the answer model saw at most 12 pieces, and one re-ordering model put the passages and the graph records in one list. A check on 2026-10-25 found that it scored graph records low, so about half of the facts the graph found did not reach the answer model. The method was changed after that result was seen (chapter 9).',
  ],
  technical: [
    'The settings in this chapter, now and in the newest official run:',
    {
      kind: 'settings',
      keys: [
        'context_budget_tokens',
        'context.dedupe_threshold',
        'top_k',
        'ranking_weights',
        'graph_limits.total_nodes',
        'selection_rule',
        'method_version',
        'prompt_extras.target_type_tier',
        'prompt_extras.ontology_target_terms',
      ],
    },
    'The document channel. The re-ranker is one cross-encoder, BAAI/bge-reranker-v2-m3, run in process by fastembed (D-021; RERANK_MODEL, default in backend/app/config/__init__.py; every run records it as reranker). It reads the question as asked beside each candidate and returns a relevance score; ties break on id. It orders the top {top_k} hits of the hybrid search (chapter 4), in A exactly as in B and C. It never sees a graph node (D-083).',
    "The graph channel (rank_and_scope and select_and_attach in backend/app/retrieval/graph/stages.py; graph_relevance_order in ranking.py, D-083). Every node the walk reached, less excluded labels ({excluded_labels}) and nodes outside the market scope, is ordered in three tiers: seeds (every node at hops 0, the D-027 fallback seed included), then nodes that hold a target type, then all other nodes. Within a tier the order is the composite score of chapter 4, weights {ranking_weights}, then node id. A node's graph rank is its 1-based position in that order; an excluded or out-of-scope node has no tier and no rank.",
    [
      'target types are the graph labels the question names, matched with no model: the schema\'s own vocabulary (each label split into words, such as "platform version", its last word alone when no other label ends in it, and the table names), 50 phrases in all; in C also every ontology concept label and synonym in any language, which names the labels of the concept\'s bindings and their descendants (411 phrases in the ontology of 2026-10-27);',
      'matching is on whole words, casefolded, with an optional plural, leftmost-longest and non-overlapping, so "game mechanic" names GameMechanic and not Game; the schema and ontology phrases match in two passes, so C\'s target types always contain B\'s;',
      'a node holds a target type when its own label is one, or when a stated link from it, in its stored direction and declared in the schema, joins it to a node of a target label; the stated links among the reached nodes are read in one bounded query (at most {graph_limits.total_nodes} ids and 5,000 rows; a larger result fails the run and is not cut), only when the question names a target type;',
      'the target cue is for B and C only and is a declared difference: A gets no such boost, because a boost would change the tuned baseline. Declared risk: common words such as "market", "game" or "incident" name broad types, so the target tier may hold many nodes and add little.',
    ],
    "The selection (interleave_by_budget in backend/app/retrieval/standard/context.py, recorded as selection rule {selection_rule}, D-084). A takes its cross-encoder order until the {context_budget_tokens}-token budget is full. B and C take one item from each list in turn, starting with the document channel. B searches documents exactly as A does, so B's first block is A's first block; C searches with the question plus its ontology terms, so its first block is the first of its own hits, which may differ. Each offered item is checked in this order, and the first check it fails is its discard reason:",
    [
      'same_record: a record block or node whose row is already selected, so a row is taken once, at its first appearance;',
      'context_budget: its tokens do not fit what is left of the budget; a later, smaller item may still fit;',
      "duplicate: a document passage whose set of words overlaps a selected passage's by a Jaccard index of {context.dedupe_threshold} or more.",
    ],
    'A refused item keeps the turn with its list, an admitted one passes it, and when one list is used up the other continues alone. The walk is one pass and loses nothing by it, because every refusal is final: the budget only shrinks and a selected row stays selected. Every approach is charged the tokens of the block the prompt shows for an item (chapter 6), four characters to a token, so the "reached from" line of a graph record is paid for from the same budget. Nodes of an excluded label and, in a Live Lab run limited to some markets, nodes outside them are set aside before the order as excluded_label and out_of_scope_market. RAG_EVIDENCE_SLOTS and RAG_GRAPH_SLOTS are removed: a value left in the environment is refused at start-up with a message naming D-084.',
    "The selected items stay in prompt order, the order they were taken, and that one list is what the prompt numbers (chapter 6). Live Lab shows each graph record's tier and graph rank and why each item was set aside. backend/tests/test_context_selection.py tests the walk; backend/tests/test_lab_fairness.py pins that A's selection is its cross-encoder order cut at the budget and that A, B and C share every other part.",
    'How the rule came about. Each figure below has its date and its source.',
    [
      'Until 2026-10-25 the rule was D-025: one cross-encoder ordered every candidate, graph nodes included, and one cut at 12 places, recorded as shared-reranker-12-slots. The pilot runs of 2026-10-19 and the four recorded Live Lab runs used it.',
      "The selection diagnostic of 2026-10-25 (make diagnose-selection, D-080; summarised in docs/evaluation/official-run-proposal.md) ran retrieval with no answer model over the 38 seed 2026 bank instances that have claims, 122 claims in all. The graph's candidates held 55 claims for B and 88 for C; the prompt received 43 for A, 38 for B and 39 for C. Every claim the graph found that the prompt left out was cut by the 12 places, 26 for B and 53 for C.",
      "D-081 (2026-10-25) kept 6 of the 12 places for graph nodes, still in the cross-encoder's order, recorded as reranker-graph-share; run once after the change, the diagnostic still left 23 (B) and 51 (C) of the graph's claims out.",
      'The official run v0.2.0 (2026-10-26 to 2026-10-27) used D-081 and found no detectable difference between the approaches (chapter 1). In it the 12 places bound in all 1,350 prompts and the 2,000-token budget never did: the largest prompt held 1,489 tokens (D-084).',
      'Method v0.3 (D-083, D-084, approved on 2026-10-27 with docs/evaluation/v0.3-method-proposal.md) was made after seeing that result. Each rule was written down before it was measured, and development uses seed 2026 only (D-093).',
    ],
  ],
  terms: [
    'Answer model',
    'Graph rank',
    'Passage',
    'Re-ordering model',
    'Record text',
    'Starting point',
    'Token',
  ],
}
