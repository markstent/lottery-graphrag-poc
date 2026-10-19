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

## One judge

One reranker instance judges every candidate of every pipeline against the raw question, and one selection fills one token budget and one slot count (`docs/retrieval/context-budgeting.md`).
A's candidates are its hybrid hits; B and C get exactly A's document channel plus a structured channel of graph nodes.
The only differences between A, B and C are the graph layer and the ontology layer: the graph guides, it does not enumerate (design G1, section 5.4, 10a.8).

The judge sees the same text for the same record in every pipeline.
A graph node whose row has a record block in A's corpus is judged on that record block, byte for byte, and the record block itself is superseded, so one fact never takes two slots.
The path line the graph pipeline adds under a selected node (`Graph path: ...`) is provenance shown to the model, not to the judge.

Some node types have no record block in A's corpus by design: markets, platforms, channels, experiments and support cases (design section 5.4 lists the serialised tables).
They are judged on one humanised sentence built from their authoritative columns ("<Label> <id>: <column name> <value>, ...").
They are evidence only the graph can reach, and that is part of what the experiment measures.
BusinessConcept nodes (pipeline C) are judged on their ontology text: canonical name, definition, labels and synonyms.

## Query expansion

Pipeline C's query expansion (resolved concepts' labels and synonyms appended for its document-channel search and node ranking) is part of the ontology layer under test, not a deviation: it is derived only from the question and the ontology, and the reranker and generator still see the raw question (`docs/retrieval/graph-rag.md`).

## Executable contract

The executable fairness contract is `backend/tests/test_lab_fairness.py`.
It pins that A, B and C share the same embeddings, sparse embedder, reranker, vector store, generator and source lookup instances.
It pins that the shared reranker sees the same document candidates, in the same order, for the same question in A, B and C.
It pins that A, B and C use the same `top_k` and context settings.
It pins that B and C share the same reference date and ranking weights.
It pins that B is C minus the ontology relationship types, concept expansion, term resolver and query expansion.
