# Retrieval Fairness

## What changed in v2

In v1 the pipelines shared models and a document channel, but A saw only documents and B and C chose and showed graph evidence on their own terms.
In v2 A reads the warehouse through record blocks, and every pipeline shares one judge, one token budget and one slot cap (D-023, D-025).
Two rules close the remaining gaps.
Every pipeline hands the generator the same list for the same selected evidence: the selection in judge order, built into one prompt and one set of citations.
The judge and the model only ever see text pipeline A could have indexed: a graph node is its row's record block or `<Label> <id>`, nothing else (D-028).
So the only differences left are the graph and ontology layers.
The contract is pinned by `backend/tests/test_lab_fairness.py`.

## Requirement

For an official A/B/C comparison every pipeline gets the same question, world, source corpus, embedding models, generation model and parameters, context budget and time filters, and none has truth-ledger access.
Any deviation must be recorded with the benchmark result.

## One judge

One reranker instance judges every candidate of every pipeline against the raw question, and one selection fills one token budget and one slot count (`docs/retrieval/context-budgeting.md`).
A's candidates are its hybrid hits; B and C get exactly A's document channel, minus the record blocks their own nodes supersede, plus a structured channel of graph nodes.
The graph guides retrieval; it does not enumerate the warehouse (design G1, section 5.4, 10a.8).

The judge sees the same text for the same record in every pipeline.
A graph node whose row has a record block in A's corpus is judged on that block, byte for byte, and the block itself is superseded, so one fact never takes two slots.
A node with a record block also takes the block's title, market and language from the source lookup, whether or not A's search returned it, so the generator sees the same block for the same fact in A, B and C, and neither the budget nor the prompt carries a B- or C-only extra.
Every pipeline hands the generator its selection as one list in judge order, so when A and B select the same evidence they send the same prompt string.
The judge sees every candidate a pipeline produced within its hard caps: A's `top_k` hits, and in B and C the same hits plus every traversal node (bounded by `max_total_nodes`).

No node type carries hidden text.
Every table a structured node maps to is serialised into A's corpus (`RECORD_SERIALISER_VERSION` 2.1.0 adds markets, platforms, channels, experiments and support cases), and a node whose row has no block (a player outside any share, an unshared payment method, a supplier) is judged and shown as `<Label> <id>` only.
Authoritative columns stay on `GraphEvidence` for citations, ranking validity, market scope and the UI, and never reach the judge or the prompt.
So the graph adds reach, not access: it can bring a row into context that A's search did not rank, but never a fact A could not have retrieved.
BusinessConcept nodes (pipeline C) are judged on their ontology text: canonical name, definition, labels and synonyms.
That text is the ontology layer under test, not warehouse content.

Under a market scope both channels keep shared evidence: the vector filter admits the empty market, and the structured channel keeps market-less nodes, reading a node's market from the same column its record block carries.

## Query expansion

Pipeline C's query expansion is part of the ontology layer under test, not a deviation: it is derived only from the question and the ontology, and the reranker and generator still see the raw question (`docs/retrieval/graph-rag.md`).

## Executable contract

`backend/tests/test_lab_fairness.py` pins that:

- A, B and C share the same embeddings, sparse embedder, reranker, vector store, generator and source lookup instances;
- A, B and C use the same `top_k` and context settings, and B and C the same reference date and ranking weights;
- the shared reranker sees the same document candidates, in the same order and on the same question, in A, B and C when no seed resolves;
- with structured candidates, B's document candidates are A's minus the record blocks of B's nodes, in A's order and ranks;
- when A and B select the same evidence, the generator receives the identical prompt string and the fake generator answers identically;
- B is C minus the ontology relationship types, concept expansion, term resolver, query expansion and ontology.
