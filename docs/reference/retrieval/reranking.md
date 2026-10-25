# Reranking

## What changed in v2

In v1 a lexical blend of similarity and word overlap reordered the document chunks, and the graph pipelines picked their nodes by graph score.
In v2 one cross-encoder (`BAAI/bge-reranker-v2-m3`, run by fastembed, D-021) is the one judge of context selection for A, B and C (D-025).
It scores every candidate a pipeline has, documents and graph nodes in one call, always against the raw question.
A lexical overlap judge remains only as the deterministic CI judge.

## Requirement

Reranking is applied fairly: every pipeline's candidates get the same judge, and every judged candidate is recorded with its retrieval score, rerank score and outcome.

## How it works

Code: `backend/app/retrieval/standard/reranking.py`.
One reranker instance, built once by the lab, is shared by A, B and C.
Pipeline C's query expansion affects retrieval, never judging.

- Pipeline A hands it its hybrid top-`RAG_TOP_K` hits.
- Pipelines B and C hand it, in one call, the same document channel plus every traversal node, bounded by `max_total_nodes` (default 200).
- It scores every candidate it is given; there is no internal cut.
- The trace CLI reports each pipeline's judge time (from `*.rerank.started` to the first `*.candidate.reranked` event) next to the run's wall clock.

`CrossEncoderReranker` (`RERANK_PROVIDER=cross_encoder`, model `RERANK_MODEL`) scores each (question, candidate text) pair; ties break on `chunk_id`.
`build_reranker` refuses a model fastembed does not support and lists the multilingual ones it does.

`LexicalReranker` (`RERANK_PROVIDER=lexical`, the default when `EMBEDDING_PROVIDER=hashing`; an explicit `RERANK_PROVIDER` overrides that default) scores each candidate by query-token coverage of its text alone: the share of the question's tokens that appear in the candidate.
Ties break on `chunk_id`, and the incoming rank plays no part.
Like the cross-encoder it is text-only and pointwise, so a graph node judged on a record's exact text scores exactly what the record would, and supersession is safe in CI too.

`CrossEncoderReranker` and the fastembed BM25 model wrap load and scoring failures in `RerankError` and `SparseEmbeddingError`; the API maps them to `CONTEXT_BUILD_ERROR` and `EMBEDDING_ERROR`.

Every judged candidate is recorded with its retrieval score, rerank score, final rank and outcome (`rag.rerank.started` and `rag.candidate.reranked` in A, `graph.rerank.started` and `graph.candidate.reranked` in B and C).
