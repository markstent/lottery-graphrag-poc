# Context Budgeting

A/B/C should use equivalent model context budgets where practical.

The system should prioritise:

1. authoritative current evidence
2. required evidence diversity
3. non-duplicative context
4. graph paths that explain why evidence is relevant

Record final token counts.

## Implementation

Code: `backend/app/retrieval/standard/context.py`.

Every pipeline answers from one token budget (`RAG_CONTEXT_TOKEN_BUDGET`, default 2000) and one evidence-slot count (`RAG_EVIDENCE_SLOTS`, default 12).
One judge decides what fills them: the shared reranker scores every candidate a pipeline has against the raw question, and one selection walks the reranked list.

- Pipeline A's candidates are its hybrid top-`RAG_TOP_K` hits: document chunks and record blocks.
- Pipelines B and C have the same document channel plus a structured channel: the top `RERANK_CANDIDATES` traversal nodes by graph composite score (`docs/retrieval/evidence-ranking.md`).
  Nodes beyond that cut never reach the judge and are discarded with `candidate_cap`.
- Before judging, a record block whose record id is a structured candidate's node id is discarded as `superseded_by_structured_fact` (design 10a.8).
  This is safe because the node is judged on that record's exact text: if the node loses on score, the record would have lost too.
- `reranker.rerank(question, structured + documents)` runs once per question and scores every candidate it is given.
- `select_context` then walks the reranked list.
  For each candidate the first failing check is its discard reason: the budget (`context_budget`; a smaller later candidate may still fit), then the slots (`slot_limit`), then near-duplicates (`duplicate`).
  The near-duplicate check (Jaccard >= `RAG_DEDUPE_THRESHOLD`, default 0.85) applies to document chunks only: records and nodes have unique ids, and two distinct rows with similar columns are different facts.
- `assemble_context` returns the selected nodes (`structured_selected`) and the selected chunks and records (`document_selected`), each in selection order.
  The prompt numbers documents first and structured blocks second, so citations stay aligned.

A high-scoring document chunk therefore takes a slot ahead of a lower-scoring node, and the other way round: priority follows the judge, whatever the kind.

The judge sees the same text for the same record in every pipeline: a node with a record block is judged on that block, byte for byte.
In the prompt the graph pipeline adds one line under each selected node, for example `Graph path: GAME_UK_01 -AFFECTS-> INC_025, 1 hop.`.
The path line is provenance shown to the model, not to the judge.
The budget counts the judged text; the path line and the block titles (for every pipeline) are not counted.

The final token count is recorded on `rag.context.assembled` and `graph.context.assembled`.
