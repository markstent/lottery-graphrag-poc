# Reranking

Reranking is optional but must be applied fairly.

If enabled for the baseline, equivalent candidate-ranking opportunity should be considered for graph evidence.

Record:

- candidate score
- rerank score
- selected/discarded outcome

## Implementation

Code: `backend/app/retrieval/standard/reranking.py`.
One reranker instance, built once by the lab, is the one judge of context selection for A, B and C.
It always scores against the raw question; pipeline C's query expansion affects retrieval, never judging.

- Pipeline A hands it its hybrid top-`RAG_TOP_K` hits.
- Pipelines B and C hand it, in one call, the same document channel plus the structured channel: the top `RERANK_CANDIDATES` graph nodes by composite score.
  `RERANK_CANDIDATES` is a per-channel cap like `RAG_TOP_K`; both default to 40.
- It scores every candidate it is given; there is no internal cut.

`CrossEncoderReranker` (`RERANK_PROVIDER=cross_encoder`, model `RERANK_MODEL`, default `BAAI/bge-reranker-v2-m3`) scores each (question, candidate text) pair; ties break on `chunk_id`.
`LexicalReranker` (`RERANK_PROVIDER=lexical`, the deterministic CI judge) scores each candidate as `(1 - w) * (1 / rank_in) + w * overlap`.
`rank_in` is the candidate's incoming rank within its channel and `overlap` is query-token coverage; `w` is `RERANK_LEXICAL_WEIGHT` (default 0.3).
It blends on rank rather than on the fused retrieval score, whose scale is not comparable with overlap.

Every judged candidate is recorded with its retrieval score, rerank score, final rank and outcome (`rag.candidate.reranked` in A, `graph.candidate.reranked` in B and C).
