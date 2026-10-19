# Reranking

Reranking is optional but must be applied fairly.

If enabled for the baseline, equivalent candidate-ranking opportunity should be considered for graph evidence.

Record:

- candidate score
- rerank score
- selected/discarded outcome

## Implementation

`LexicalReranker` (`backend/app/retrieval/standard/reranking.py`) scores each candidate as `(1 - w) * (1 / rank_in) + w * overlap`.
`rank_in` is the candidate's incoming hybrid-retrieval rank and `overlap` is query-token coverage; `w` is `RAG_RERANK_LEXICAL_WEIGHT` (default 0.3).
It blends on rank rather than on the fused retrieval score, whose scale is not comparable with overlap.
