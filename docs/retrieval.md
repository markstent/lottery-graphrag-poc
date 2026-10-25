# Retrieval

This page describes the three pipelines, what they share, how they select evidence and how they answer.
The world they search is in [data.md](data.md), the graph they walk in [graph-and-ontology.md](graph-and-ontology.md), the events they emit in [api.md](api.md), and how they are scored in [evaluation.md](evaluation.md).

## Open method question for the owner

The four recorded live development runs showed B and C no better than A.
They are one question each from the strata H1, H2, H3 and H5, one model (qwen3.6 through Ollama, reasoning off) and one repeat, on the seed 2026 development world.
They are not a benchmark result.

| Question | A answer / evidence | B answer / evidence | C answer / evidence |
|---|---|---|---|
| L05 (H1), incidents on the same platform version as INC_037 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| L09 (H2), games in other markets of the same kind as GAME_AT_05 | 0.40 / 0.35 | 0.50 / 0.14 | 0.50 / 0.14 |
| L01 (H3), ticket price of GAME_AT_04 | 1.00 / none | 1.00 / none | 1.00 / none |
| L15 (H5), cause of INC_041 | 0.00 / 0.15 | 0.00 / 0.15 | 0.00 / 0.15 |

B and C are level with A on three of the four.
On L09 B and C wrote a slightly better answer and found less of the needed evidence.
C's scores equal B's on every question.
The H3 question has no evidence score, because it has no claims to find.

On the multi-hop question L05, B's traversal found INC_024, the record that carries the claim the answer needs.
The one shared re-ranker (decision D-025) then judged that record together with A's document search results, and did not select it.
Four items reached the prompt: INC_037 and three support cases.
The model answered that the sources do not contain the answer.
This is the designed behaviour of D-025, not a defect, and neither the rule nor the questions were changed, because that would favour one approach.

D-025 was presented with CP1 part 2, which the project owner approved.
DECISIONS.md records it as a controller ruling, and the owner has the method question open before CP3.
Whether it is still the rule the owner wants, or whether the graph's selection should reach the prompt in some other way, is a method question to settle before CP3, the official run.
Changing it is a method change that needs the owner's approval first.
Until then this page describes the rule as built.

## Purpose

Three pipelines answer the same question over the same world, and differ only in the layers added above plain search.

| | A, Text search | B, Graph | C, Graph + Ontology |
|---|---|---|---|
| Entity resolution | none | graph ids and market names | ids and markets, plus ontology terms in four languages |
| Query expansion | none | none | concept labels and synonyms appended to the query |
| Graph traversal | none | 19 relationship types | 22 relationship types |
| Ontology expansion | none | none | concept-bound records, ranked and bounded |
| Document channel | hybrid search | same as A | same as A, with C's expanded query |
| Structured record channel | serialised table rows in the same search | the same rows, plus every traversal node | the same, plus concept-bound nodes |

The experiment claims only what the comparison isolates.
B is C minus the ontology layer.
A is B minus the graph layer, except that A reads table rows through the vector index (see "Fairness").

## Architecture

### Pipeline A

```text
question
 -> dense and sparse (BM25) embedding
 -> hybrid search: dense top-k and sparse top-k, fused by reciprocal rank fusion
 -> the shared judge (a cross-encoder re-ranker)
 -> selection under one token budget and one slot count
 -> generator
 -> structured answer with citations
```

Code: `backend/app/retrieval/standard/`.

- The index holds two kinds of item in one Qdrant collection: document chunks, and record blocks.
  A record block is one short English text for one row of a source table, from one fixed template per table, with local names joined from the taxonomy tables and a provenance sentence at the end (`records.py`).
  The tables serialised are games, platform versions, incidents, campaigns, player segments, payment providers, app versions, game families, game mechanics, incident types, support categories, markets, platforms, channels, experiments and support cases, plus shared devices, shared payment methods and the players taking part in a share.
  The serialiser is versioned (`RECORD_SERIALISER_VERSION`, 2.1.0).
  Any change to a template or query bumps it and needs an index rebuild.
- Every item has a named dense vector (cosine) and a named sparse vector.
- Search runs a dense and a sparse top-k inside the same filter, then fuses them on the client by reciprocal rank fusion with k=60.
  Ties break by fused score, then dense rank, then id.
  The in-memory store and Qdrant therefore give the same order (D-022).
  A hit's `similarity` is the fused rank score and not a cosine.
- A market scope admits the scoped markets plus market-less items, in every pipeline.
- `RAG_TOP_K` defaults to 40.

### Pipelines B and C

```text
question
 -> entity resolution                       (B: ids and markets; C: plus ontology terms)
 -> query expansion                         (C only)
 -> seed selection                          (resolved entities; else the graph node of the best record hit)
 -> bounded traversal of the record subgraph
 -> ontology expansion                      (C only)
 -> candidate scoring                       (ranks the structured channel, drives telemetry)
 -> authoritative facts attached from the source tables
 -> document channel                        (the same hybrid search as A)
 -> record blocks of structured candidates are superseded
 -> one judge over both channels
 -> one selection
 -> the same generator as A
```

Code: `backend/app/retrieval/graph/`.
`GraphRagPipeline.run` composes six typed stages from `stages.py`: `resolve`, `traverse`, `rank_and_scope`, `select_and_attach`, `document_channel` and `assemble_and_generate`.
The structured candidates are chosen before the document channel runs, because the channel drops exactly their record blocks.

**Entity resolution** is deterministic and uses no model.

- B finds graph ids in the question by pattern and prefix, checked against the graph, then market names and codes as whole words.
  The seedable prefixes are declared once in `SEED_ID_PREFIXES` (`source_lookup.py`): `INC_`, `MKT_`, `PLV_`, `PLT_`, `GAME_`, `APPV_`, `CMP_`, `FAM_`, `PLAYER_` and `PAY_`.
  Document, chunk and concept ids are never seeds.
  Adding a prefix changes which question tokens resolve, which is a method change.
- C runs the same id resolver, then the ontology term matcher over every concept label, synonym and local display name in four languages.
  A matched term gives its concept (confidence 0.8).
  When the matched text is the local display name of some of the concept's codes, it also gives those codes.
  Otherwise it gives the concept's codes in the first market the id resolver found (confidence 0.7).
  Codes with no graph node are skipped.

**Query expansion** (C only) appends the labels and synonyms of every resolved concept to the question on a new line.
The expanded text drives C's document search, the fallback seed search and the semantic ranking of nodes.
The judge and the generator always see the raw question, and A and B use the raw question everywhere.

**Seeds** are the resolved entities.
A seed has no reserved slot and is judged like any other candidate.
When nothing resolves, the fallback seed is the graph node of the best record hit in the shared vector layer, found with A's own models (D-027).
When there is no record hit there is no seed, and B and C then run on the document channel alone.
A seed is never invented.

**Traversal** is breadth-first and undirected over the structured record subgraph.

- Allow-list: 22 relationship types for C and 19 for B (see [graph-and-ontology.md](graph-and-ontology.md)).
- Document nodes are never traversal targets or candidates (D-026).
  The neighbour query drops excluded labels before the per-type cap, so a document cannot take a permitted neighbour's place.
- Caps: depth 2, 100 nodes per hop, 4 edges per node and relationship type, 200 nodes in total, and a hard `LIMIT 5000` on any one neighbour query.
- When candidate edges exceed a hop budget they are explored in relationship-strength order, ties broken by node id, so a cut is never alphabetical.
- Every visited node keeps its discovery path (parent, relationship, hop distance, weakest edge on the path), so any evidence item can be drawn again.

**Ontology expansion** (C only): each reached concept brings in its bound records one hop behind the concept.
At most four are taken per concept, ordered by semantic relevance to the expanded question and then by id, within the node cap.
Records already reached, and records of an excluded label, are not candidates.
These nodes are announced with the concept they came through.

**Candidate scoring** ranks the structured channel.
It is a weighted sum of four recorded components, shared by B and C:

| Component | Weight | Meaning |
|---|---|---|
| graph distance | 0.25 | `1 / (1 + hops / 2)` |
| relationship type | 0.25 | the weakest relationship weight on the path from the seed |
| semantic relevance | 0.35 | dense cosine between the question and the node text, with A's model |
| temporal validity | 0.15 | 1.0 when the record's validity has not ended before the reference date, 0.3 when it has |

The relationship weights are defined once (`RELATIONSHIP_WEIGHTS` in `traversal.py`) and serve both the traversal cut and the ranking.
They run from 1.0 for a seed, through 0.9 for the version links, 0.8 for `AFFECTS`, `USES_PAYMENT` and `PROVIDED_BY`, 0.7 for `CONCERNS` and `OF_TYPE`, down to 0.3 for `USES`.
`MAPS_TO` is 0.5.
A node without an authoritative row counts as current.
The weights are in `DEFAULT_RANKING_WEIGHTS` and are not read from the environment.
No weight is tuned to make a scenario pass, and a change to the table is an experiment change that must be re-validated before an official run.

The composite score orders the structured channel and appears in telemetry.
It does not select context, and neither judge reads it.

### What a node says

Each node has one text, used for ranking, by the judge and in the prompt.

- A node whose row has a record block in A's corpus gets that block's text, byte for byte.
  It is also shown with that block's title, market and language, whether or not the search returned the block.
- A concept node in C gets its ontology text: the canonical name, definition, labels and synonyms.
  That text is the ontology layer under test and has no counterpart in A.
- Any other node reads `<Label> <id>` and nothing more (D-028).
  No warehouse value reaches the judge or the prompt unless pipeline A could have indexed it.

Authoritative facts from the source tables stay on the node's evidence for citations, ranking validity, market scope and the UI.
They never enter the judge or the prompt.
Quantitative claims in answers come from those records and not from document prose.

### The one judge and one selection

One re-ranker instance, shared by A, B and C, scores every candidate a pipeline has against the raw question.
A's candidates are its hybrid hits.
B and C hand it, in one call, the same document channel plus every traversal node.
The model is the cross-encoder `BAAI/bge-reranker-v2-m3`, run by fastembed (D-021).
Ties break on id.
There is no cut inside the judge.

Before judging, a record block whose record id is a structured candidate is dropped as `superseded_by_structured_fact`, so one fact never takes two slots.
The node is judged on that record's exact text, so a node that loses means the record would have lost too.

One selection walks the judged list under one token budget and one slot count (D-023):

| Setting | Default | Meaning |
|---|---|---|
| `RAG_CONTEXT_TOKEN_BUDGET` | 2000 | Total tokens for all selected blocks, estimated at 4 characters per token |
| `RAG_EVIDENCE_SLOTS` | 12 | The most evidence items any pipeline may place in the prompt |
| `RAG_DEDUPE_THRESHOLD` | 0.85 | Jaccard overlap at which a document chunk is a near-duplicate |

For each candidate the first failing check is its discard reason, in this order: `context_budget` (a smaller later candidate may still fit), `slot_limit`, `duplicate`.
The near-duplicate check applies to document chunks only, because two distinct rows with similar columns are different facts.
No channel has reserved slots.
The budget counts block text only, not titles.
The selection comes back in judge order, and that single list is what the generator receives.

### Answers

A, B and C share one generator, one prompt and one parser.
The prompt numbers the selected blocks in judge order, whatever their kind, and asks for exactly one JSON object:

```json
{ "verdict": "<one line, or 'unknown' when the sources do not answer>", "answer": "<prose with [n] citations>" }
```

The prompt version is `PROMPT_VERSION` 2.0.0 (D-024), recorded with every benchmark run.
`parse_answer` tries strict JSON, then fenced JSON, then plain text with an empty verdict.
A citation `[n]` or `[n, m]` counts only if it points at a block the model was shown, so an answer cannot cite a source it was not given.
Ranges such as `[1-3]` are not supported.
The result keeps the parsed answer, the verdict, the cited block numbers, the model's raw text and the token usage.
A gateway failure or an empty output raises an error.
The parser never turns a failed call into an answer.

## Fairness

For an official comparison every pipeline gets the same question, world, source corpus, embedding models, re-ranker, generation model and parameters, token budget, slot count and prompt, and none can read the truth ledger.
Any deviation must be recorded with the benchmark result.

What makes it hold:

- **One lab.** A, B and C are built from one configuration by `lab.py`.
- **One judge, one budget, one list.** The same selected evidence gives the same prompt string in A, B and C.
- **Equal access.** Record blocks give A the warehouse access B and C get through the graph, so the comparison isolates relationships and not data access.
  The graph adds reach, because it can bring in a row A did not rank.
  It adds no access, because it cannot bring in a fact A could not have retrieved.
- **B is C minus the ontology.** B has no ontology relationship types, no concept expansion, no term resolver and no query expansion (D-017).
- **Query expansion is part of the layer under test.** It is derived only from the question and the ontology.

`backend/tests/test_lab_fairness.py` pins that:

- A, B and C share the same embedder, sparse embedder, re-ranker, vector store, generator and source lookup;
- they use the same `top_k` and context settings, and B and C the same reference date and ranking weights;
- the shared re-ranker sees the same document candidates, in the same order, in A, B and C when no seed resolves;
- B's document candidates are A's minus the record blocks of B's nodes, in A's order and ranks;
- when A and B select the same evidence, the generator receives the identical prompt and the stand-in generator answers identically;
- B is C minus the ontology relationship types, concept expansion, term resolver, query expansion and ontology.

## Embeddings and indexing

| Role | Model | Run by |
|---|---|---|
| Dense | `bge-m3`, 1024 dimensions | Ollama over `httpx` |
| Sparse | `Qdrant/bm25` | fastembed, in process |
| Re-ranker | `BAAI/bge-reranker-v2-m3`, about 2.3 GB on first use | fastembed, in process |

All three are multilingual or language-neutral for English, Greek, German and Czech.
The dense embedder normalises every vector and refuses one whose length differs from `EMBEDDING_DIMENSIONS`.
The model names are stamped into the index manifest and into every benchmark record, and changing one needs an index rebuild.
CI uses a hashing embedder and a lexical judge (query-token coverage), so retrieval mechanics are testable without model downloads.

```bash
make index-vector                                          # Ollama and bge-m3 into Qdrant
cd backend && uv run python -m app.retrieval.standard --provider hashing   # deterministic, no services
cd backend && uv run python -m app.retrieval.standard --no-rebuild         # upsert into the existing collection
```

The build writes `<dataset>/vector-index.json`: dense and sparse model names, dimensions, vector names, the serialiser version, the chunk count and the record count.
For the seed 2026 world it holds 262 chunks and 11,301 record blocks.
The lab refuses a populated collection that is dense-only, whose dense size differs from the embedder's, or whose manifest names another serialiser version or is missing.
At cold start the API indexes an empty collection in process, and writes the manifest only for a Qdrant index.

## Operation

```bash
make services-up
make generate-dev-data ingest-graph index-vector     # once per world
make traces                                           # side-by-side A, B, C with the stand-in generator
```

`make traces` runs the demo questions of the frozen bank through all three pipelines and writes [evaluation/example-traces.md](evaluation/example-traces.md), a generated file.
The answers there come from the deterministic stand-in generator.
Resolution, seeds, traversal, scores, discards and budgets are the real retrieval telemetry.

The trace command needs the dev graph, the index and a grounded bank.
Never edit the generated file.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `OLLAMA_HOST` | `ollama`, `bge-m3`, 1024, `http://localhost:11434` | Dense model. `hashing` is the CI model. |
| `SPARSE_PROVIDER`, `SPARSE_MODEL` | unset, `Qdrant/bm25` | Sparse model. Unset follows the dense provider: hashing gives hashing, otherwise fastembed. |
| `FASTEMBED_CACHE` | `~/.cache/fastembed` | Download cache for the sparse and re-ranker models |
| `RERANK_PROVIDER`, `RERANK_MODEL` | `cross_encoder`, `BAAI/bge-reranker-v2-m3` | The one judge. `lexical` is the CI judge. |
| `QDRANT_URL`, `QDRANT_COLLECTION` | `http://localhost:6333`, `semantic_context_lab` | The shared collection |
| `RAG_TOP_K` | 40 | Dense and sparse hits each before fusion |
| `RAG_CONTEXT_TOKEN_BUDGET`, `RAG_EVIDENCE_SLOTS`, `RAG_DEDUPE_THRESHOLD` | 2000, 12, 0.85 | The shared budget |
| `GENERATION_PROVIDER`, `GENERATION_MODEL`, `GENERATION_TEMPERATURE`, `GENERATION_MAX_TOKENS`, `GENERATION_TIMEOUT_S` | `fake`, `fake-answer-v1`, 0, 1200, 120 | The answer model. `fake` is the deterministic CI generator. |
| `GENERATION_API_BASE`, `GENERATION_MODEL_FAMILY`, `GENERATION_MODEL_QUANTISATION`, `GENERATION_REASONING` | unset, unset, unset, `default` | Gateway address, and the facts recorded with each benchmark run. `off` asks a thinking model not to think. |
| `GRAPH_*` | see [graph-and-ontology.md](graph-and-ontology.md) | Traversal caps and the reference date |

Setting `EMBEDDING_PROVIDER=hashing` also switches the sparse and re-ranker defaults to their CI forms, unless `RERANK_PROVIDER` is set.
`.env.example` sets `RERANK_PROVIDER=cross_encoder` explicitly, so copying it whole into a hashing setup keeps the cross-encoder.
A local thinking model with `GENERATION_REASONING=default` can spend the whole token cap thinking and return an empty answer.

## Testing

- `test_standard_rag.py`, `test_records.py`, `test_sparse_and_fusion.py`, `test_rerank_cross_encoder.py`, `test_generation_v2.py`, `test_embeddings.py`: pipeline A and its parts.
- `test_graph_rag.py`, `test_graph_stages.py`, `test_resolution.py`: B and C, including caps, weight-ordered cuts, replayable paths, ontology expansion, excluded labels, score components, the one-judge call, the fallback seed, market scope and determinism over the full event sequence.
- `test_lab_fairness.py`, `test_context_budget_v2.py`: the fairness contract and the shared budget.
- `test_failure_modes.py`: that failures propagate instead of becoming answers.
- `test_vector_store_qdrant.py` (`VECTOR_E2E=1`) and `test_graph_rag_live.py` (`GRAPH_E2E=1`): live services.
  The graph live test wipes and re-ingests a tiny world, so run `make ingest-graph` afterwards.

## Extension points

- A new record table: a serialiser in `records.py`, then a version bump and an index rebuild.
  It also changes what A can see, so it changes the comparison.
- A new seedable id prefix: `SEED_ID_PREFIXES`, which is a method change.
- A new reranker or model: configuration, then an index rebuild when the embedding model changes.
- Changing how the graph's selection reaches the prompt is the open method question above.

## Failure modes

| Failure | Result |
|---|---|
| Neo4j unreachable | The graph reader raises, and the API records a typed error for B and C. |
| Embedding service unavailable | Scoring raises before any context is built, and no answer is invented. |
| Sparse model or re-ranker fails | `EMBEDDING_ERROR` or `CONTEXT_BUILD_ERROR` in the API. |
| Model unreachable, or an empty answer | `MODEL_ERROR`. |
| Traversal cap reached | The caps are recorded on the traversal event, the walk never exceeds them, and edges beyond a cap are neither followed nor recorded. |
| Index built by another serialiser version, or dense only | The lab refuses to start with a message naming the fix (`make index-vector`). |

The archived retrieval pages are in [reference/retrieval/](reference/retrieval/standard-rag.md).
