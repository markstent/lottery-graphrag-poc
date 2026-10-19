# Context Budgeting

## What changed in v2

In v1 pipelines B and C chose up to 12 graph nodes by graph score, always kept their seeds, and showed them to the model on top of the documents' token budget.
In v2 every pipeline answers from one total token budget and one evidence-slot cap (D-023), and one judge decides what fills them (D-025).
Record blocks of facts the graph already supplies are superseded before judging, so one fact never takes two slots.

## Requirement

A, B and C use equivalent context budgets.
Selection prefers authoritative current evidence, avoids duplicated context and records the final token count.

## How selection works

Code: `backend/app/retrieval/standard/context.py`.

Every pipeline answers from one token budget (`RAG_CONTEXT_TOKEN_BUDGET`, default 2000) and one evidence-slot count (`RAG_EVIDENCE_SLOTS`, default 12).
The shared reranker scores every candidate a pipeline has against the raw question (`docs/retrieval/reranking.md`), and one selection walks the reranked list.

- Pipeline A's candidates are its hybrid top-`RAG_TOP_K` hits: document chunks and record blocks.
- Pipelines B and C have the same document channel plus a structured channel: every traversal node, bounded only by the traversal caps, in graph composite score order (`docs/retrieval/evidence-ranking.md`).
  Nodes with an excluded label (default `Document`) are never structured candidates and are discarded with `excluded_label`.
- Before judging, a record block whose record id is a structured candidate's node id is discarded as `superseded_by_structured_fact` (design 10a.8).
  The node is judged on that record's exact text, so with a text-only pointwise judge (the production cross-encoder and the CI overlap judge) a node that loses means the record would have lost too.
- `select_context` walks the reranked list.
  For each candidate the first failing check is its discard reason: the budget (`context_budget`; a smaller later candidate may still fit), then the slots (`slot_limit`), then near-duplicates (`duplicate`).
  The near-duplicate check (Jaccard >= `RAG_DEDUPE_THRESHOLD`, default 0.85) applies to document chunks only: records and nodes have unique ids, and two distinct rows with similar columns are different facts.
- `assemble_context` returns the selection in judge order (`selected`), the one list every pipeline hands the generator, and the same selection split into nodes (`structured_selected`) and chunks and records (`document_selected`) for telemetry only.
  The prompt numbers `selected` in order, so cited block n is `citations[n - 1]` in every pipeline.

No channel has reserved slots: a high-scoring document chunk takes a slot ahead of a lower-scoring node, and the other way round.

## What the model sees

Every pipeline hands the generator one list, its selection in judge order, so the same selected evidence gives the same prompt string in A, B and C (`backend/tests/test_lab_fairness.py`).
A structured block is formatted exactly like a document block (`generation.context_block`): a title line, then the same text the judge scored.
A node whose row has a record block takes that block's title, market and language from the source lookup, whether or not the search returned the block, so the same fact is the same block in A, B and C.
A node without a record block is shown as `<Label>: <id>` with the text `<Label> <id>`: no warehouse value reaches the prompt unless A could index it (D-028).
The prompt carries no B- or C-only extra; the evidence path and authoritative facts stay in `GraphEvidence`, the citations and the telemetry for the UI.
The budget counts block text only, not title lines, for every pipeline alike.

The final token count is recorded on `rag.context.assembled` and `graph.context.assembled`.
