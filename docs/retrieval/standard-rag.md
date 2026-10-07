# Standard RAG

Pipeline:

```text
question
 -> embedding
 -> vector search
 -> top-k
 -> optional reranking
 -> context budget selection
 -> LLM
 -> answer + citations
```

The baseline must be competitive.

Record every candidate and selected chunk.

Do not deliberately weaken chunking, top-k, reranking or prompts.
