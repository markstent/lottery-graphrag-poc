# Retrieval

This page describes the three pipelines, what they share, how they select evidence and how they answer.
The world they search is in [data.md](data.md), the graph they walk in [graph-and-ontology.md](graph-and-ontology.md), the events they emit in [api.md](api.md), and how they are scored in [evaluation.md](evaluation.md).

## How the selection method got here

The first official run, v0.2.0, found no detectable difference between A, B and C.
It used one shared re-ranker over the document and graph candidates (D-025), and then a graph share of 12 evidence slots (D-081).
Looking into its data showed that the 12 slots bound in all 1,350 prompts, that the 2,000 token budget never did (the largest prompt held 1,489 tokens), and that the record which answered the multi-hop question L05 was left out of the prompt.
Method v0.3 changed this after seeing that result, and says so wherever it reports: the graph ranks its own records (D-083), every approach fills one token budget with no item limit (D-084), and records are shown as compact facts with a path line for graph records (D-085).
The proposal with the reasons and the data is [evaluation/v0.3-method-proposal.md](evaluation/v0.3-method-proposal.md), and the rules are the decision records D-083 to D-093 in `DECISIONS.md`.
The four recorded Live Lab runs and the pilot runs of 2026-10-25 were made under the old rules and are history, not results of the current ones.
The official run v0.2.0 stays as published and is labelled as method 0.2.0 wherever it is shown.

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
| Ordering of graph records | none | graph relevance: seeds, target-type holders, others | the same, with ontology terms also naming target types |
| Path to a graph record in the prompt | none | one "reached from" line | one "reached from" line |

The experiment claims only what the comparison isolates.
B is C minus the ontology layer.
A is B minus the graph layer, except that A reads table rows through the vector index (see "Fairness").

## Architecture

### Pipeline A

```text
question
 -> dense and sparse (BM25) embedding
 -> hybrid search: dense top-k and sparse top-k, fused by reciprocal rank fusion
 -> the shared re-ranker (a cross-encoder)
 -> selection under one token budget, in re-ranked order
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
 -> candidate scoring                       (the composite score, used within tiers)
 -> graph relevance order                   (seeds, target-type holders, others; D-083)
 -> authoritative facts attached from the source tables
 -> document channel                        (the same hybrid search as A)
 -> the shared re-ranker over the documents only
 -> one selection              (documents and graph records take turns under one token budget; D-084)
 -> the same generator and prompt as A
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
The re-ranker and the generator always see the raw question, and A and B use the raw question everywhere.

**Seeds** are the resolved entities.
A seed is the first tier of the graph relevance order, and the fallback seed counts as a seed.
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

**Candidate scoring** orders the nodes inside each tier of the graph relevance order (see "How evidence is selected").
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

The composite score orders nodes within a tier and appears in telemetry.
The re-ranker never reads it, and it never sees a node.

### What a node says

Each node has one text, used for its semantic relevance; what the prompt shows is its rendered block, as below.
How a block reads is the same in A, B and C (D-085), with three declared differences that only B and C have.

- A record, whether it is a record block in the document channel or a node whose row has a record block, is shown as compact facts.
  The heading is `<Label> <id> (source: <system>.<table>, record <id>)`, and there is one `- name: value` line for each column the record serialiser states (`FACT_SERIALISERS`, facts version 1.0.0).
  The facts come from the same row A indexes, so no column A could not index reaches the prompt (D-028).
  A datetime at midnight prints as its date.
  A record in the index whose facts are not in the loaded corpus is refused with an error and never shown as prose.
- A document chunk is its title line, `{title} ({market}, {language})` with empty parts left out, then its text.
- A concept node in C is its heading `BusinessConcept <id>` and its ontology text: the canonical name, definition, labels and synonyms.
  That text is the ontology layer under test and has no counterpart in A.
- Any other node without a record block is its heading `<Label> <id>` and nothing more (D-028).
  No warehouse value reaches the prompt unless pipeline A could have indexed it.
- **The path line.**
  A node the walk reached (hops above 0) ends with `- reached from <seed>: <path>`, the discovery path from the seed it came through, for example `INC_037 -RELATED_TO_VERSION-> PLV_IDENTITY_2 <-RELATED_TO_VERSION- INC_024`.
  The arrow shows the direction the schema states for the link, and a link the schema does not state is drawn as it was walked.
  A seed, a document chunk and every block in A have no path line.
  Its tokens are counted against the same budget.

The three differences, declared because they are graph information A cannot have: the path line, a node without a record block (shown as `<Label> <id>`, which only B and C can select), and the ontology text of C's concept nodes.
All three are also tells for the judge and the labelling sheet (see [evaluation.md](evaluation.md)).

Authoritative facts from the source tables stay on the node's evidence for citations, ranking validity, market scope and the UI.
Quantitative claims in answers come from those records and not from document prose.

### How evidence is selected (v0.3)

Every approach fills one token budget with no item limit, from two ranked channels (D-083, D-084).
Method v0.3 replaces the shared re-ranker over graph candidates (D-025) and the graph share of the slots (D-081).

**The document channel.**
One re-ranker instance, shared by A, B and C, scores the document candidates against the raw question: the hybrid hits, which include the record blocks A indexes.
The model is the cross-encoder `BAAI/bge-reranker-v2-m3`, run by fastembed (D-021), and ties break on id.
B's re-ranker input is A's document channel and nothing else, so it equals A's in ids and order (a test pins it).
C's document channel searches with its expanded question, the question plus the resolved concepts' labels and synonyms, so its re-ranker input can differ from A's; the re-ranker still scores it against the raw question.
Graph nodes are never re-ranked.

**The graph channel (B and C).**
The graph orders its own nodes by a rule built from the walk (`graph_relevance_order` in `ranking.py`):

1. seeds first: every node at hops 0, which includes the fallback seed (D-027);
2. then nodes that hold a target type, the graph labels the question asks about;
3. then every other node;
4. within a tier, the composite score (the table above, weights unchanged), then node id.

A node's graph rank is its 1-based position among the in-scope nodes not of an excluded label.
A node of an excluded label, or outside the market scope, has no tier and no rank.

**The target types** come from the question text by a deterministic matcher (`TargetTypeMatcher` in `resolution.py`), which reads the schema and the ontology only and never the bank.

- Schema vocabulary, in B and C: every node label split into words (`PlatformVersion` is "platform version"), the last word alone when no other label ends in it ("mechanic", "segment", "family", "platform", "game", "player", "case"), and the table names of `NODE_SOURCES`.
  `BusinessConcept`, `Document` and `DocumentChunk` are left out.
  There are 50 phrases.
- Ontology vocabulary, in C only: every concept label and synonym in any language names the graph label of each binding kind of the concept and of its descendants (411 phrases).
- Matching is on whole words, casefolded, with an optional plural (`s`, `es`, and `ies` after a word ending in `y`).
  It is leftmost-longest and non-overlapping, so "game mechanic" names `GameMechanic` and not `Game`.
  The schema phrases and the ontology phrases match in two separate passes and the labels are united, so C's target types always contain B's.
- `graph.target_types.resolved` records the labels the question named, empty when none.

A node **holds** a target type when its own label is one, or when a stated link from the node, in its stored direction, joins it to a node whose label is a target type, and the triple (relationship type, node label, target label) is in the schema (`RELATIONSHIP_ENDPOINTS`).
A stated link is any link among the nodes the walk reached, of every relationship type in the schema and not only those the walk follows, so a Player holds Game through `PLAYS` although the walk does not traverse it.
The links are read in one centralised, bounded query (`RETRIEVAL_STATED_LINKS`, `with_stated_links`) and only when the question names a target type: at most the total node limit of visited ids (`GRAPH_MAX_TOTAL_NODES`, default 200), at most 5,000 rows, and a result over the limit or an id count over it is an error that fails the run, never a silent cut.
The row count is recorded on `graph.context.assembled`.

The cue is for B and C only.
A gets no table boost, because that would change the tuned baseline, and the difference is declared.
The risk is breadth: "market", "game", "player", "incident", "case", "method" and "draw" are common words, so the target tier can hold many nodes and then adds little.

**The merge** (`interleave_by_budget` in `context.py`):

- The channels take turns, starting with documents, so B's first block is A's first block.
  C's first block is the first of its own re-ranked documents, which can differ from A's because C searches with its expanded question.
  A's selection is its cross-encoder order cut at the budget.
- Each offered item is checked in this order and the first failing check is its discard reason: `same_record` (a record block or node whose row is already selected through the other channel, so a row is taken once, at its first appearance), `context_budget`, `duplicate` (document chunks only, Jaccard at or above 0.85, because two distinct rows with similar columns are different facts).
- A refused item keeps the turn with its channel, so the channel offers its next item.
  An admitted item passes the turn.
  When one channel is used up, the other continues alone.
- The walk is single pass, and nothing is lost by that: every refusal is final, because the budget only shrinks and a selected row stays selected.
- Every item is charged the tokens of the block the prompt shows for it, at four characters per token (`block_tokens`), the same for A, B and C.
  A's selection therefore differs from v0.2.0 only through this charge and the removed 12-item limit.
- The selected list is in prompt order, and that single list is what the generator receives.

| Setting | Default | Meaning |
|---|---|---|
| `RAG_CONTEXT_TOKEN_BUDGET` | 2000 | Total tokens for all selected blocks, rendered as the prompt shows them |
| `RAG_DEDUPE_THRESHOLD` | 0.85 | Jaccard overlap at which a document chunk is a near-duplicate |
| `RAG_TOP_K` | 40 | The document pool, as A has always used |

`RAG_EVIDENCE_SLOTS` and `RAG_GRAPH_SLOTS` no longer exist.
A value left in the environment stops the start-up with a message naming D-084, so an old `.env` cannot be read as if it still applied.
The rule is recorded as `graph-rank-interleave-budget`, and the reproducibility record holds the method version, the facts version and the prompt extras, so runs of different methods never compare or resume as one experiment (D-092).

### Answers

A, B and C share one generator, one prompt and one parser.
The prompt numbers the selected blocks in prompt order, whatever their kind, and asks for exactly one JSON object:

```json
{ "verdict": "<one line, or 'unknown' when the sources do not answer>", "answer": "<prose with [n] citations>" }
```

The prompt version is `PROMPT_VERSION` 3.0.0 (D-085), recorded with every benchmark run (2.0.0, D-024, was the prompt of v0.2.0).
It tells the model that the verdict is the answer itself in one line and never a status word such as "success" or "ok", and that a source line starting with "reached from" shows how that record connects to an entity named in the question.
The same prompt serves A, B and C.
The answer parser is version `ANSWER_PARSER_VERSION` 2.1.0 (D-096), recorded with every run as `answer_parser_version`; a run recorded without it was read by parser 1.0.0, which tried strict JSON, then fenced JSON, then plain text.
Parser 2.0.0 was in use for a few hours on 2026-10-29 (the Live Lab re-recordings of that day); 2.1.0 carries the fixes of its review.
`parse_answer` reads every output the same way, whatever the pipeline, and `answer_from` builds the recorded answer from it for A, B and C alike:

1. **json**: the output is the JSON object, read with control characters inside its strings accepted (`strict=False`), or the object inside a code fence.
2. **Field by field**, when no JSON reader accepts the output, it opens with `{"verdict": "`, and it holds no complete JSON value followed by more text:
   - the verdict is its string up to the first double quote no backslash escapes;
   - then the answer key must follow, as the prompt orders the keys;
   - the verdict counts only when a comma follows its closing quote, since an output that ends right after a quote may have ended inside the verdict;
   - an escape JSON does not know, such as LaTeX's `\exists` or `\u` without four hex digits, is kept as written, backslash and all (the real case: the re-recorded H1 C answer wrote a formula);
   - **repaired**: the first bare quote in the answer that is followed by the closing brace ends the output, and every bare quote before it is the model's own text (the real case: the model quoted the question without escaping its quotes);
   - **unclosed**: the output ends before the object closes, and the answer is the text up to where the output ends, unescaped, less an escape or a high surrogate (half a character pair) the end cut short; a final bare quote with no brace after it is kept.
     Parser 2.0.0 called this form `cut_off`.
3. **plain**: anything else is the whole output as the answer with an empty verdict.
   That includes an answer-first object, a complete object or a closed object followed by more text, an answer holding a second `{"verdict":` object (the model began a second reply, so the first verdict may be one it retracted), and an object with bare quotes inside a code fence, which is not read field by field.
   Choosing one of several objects would drop answer text the model wrote, so the parser does not choose.

The parser never invents content and never drops text the model wrote into its answer.
The verdict is read from its slot as written and is never reconciled with the answer text, so an answer can contradict its own verdict, as the re-recorded H1 C answer does (verdict "Austria, Czech Republic", answer ending "Answer: Czech Republic.").
Every stored output that parser 1.0.0 read as JSON reads the same under 2.0.0; only outputs it left as plain text read differently (D-096).
A citation `[n]` or `[n, m]` counts only if it points at a block the model was shown, so an answer cannot cite a source it was not given.
Ranges such as `[1-3]` are not supported.
The result keeps the parsed answer, the verdict, the cited block numbers, the model's raw text and the token usage.
It also records how the output was read and ended: `answer_form`, the provider's `finish_reason`, `token_limit_reached`, the call's `max_tokens` and `cut_off`.
`token_limit_reached` is true when the stop reason is `length` or the completion token count reached `max_tokens`, false when fewer tokens were reported, and null when the provider reports neither.
The count is read as well because LiteLLM's `ollama/` adapter reports `stop` for every answer, also for one Ollama stopped at the limit (`tests/test_gateway.py` runs it offline).
An answer is `cut_off` when it stopped at the limit, or when its form is `unclosed` and the provider reported neither a stop reason of `length` nor a token count; an unclosed object that stopped below the limit is how the model ended its reply, not a cut (the re-recorded H1 C answer: `stop`, 3,803 of 4,096 tokens).
Live Lab and Results say so in plain words.
The output limit `GENERATION_MAX_TOKENS` is 4096 from D-096, the same for A, B and C; 1200, the limit of v0.2.0, cut off answers in which the model wrote its reasoning inside the answer.
With prompts of about 3,400 tokens, 4096 output tokens fit well inside the 32,768-token context the local Ollama server runs with.
A gateway failure or an empty output raises an error.
The parser never turns a failed call into an answer.

## Fairness

For an official comparison every pipeline gets the same question, world, source corpus, embedding models, re-ranker, generation model and parameters, token budget and prompt, and none can read the truth ledger.
There is no item limit for any approach.
Any deviation must be recorded with the benchmark result.

What makes it hold:

- **One lab.** A, B and C are built from one configuration by `lab.py`.
- **One re-ranker, one budget, one list.** The same selected evidence gives the same prompt string in A, B and C, apart from the declared path line.
  Every approach is charged the tokens of the rendered block.
- **Equal access.** Record blocks give A the warehouse access B and C get through the graph, so the comparison isolates relationships and not data access.
  The graph adds reach, because it can bring in a row A did not rank.
  It adds no access, because it cannot bring in a fact A could not have retrieved.
- **B is C minus the ontology.** B has no ontology relationship types, no concept expansion, no term resolver and no query expansion (D-017).
- **Query expansion is part of the layer under test.** It is derived only from the question and the ontology.
- **Declared extras for B and C.** The graph's own product is not available to A, and v0.3 shows it on purpose (D-083, D-085):
  the target-type tier, which uses the schema vocabulary and, in C, the ontology's labels and synonyms;
  the "reached from" path line on graph records the walk reached;
  a node without a record block, shown as `<Label> <id>`, and C's concept nodes with their ontology text.
  The run record lists them as `prompt_extras`, and a reader should weigh the result with them in mind: it measures the graph with them, not a graph without them.

`backend/tests/test_lab_fairness.py` pins that:

- A, B and C share the same embedder, sparse embedder, re-ranker, vector store, generator and source lookup;
- they use one frozen context settings object (the budget and the dedupe threshold), and B and C the same reference date and ranking weights;
- B's re-ranker input is A's document channel only, equal in ids and order, and no node reaches it;
- A's selection is its cross-encoder order cut at the budget, and running B and C does not change it;
- A, B and C hand the generator the same raw question, one answer model and one prompt;
- the same row renders the same block in A, B and C, and the only line that differs is the path line of a graph record the walk reached;
- no block shows an empty scope fragment such as "(, en)";
- B is C minus the ontology relationship types, concept expansion, term resolver, query expansion and ontology;
- the retrieval modules load no evaluation or scenario module, and never name the labels directory (`test_truth_ledger_isolation.py`).

## Embeddings and indexing

| Role | Model | Run by |
|---|---|---|
| Dense | `bge-m3`, 1024 dimensions | Ollama over `httpx` |
| Sparse | `Qdrant/bm25` | fastembed, in process |
| Re-ranker | `BAAI/bge-reranker-v2-m3`, about 2.3 GB on first use | fastembed, in process |

All three are multilingual or language-neutral for English, Greek, German and Czech.
The dense embedder normalises every vector and refuses one whose length differs from `EMBEDDING_DIMENSIONS`.
The model names are stamped into the index manifest and into every benchmark record, and changing one needs an index rebuild.
CI uses a hashing embedder and a lexical re-ranker (query-token coverage), so retrieval mechanics are testable without model downloads.

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
| `RERANK_PROVIDER`, `RERANK_MODEL` | `cross_encoder`, `BAAI/bge-reranker-v2-m3` | The one re-ranker. `lexical` is the CI re-ranker. |
| `QDRANT_URL`, `QDRANT_COLLECTION` | `http://localhost:6333`, `semantic_context_lab` | The shared collection |
| `RAG_TOP_K` | 40 | Dense and sparse hits each before fusion |
| `RAG_CONTEXT_TOKEN_BUDGET`, `RAG_DEDUPE_THRESHOLD` | 2000, 0.85 | The shared token budget, and the near-duplicate threshold. `RAG_EVIDENCE_SLOTS` and `RAG_GRAPH_SLOTS` are removed and refused if set (D-084). |
| `GENERATION_PROVIDER`, `GENERATION_MODEL`, `GENERATION_TEMPERATURE`, `GENERATION_MAX_TOKENS`, `GENERATION_TIMEOUT_S` | `fake`, `fake-answer-v1`, 0, 4096, 120 | The answer model. `fake` is the deterministic CI generator. |
| `GENERATION_API_BASE`, `GENERATION_MODEL_FAMILY`, `GENERATION_MODEL_QUANTISATION`, `GENERATION_REASONING` | unset, unset, unset, `default` | Gateway address, and the facts recorded with each benchmark run. `off` asks a thinking model not to think. |
| `GRAPH_*` | see [graph-and-ontology.md](graph-and-ontology.md) | Traversal caps and the reference date |

Setting `EMBEDDING_PROVIDER=hashing` also switches the sparse and re-ranker defaults to their CI forms, unless `RERANK_PROVIDER` is set.
`.env.example` sets `RERANK_PROVIDER=cross_encoder` explicitly, so copying it whole into a hashing setup keeps the cross-encoder.
A local thinking model with `GENERATION_REASONING=default` can spend the whole token cap thinking and return an empty answer.

## Testing

- `test_standard_rag.py`, `test_records.py`, `test_sparse_and_fusion.py`, `test_rerank_cross_encoder.py`, `test_generation_v2.py`, `test_embeddings.py`: pipeline A and its parts.
- `test_graph_rag.py`, `test_graph_stages.py`: B and C, including caps, weight-ordered cuts, replayable paths, ontology expansion, excluded labels, score components, the document-only re-ranker call, the fallback seed, market scope and determinism over the full event sequence.
- `test_resolution.py`: the target-type matcher, including leftmost-longest matching, plurals, C containing B, and that it reads only the schema and the ontology.
- `test_graph_ranking.py`: the three tiers and their tie-breaks, holding a target type through a discovery link and a stated link, path rendering, and the bounded stated-links query.
- `test_context_selection.py`: the merge (alternation, one channel used up, a row in both channels, budget refusals, no selection over the budget) and A's selection.
- `test_records.py`, `test_generation_v2.py`: the facts of every table (golden blocks), the path line, the prompt hash.
- `test_lab_fairness.py`: the fairness contract and the declared extras.
- `test_failure_modes.py`: that failures propagate instead of becoming answers.
- `test_vector_store_qdrant.py` (`VECTOR_E2E=1`) and `test_graph_rag_live.py` (`GRAPH_E2E=1`): live services.
  The graph live test wipes and re-ingests a tiny world, so run `make ingest-graph` afterwards.

## Extension points

- A new record table: a serialiser in `records.py`, then a version bump and an index rebuild.
  It also changes what A can see, so it changes the comparison.
- A new seedable id prefix: `SEED_ID_PREFIXES`, which is a method change.
- A new reranker or model: configuration, then an index rebuild when the embedding model changes.
- Changing how the graph's records are ordered, how the channels are merged or how a record is shown is a method change (D-083 to D-085) that needs the owner's approval and a new method version.
- A new target-type phrase comes only from the schema or the ontology, never from the bank.

## Failure modes

| Failure | Result |
|---|---|
| Neo4j unreachable | The graph reader raises, and the API records a typed error for B and C. |
| Embedding service unavailable | Scoring raises before any context is built, and no answer is invented. |
| Sparse model or re-ranker fails | `EMBEDDING_ERROR` or `CONTEXT_BUILD_ERROR` in the API. |
| Model unreachable, or an empty answer | `MODEL_ERROR`. |
| Traversal cap reached | The caps are recorded on the traversal event, the walk never exceeds them, and edges beyond a cap are neither followed nor recorded. |
| Stated links over their limit (more than 200 ids or 5,000 rows), or not read when a target type was named | `StatedLinksError`, classified as `GRAPH_QUERY_ERROR`: the run fails with the graph error and `pipeline.failed`, and the benchmark stops. Nothing is cut or read as none. |
| `RAG_EVIDENCE_SLOTS` or `RAG_GRAPH_SLOTS` set | The settings refuse to load and name D-084. |
| A record in the index with no facts in the loaded corpus | An error naming the record and saying to rebuild the index; no prose fallback. |
| Index built by another serialiser version, or dense only | The lab refuses to start with a message naming the fix (`make index-vector`). |

The archived retrieval pages are in [reference/retrieval/](reference/retrieval/standard-rag.md).
