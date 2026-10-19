# Retrieval Fairness

For official A/B/C comparison:

- same question
- same world
- same source corpus
- same generation model
- same model parameters
- same embedding model
- equivalent context budget
- same time filters
- no truth-ledger access

Any deviation must be recorded with the benchmark result.

Every pipeline receives the same question.
Pipeline C's query expansion (resolved concepts' labels and synonyms appended for its document-channel search and node ranking) is part of the ontology layer under test, not a deviation: it is derived only from the question and the ontology, and the reranker and generator still see the raw question (`docs/retrieval/graph-rag.md`).
