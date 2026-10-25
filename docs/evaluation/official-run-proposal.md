# Official run proposal (CP3)

This page is the proposal for checkpoint CP3.
It asks the project owner for three decisions before any official run: the re-ranker rule (D-025), the models, and the go-ahead for the four-question dry run.
Nothing here is approved until the owner says so.

## 1. What is ready

- The reasoning switch now works per provider.
  With `GENERATION_REASONING=off` or `JUDGE_REASONING=off`, Ollama models get `think=false` and OpenRouter models get `reasoning.enabled=false`.
  A model that reasons anyway fails loudly instead of returning an empty answer.
  Any other provider is refused at start-up when "off" is asked for.
- `compare` refuses two runs whose settings differ in anything but the generation model, and names every field that differs.
- A run keeps each finished world in `worlds/<seed>.json`.
  If a later world fails, `make run-benchmark OUT=<dir> RESUME=1` runs only the missing worlds, after checking that every setting is the same and, for an official run, that the code is committed and unchanged.
- `make dry-run` runs the four demo questions (D-036) of the presentation world with the official settings: three approaches, three repeats, the judge, 36 answers in all.
- `make diagnose-selection` measures what the shared re-ranker keeps, with no answer model.

## 2. Decision 1: the re-ranker rule (D-025)

### What the diagnostic found

The diagnostic ran on 2026-10-25 against the presentation world (seed 2026, 36,888 nodes before and after), over the 38 bank questions that have claims.
A claim is one fact a correct answer states; there are 122.
Output: `data/evaluation/diagnostics/20261025T180223Z-selection/` (not in git).

| Approach | Claims found by the graph | Claims found by the documents | Claims in the prompt |
|---|---|---|---|
| A: documents only | - | 72 | 43 |
| B: documents and the graph | 55 | 72 | 38 |
| C: documents, the graph and the ontology | 88 | 69 | 39 |

The graph finds many of the facts: 88 of 122 for C, against 72 for the document search.
On the ontology-dependent questions (H2), C's graph finds 53 of 62 claims, where the documents find 34.
But fewer of them reach the model than in A.
Every claim the graph found and the prompt left out was cut by the prompt's 12 slots (`slot_limit`): 26 claims for B and 53 for C.
The shared re-ranker scores the graph's records low against the question text, so they sit at ranks 13 to 61 among the candidates, below the cut at 12.
The token budget was not the limit: prompts in the pilot used about 1,130 of the 2,000 tokens.

So, as built, the experiment measures mostly the re-ranker's view of record text, not what the graph adds.
The pilot runs, where B and C did no better than A, are consistent with this.

### Options

Each option keeps the same question, world, corpus, models, prompt, token budget and slot count for A, B and C unless it says otherwise.

1. **Keep D-025 as built.**
   One judge picks the 12 items for every approach.
   It is the simplest and the hardest to accuse of favouring the graph, but the diagnostic shows the graph's findings rarely reach the model, so the official result would say little about the graph.
2. **More slots for everyone.**
   Raise the evidence slots for all three approaches (for example from 12 to 24) under the same 2,000-token budget.
   A gains as much room as B and C, so it stays fair.
   It helps only where the graph's records rank just below the cut; most rank lower, so the effect may be small, and the token budget would start to bind.
3. **A fixed share for the graph's selection (recommended).**
   In B and C, half of the 12 slots go to the graph's own selection, ordered by the shared re-ranker within that channel; the other half go to the documents, as in A.
   A keeps all 12 slots for documents.
   Every approach still hands the model 12 items within 2,000 tokens, through the same record text and citation builder.
   This tests the actual claim of the project: that the graph can tell the system what to look at.
   The risk is real and acceptable: if the graph's picks are worse than the documents they displace, B and C will score lower, and that is a result.
4. **Blend the graph's score into the re-ranker.**
   Rank graph candidates by a mix of the re-ranker score and the graph's own score.
   Rejected: the mixing weight is a free number, and any value we chose would be open to the charge that it was tuned to favour the graph.

### Recommendation and the guard against tuning

Option 3, with the share fixed at half before anything is measured.
The share is set by principle, not chosen by trying values against the bank: the diagnostic reads the answer key, so tuning against it would be fitting to the test.
After the change the diagnostic is run once, only to check that the graph's selection now reaches the prompt, and its numbers are reported whatever they show.
This is a method change, so it needs the owner's approval and a new decision record replacing D-025, and the pilot runs stay as they are as the record of the old rule.

## 3. Decision 2: models

### Size of an official run

Three worlds of 50 bank instances, three approaches, three repeats: 1,350 answers and 1,350 judge calls.
From the pilot: about 1,600 input and 100 output tokens per answer, and about 1,900 input and 120 output tokens per judge call.
That is about 2.2 million input and 0.14 million output tokens for the answers, and about 2.6 million input and 0.16 million output tokens for the judge.
The judge must come from another model family than the answer model (D-031).

### Choices

| Choice | Answer model | Judge | Cost | Duration | Notes |
|---|---|---|---|---|---|
| A, local (recommended) | `ollama/qwen3.6:latest`, reasoning off | `ollama/gemma4:31b`, reasoning off | none beyond the machine | about 9.5 hours (25 s per answer and judge call in the pilot) | Piloted: 324 of 324 answers kept the JSON contract, no failures. Runs with no network and no account. |
| B, hosted | Qwen3 235B A22B Instruct 2507 on OpenRouter | Gemma 4 31B on OpenRouter | about 1 to 3 US dollars | about 3 to 5 hours, set by the local retrieval and the provider's speed | A larger answer model; needs `OPENROUTER_API_KEY` and a dry run to confirm the reasoning switch holds. |
| C, both | A first, then B | as above | as B | both durations | Gives the small-against-large comparison (H7) with `compare`. |

Prices are approximate, from public price listings in October 2026 that disagree with each other by up to a factor of four; they must be checked on openrouter.ai before a hosted run.
Even at the highest listed prices a hosted run costs under 10 US dollars, so cost should not decide the choice.

### Recommendation

Choice A for the official run: it is the configuration already piloted, it is fully reproducible on this machine, and it costs nothing.
Choice C later if the owner wants the H7 model comparison; it needs no further code.

## 4. Decision 3: the dry run

`make dry-run` with the chosen models.
It wipes Neo4j, ingests the presentation world again, runs 36 answers, and restores the presentation graph, so it changes the live database for its duration and needs the owner's go-ahead.
It checks: the reasoning switch holds (no empty answers and no reasoning-token errors), the judge answers in its JSON contract, the run writes its files and publishes on the Results screen, and the graph is back at 36,888 nodes.
Expected time: about 15 minutes locally.

## 5. Order after approval

1. The owner rules on D-025; if option 2 or 3, the change is built and reviewed, and the diagnostic runs once.
2. The dry run, with its results shown to the owner.
3. The full official run, then the final Results and the release record v0.2.0.
