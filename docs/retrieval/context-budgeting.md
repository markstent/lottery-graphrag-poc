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
- Pipelines B and C have the same document channel plus a structured channel: every traversal node, bounded only by the traversal caps (`max_total_nodes`), in graph composite score order (`docs/retrieval/evidence-ranking.md`).
  The judge sees every candidate a pipeline produced within its hard caps.
  Nodes with an excluded label (`GraphRagSettings.excluded_labels`, default `Document`) are never structured candidates: a directly resolved document may seed traversal, but it is discarded with `excluded_label`, and its chunks reach the model through the document channel like A's.
- Before judging, a record block whose record id is a structured candidate's node id is discarded as `superseded_by_structured_fact` (design 10a.8).
  The node is judged on that record's exact text, so with a text-only pointwise judge (the production cross-encoder) a node that loses means the record would have lost too.
  That safety does not hold for the CI lexical blend, which also uses the incoming rank.
- `reranker.rerank(question, structured + documents)` runs once per question and scores every candidate it is given.
- `select_context` then walks the reranked list.
  For each candidate the first failing check is its discard reason: the budget (`context_budget`; a smaller later candidate may still fit), then the slots (`slot_limit`), then near-duplicates (`duplicate`).
  The near-duplicate check (Jaccard >= `RAG_DEDUPE_THRESHOLD`, default 0.85) applies to document chunks only: records and nodes have unique ids, and two distinct rows with similar columns are different facts.
- `assemble_context` returns the selected nodes (`structured_selected`) and the selected chunks and records (`document_selected`), each in selection order.
  The prompt numbers documents first and structured blocks second, so citations stay aligned.

A high-scoring document chunk therefore takes a slot ahead of a lower-scoring node, and the other way round: priority follows the judge, whatever the kind.

The judge sees the same text for the same record in every pipeline: a node with a record block is judged on that block, byte for byte.
In the prompt a structured block is formatted exactly like a document block (`generation.context_block`): the title line, then the same text the judge scored.
The prompt therefore carries no B- or C-only extra; the evidence path stays in `GraphEvidence.path`, the citations and the telemetry for the UI.
The budget counts the block text; the title lines are not counted, for every pipeline alike.

The final token count is recorded on `rag.context.assembled` and `graph.context.assembled`.
