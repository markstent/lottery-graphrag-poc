# Official run proposal (CP3)

This page is the proposal for checkpoint CP3.
It asks the project owner for three decisions before any official run: the re-ranker rule (D-025), the models, and the go-ahead for the four-question dry run.
Nothing here is approved until the owner says so.

## 1. What is ready

- The reasoning switch now works per provider.
  With `GENERATION_REASONING=off` or `JUDGE_REASONING=off`, Ollama models get `think=false` and OpenRouter models get `reasoning.enabled=false`.
  A model that reasons anyway fails loudly instead of returning an empty answer.
  Any other provider is refused at start-up when "off" is asked for.
- `compare` refuses two runs whose settings differ in anything but the generation model, its family and quantisation, and the code revision, and names every field that differs.
  The code revision is shown when it differs, and the evidence selection rule is part of the record, so runs under different rules never pair.
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

The graph reaches many of the facts: C's graph candidates hold 88 of the 122 claims, and its own document search holds 69.
The two pools are not the same size: the graph may offer up to 200 nodes, the document search 40 chunks, so this shows reach, not precision.
On the ontology-dependent questions (H2), C's graph candidates hold 53 of 62 claims, where its documents hold 34.
But fewer claims reach the model in B and C than in A.
Every claim the graph found and the prompt left out was cut by the prompt's 12 slots (`slot_limit`): 26 claims for B and 53 for C.
The shared re-ranker scores the graph's records low against the question text: the dropped ones sit at ranks 13 to 63 among B's candidates and 13 to 94 among C's, below the cut at 12.
The token budget was not the limit: prompts in the pilot used about 1,130 of the 2,000 tokens.

So, as built, the experiment measures mostly the re-ranker's view of record text, not what the graph adds.
The pilot runs, where B and C did no better than A, are consistent with this.
Any change is therefore proposed after a pilot in which B and C did worse, and a reader of the final result may ask whether the rule was changed to help the graph.
The guard against that is below each option and in the last subsection.

### Options

Each option keeps the same question, world, corpus, models, prompt, record text, citation builder and token budget for A, B and C unless it says otherwise.
Each is described the same way: what changes, fairness, expected effect, risk.

1. **Keep D-025 as built.**
   - What changes: nothing.
   - Fairness: one judge picks the 12 items for every approach.
   - Expected effect: as in the diagnostic; few of the graph's findings reach the model.
   - Risk: the official result says little about what the graph adds.
2. **More slots for every approach.**
   - What changes: the evidence slots rise for A, B and C alike, for example from 12 to 24, under the same 2,000-token budget.
   - Fairness: A gains as much room as B and C.
   - Expected effect: the dropped claims ranked 13 to 24 would enter; most ranked lower, and the token budget would start to bind, so the effect may be small.
   - Risk: 24 is a free number; the larger prompt also changes A's result.
3. **A fixed share of the slots for the graph's own selection.**
   - What changes: in B and C, half of the 12 slots go to the graph channel's candidates, ordered by the shared re-ranker within that channel; the rest go to the documents as in A. When the graph channel has fewer usable candidates than its share, or they do not fit the token budget, the unused slots go back to the documents. A keeps all 12 slots for documents.
   - Fairness: every approach still hands the model at most 12 items within 2,000 tokens; B and C trade document slots for graph slots.
   - Expected effect: unknown until built. The diagnostic records each dropped record's rank among all candidates, not within the graph channel, so it cannot say how many would make the graph's top 6.
   - Risk: half is also a free number. It is less open to tuning than a weight only because it is one coarse value fixed in advance; it is still a choice. If the graph's picks are worse than the documents they displace, B and C score lower.
4. **Blend the graph's score into the re-ranker.**
   - What changes: graph candidates are ranked by a mix of the re-ranker score and the graph's own composite score.
   - Fairness: A is unchanged; B and C use a score A cannot have.
   - Expected effect: unknown until built.
   - Risk: the mixing weight is a continuous free number, which invites the charge that it was set to favour the graph. Not recommended.

### Recommendation and the guard against tuning

The controller recommends option 3, with the share fixed at half and the unused-slot rule above, both before anything is measured.
It is the option that lets the graph's own selection reach the model while keeping the slot count and the token budget equal.
The diagnostic reads the answer key, so no value may be chosen by trying values against it; after the change it runs once, only to check that the graph's selection now reaches the prompt, and its numbers are reported whatever they show.
The owner may also want the official run reported under both rules, the built D-025 and the chosen change, so a reader can see the effect of the rule itself.
Any change is a method change: it needs the owner's approval, a new decision record replacing D-025, and a new value of the recorded selection rule; the pilot runs stay as the record of the old rule.

## 3. Decision 2: models

### Size of an official run

Three worlds of 50 bank instances, three approaches, three repeats: 1,350 answers and 1,350 judge calls.
Estimated from the pilot, which recorded the prompt's evidence tokens (about 1,130 per answer) and the answer text but not the providers' token counts: about 1,600 input and 100 output tokens per answer, and about 1,900 input and 120 output tokens per judge call.
That is about 2.2 million input and 0.14 million output tokens for the answers, and about 2.6 million input and 0.16 million output tokens for the judge.
The judge must come from another model family than the answer model (D-031).

### Choices

| Choice | Answer model | Judge | Cost | Duration | Notes |
|---|---|---|---|---|---|
| A, local (recommended) | `ollama/qwen3.6:latest`, reasoning off | `ollama/gemma4:31b`, reasoning off | none beyond the machine | about 9.5 hours (25 s per answer and judge call in the pilot) | Piloted: 324 of 324 answers kept the JSON contract, no failures. Runs with no network and no account. |
| B, hosted | Qwen3 235B A22B Instruct 2507 on OpenRouter | Gemma 4 31B on OpenRouter | about 1 to 3 US dollars | an estimate of 3 to 5 hours, not measured; the dry run measures it | A larger answer model; needs `OPENROUTER_API_KEY` and a dry run to confirm the reasoning switch holds. |
| C, both | A first, then B | one judge for both runs, either local or hosted | as B | both durations | Gives the small-against-large comparison (H7) with `compare`, which refuses two runs with different judges; the judge must be chosen once for both. |

Prices are approximate, from public price listings in October 2026 that disagree with each other by up to a factor of four; they must be checked on openrouter.ai before a hosted run.
Even at the highest listed prices a hosted run costs under 10 US dollars, so cost should not decide the choice.

### Recommendation

Choice A for the official run: it is the configuration already piloted, it is fully reproducible on this machine, and it costs nothing.
Choice C later if the owner wants the H7 model comparison; it needs no further code, but both runs must use the same judge, so choosing the local judge now keeps that open.

## 4. Decision 3: the dry run

`make dry-run` with the chosen models.
It wipes Neo4j, ingests the presentation world again, runs 36 answers, and restores the presentation graph, so it changes the live database for its duration and needs the owner's go-ahead.
It checks: the reasoning switch holds (no empty answers and no reasoning-token errors), the judge answers in its JSON contract, the run writes its files and publishes on the Results screen, and the graph is back at 36,888 nodes.
Expected time: about 15 minutes locally.

## 5. Order after approval

1. The owner rules on D-025; if option 2 or 3, the change is built and reviewed, and the diagnostic runs once.
2. The dry run, with its results shown to the owner.
3. The full official run, then the final Results and the release record v0.2.0.
