# GraphRAG

Pipeline:

```text
question
 -> semantic seed retrieval / entity resolution
 -> graph seed nodes
 -> bounded traversal
 -> optional ontology expansion
 -> candidate evidence
 -> graph-aware ranking
 -> source-data/document retrieval
 -> context assembly
 -> same LLM
 -> answer + evidence paths
```

Graph traversal must never be unbounded.
