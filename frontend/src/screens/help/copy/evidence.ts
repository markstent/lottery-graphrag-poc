/**
 * Chapter 5, how evidence is chosen. It describes the selection rule the
 * code runs now (D-083, D-084), and it is the only chapter that does, so a
 * change of rule rewrites this file and nothing else.
 */

import type { ChapterCopy } from '../chapters'

export const evidence: ChapterCopy = {
  plain: [
    'The answer model does not read everything the searches find. What it is given must fit a budget of {context_budget_tokens} tokens, the same for all three approaches. A token is a small piece of text; here four characters count as one token. There is no other limit on the number of pieces.',
    'A re-ordering model puts the passages and record texts in order. It reads the question beside each one and scores how well that one answers it. A takes them in that order until the budget is full. When two passages say nearly the same thing, only the first is taken.',
    "B and C also have a second list: the records the graph reached, in the graph's own order. The starting points come first. Next come the records of a kind the question asks about, such as incidents when it asks about incidents. Then come the rest. Within each group, a record comes earlier when it is closer to the starting point, more strongly linked and more like the question. A record's place in this order is its graph rank. The re-ordering model does not score graph records.",
    'The two lists take turns: one passage or record text, then one graph record, then a passage again, until the budget is full. A record already in the evidence is not taken again. When one list runs out, the other carries on alone.',
    { kind: 'diagram', name: 'evidence' },
    { kind: 'heading', text: 'Why one budget' },
    'A model can read only so much at once, and more text is slower and can bury the fact that matters. The budget is the same for all three approaches. So a difference in their answers comes from what each found, not from how much each could show. Taking turns one for one gives the graph room, with no split between the two lists that anyone had to tune.',
    'A method is the set of rules for choosing the evidence and scoring the answers. The official run used the rules of this chapter (chapter 1).',
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
    { kind: 'heading', text: 'The document channel' },
    'The re-ranker is one cross-encoder, BAAI/bge-reranker-v2-m3, run in process by fastembed (D-021; RERANK_MODEL, default in backend/app/config/__init__.py; every run records it as reranker). It reads the question as asked beside each candidate and returns a relevance score; ties break on id. It orders the top {top_k} hits of the hybrid search (chapter 4), in A exactly as in B and C. It never sees a graph node (D-083).',
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
    'A refused item keeps the turn with its list, an admitted one passes it, and when one list is used up the other continues alone. The walk is one pass and loses nothing by it, because every refusal is final: the budget only shrinks and a selected row stays selected. Every approach is charged the tokens of the block the prompt shows for an item (chapter 6), four characters to a token, so the "reached from" line of a graph record is paid for from the same budget. Nodes of an excluded label and, in a Live Lab run limited to some markets, nodes outside them are set aside before the order as excluded_label and out_of_scope_market.',
    "The selected items stay in prompt order, the order they were taken, and that one list is what the prompt numbers (chapter 6). Live Lab shows each graph record's tier and graph rank and why each item was set aside. backend/tests/test_context_selection.py tests the walk; backend/tests/test_lab_fairness.py pins that A's selection is its cross-encoder order cut at the budget and that A, B and C share every other part.",
    'The official run (started 2026-10-29) used this rule, recorded as graph-rank-interleave-budget. Its prompts held on average 1,972 (A), 1,985 (B) and 1,986 (C) context tokens of the 2,000, and on multi-hop questions B got 22.1 evidence-recall points more to the answer model than A, its one detectable difference (chapter 8).',
  ],
  terms: [
    'Answer model',
    'Graph rank',
    'Method',
    'Passage',
    'Re-ordering model',
    'Record text',
    'Starting point',
    'Token',
  ],
}
