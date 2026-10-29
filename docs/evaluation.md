# Evaluation

This page describes how the three pipelines are compared: the hypotheses, the question bank, how one answer is scored, how scores become comparisons, and what a run records so it can be repeated.
The pipelines are in [retrieval.md](retrieval.md), the planted scenarios in [scenarios.md](scenarios.md), and the routes that publish results in [api.md](api.md).

Two generated pages sit beside this one and are never edited by hand:

- [evaluation/question-bank.md](evaluation/question-bank.md) lists every question of bank 2.0.0 with its instances, answer checks and claims for the presentation world.
- [evaluation/example-traces.md](evaluation/example-traces.md) shows the demo questions run side by side through A, B and C, with the stand-in generator.

## Status of results

The official run v0.2.0 is the one official result so far, and it stands as published.
It was made under method 0.2.0 and is labelled so wherever it is shown.
It ran from 2026-10-26 11:42 to 2026-10-27 03:21 UTC at commit 27a4ce4 with a clean tree, after the owner approved CP3, and is kept in `data/evaluation/runs/official-2026-10-26/` (not in git).
Three worlds (2026, 2027, 2028), the whole bank of 150 instances, three approaches and three repeats gave 1,350 answers, each judged; the answer model was `ollama/qwen3.6:latest` and the judge `ollama/gemma4:31b`, both with reasoning off, under the selection rule `reranker-graph-share` (D-081).

- None of the eight tested comparisons shows a detectable difference (Holm-adjusted Wilcoxon on group means).
- Over every question, the evidence score (F1) is 0.19 for A, 0.17 for B and 0.19 for C, and the answer score is 0.44 for all three.
- Descriptive, outside the family: on the 18 name-anchored instances B is 14.7 evidence points below A (interval 10.8 to 18.6 below) and C is 13.4 above B (8.4 to 18.6) with an answer score 10.4 points higher (3.6 to 18.6); over every ontology-dependent question C is 4.0 evidence points and 4.1 answer points above B.
- Failure causes per 450 answers: "the needed evidence was not retrieved" 216 (A), 213 (B), 201 (C); "the evidence was retrieved but the answer was wrong" 72, 60, 81; "the starting record was not found" 0, 9, 9.
- The judge's correctness agrees with the deterministic answer score (at least 0.5) on 53 percent of 1,348 judged answers, kappa 0.07: the two measures of a right answer disagree often, which limits how far either can be read alone.
  This is the agreement definition of method 0.2.0, which method 0.3 replaces (see below).
- No answer failed; 2 judge calls failed, both in B, with an Ollama server error while the machine slept.

Read with the selection diagnostic below, the result points at evidence selection: the graph reaches many of the facts, and the re-ranker and the 12 prompt slots keep most of them from the model.
It does not show that a graph or an ontology cannot help; it shows that, with this selection rule, this answer model and this bank, they did not measurably help.

### Method v0.3 (in preparation, not yet run)

Method v0.3 was written after seeing the v0.2.0 result, in which the graph did not win, and every report of v0.3.0 says so.
The reasons and the data are in [evaluation/v0.3-method-proposal.md](evaluation/v0.3-method-proposal.md), and the rules are the decision records D-083 to D-093.
The guards against fitting the method to the result:

- development runs on the presentation world, seed 2026, only, through the run kind `dev`, and its numbers are never reported as a result;
- every rule and value is written in a decision record before any official measurement;
- the official run uses six worlds no one has looked at, seeds 2029 to 2034, with the models of v0.2.0 and each question asked once (D-097), and starts from the command line after the owner agrees;
- no value is chosen by trying it on those seeds, a mechanical failure is resumed with the same settings, and a result of no difference is the result;
- v0.2.0 is not rewritten.
  Its rescoring under the new scorer is a labelled addendum beside the run (D-090).

What changed, in short:

| Area | v0.2.0 | v0.3.0 |
|---|---|---|
| Graph records | ordered by the shared re-ranker | ordered by the graph relevance rule (D-083) |
| Context | 12 items, graph share of 6 | one 2,000 token budget, no item limit, channels alternate (D-084) |
| Prompt | prose record blocks, prompt 2.0.0 | compact facts, path line for graph records, prompt 3.0.0 (D-085) |
| Scorer, judge | scorer 2.0.0, judge prompt 1.0.0 | scorer 2.2.1 (D-086, D-095), judge prompt 1.2.0 (D-086, D-096) |
| Agreement | rate at the 0.5 threshold and Cohen's kappa | three levels, weighted kappa, answered and abstaining apart (D-086) |
| Tested evidence metric | F1 | recall; F1 and precision descriptive (D-087) |
| New measures | none | groundedness, descriptive (D-088) |
| Worlds | 2026, 2027, 2028 | 2029 to 2034 (D-091) |

C against A is reported with an interval and no test (D-087).
A change that is not tuned and is declared is not a guarantee: the guards limit what the change could have been fitted to and do not remove the doubt.

An incident during the build is recorded in D-091.
A test on old code generated world 2029 into a temporary directory and ran the real graph ingest against the local Neo4j, which failed and left the graph at 36,853 nodes and 129,103 relationships.
The test's own attempt to restore seed 2026 also failed.
The owner approved restoring it with `make ingest-graph`, which gave 36,888 nodes and 130,112 relationships, and ruled that seed 2029 stays in the official set, because nothing was tuned on it or read from it.
A socket-level service guard in the test configuration now stops any test from opening a connection to Neo4j, Qdrant or a model.

### Development evidence

Evidence from before the official run is development evidence:

- four recorded live runs in the Live Lab (one question each from H1, H2, H3 and H5, one model, one repeat), which showed B and C no better than A;
- the selection rule changed on 2026-10-25, after the CP3 proposal and after pilot runs and a diagnostic in which B and C did no better than A: half of the 12 evidence slots then went to the graph's own selection (D-081, replaced in method v0.3 by D-083 and D-084, see [retrieval.md](retrieval.md)), and the development pilot runs below used the older rule (D-025);
- on the multi-hop question, the shared re-ranker kept the graph's claim record out of the prompt (decision D-025), which led to the change of rule above (see [retrieval.md](retrieval.md));
  the v0.2.0 data then showed that the 12 slots bound in all 1,350 prompts and the token budget in none, which led to method v0.3;
- the selection diagnostic of 2026-10-25 found that the graph finds 55 (B) and 88 (C) of the 122 claims of seed 2026, but only 38 and 39 reach the prompt, against 43 for A, because the 12 prompt slots cut them (rule D-025, `data/evaluation/diagnostics/20261025T180223Z-selection/`); the options and the recommendation are in [the official run proposal](evaluation/official-run-proposal.md);
- the same diagnostic, run once after the change to D-081 (`data/evaluation/diagnostics/20261025T200934Z-selection/`), found 41 (B) and 43 (C) claims in the prompt, against 43 for A, with 23 and 51 of the graph's claims still left out, because within the graph's six slots the re-ranker prefers other graph records; the graph found the same 55 and 88 claims in both runs;
- local pilot and smoke runs of the harness (two subset runs with a local model and one scorer smoke test, kept under `data/`, which is not committed).
  The API lists them with their label, "subset run" or "scorer smoke test", and none is an official result.

## Purpose

The benchmark measures the incremental value of two layers: the graph (B against A) and the ontology (C against B).
It reports each metric on its own, with no composite score, and it states what it cannot say.

### Hypotheses

| Id | Hypothesis | How it is measured |
|---|---|---|
| H1 | Graph retrieval improves evidence recall as relationship depth increases | Multi-hop questions (stratum H1), and the depth sweep from 0 to 3 for B and C |
| H2 | The ontology improves cross-market concept matching beyond graph structure alone | Ontology-dependent questions (stratum H2), C against B |
| H3 | Single facts show little or no advantage from the graph | Single-fact questions (stratum H3), answer score |
| H4 | The graph improves provenance and explainability | Citation accuracy and the numeric citation rate. Path explainability has no metric. |
| H5 | The graph improves discovery of planted multi-entity patterns | Planted-pattern questions (stratum H5) |
| H6 | The graph may increase latency but improve quality and context efficiency | Latency, context tokens and evidence per 1,000 tokens, reported as their own metrics |
| H7 | A smaller local model with richer context may approach a larger model | `compare`: two official runs with different generation models |

All hypotheses are measured and not assumed.
H4, H6 and H7 are metrics or run kinds over the questions and have no stratum of their own.

### What would count as success

From the product's success criteria: the three configurations run over the same world, results are reproducible, every graph traversal on screen is backed by recorded events, evidence is inspectable, and graph and ontology value are measured separately.
The owner's thesis is that graphs and ontologies add value to questioning, and the product's job is to find out and show the answer either way.

## Architecture

### The question bank

Bank 2.0.0 (`BANK_VERSION`, in `backend/app/evaluation/bank.py`) has 22 logical questions.
A logical question is written once in plain English with one slot for its anchor: a record id, or for two questions a local-language name.
Grounding fills the slot for a given world.

| Stratum | Questions | What they test |
|---|---|---|
| H3 single facts | L01 to L04 | One price, one link, one date, one flag, each read from one record |
| H1 multi-hop | L05 to L08 | Two or more relationships: other markets with incidents on the same platform version, mechanics of games affected by an incident, the platform version behind a support case's incident, games affected on a platform version |
| H2 ontology-dependent, id-anchored | L09 to L12 | Equivalence across markets: games of the same kind of family, incidents of the same kind, segments that correspond, games with the same kind of main mechanic |
| H2 ontology-dependent, name-anchored (`H2_name`) | L13, L14 | A local-language family or mechanic name resolved to a concept |
| H5 planted patterns | L15 to L22 | One question for each of SCN-001, 002, 003, 007, 009, 010, 011 and 015 |

Each structural question is grounded to up to three anchors per world.
Each planted question is grounded to one instance, read from the truth ledger.
The seed 2026 world's frozen bank has 50 instances: 14 structural questions at three anchors, and 8 planted questions at one.
The official run v0.2.0 used three worlds, seeds 2026, 2027 and 2028, which gave 150 instances.
The official run of method v0.3 uses the six unseen worlds, seeds 2029 to 2034 (D-091), so it has at most 300 instances; each of their banks is grounded when that run first prepares the world.
The full text, checks and claims of the seed 2026 instances are in [evaluation/question-bank.md](evaluation/question-bank.md).

Every question carries its plain-English text, what it tests in one sentence, its stratum, its scenario or base fact, an `ontology_dependent` flag, an expected answer and the claims a correct answer makes.
Every published question maps to a planted scenario or to a base fact of the world.
The bank has no "not planted" questions.

### Grounding and freezing

`python -m app.evaluation ground` (`make ground-bank`) grounds the bank into one world and writes `data/evaluation/bank/bank-2.0.0-scorer-2.2.1-<dataset directory name>.json`.
The file name carries the scorer the bank is grounded for, so a bank for a new scorer is a new file, and grounding never replaces a bank file that holds another bank, because runs were made with it (D-095).
The v0.2.0 bank files, `bank-2.0.0-<dataset directory name>.json`, stay as they were and still load.
Anchors are chosen in a stable hash order (sha256 of `bank version:question id:anchor`), among anchors inside fixed eligibility bounds: an answer set of 1 to 6 members once the anchor is excluded, with bounds of their own for L06, L11, L13 and L14 (D-030).
The file is frozen with its hash, the world manifest hash, the ledger hash and the record serialiser version.
A run refuses a bank that is missing, fails its own hash, or names another bank version, world, ledger or serialiser.
Retrieval code never sees the bank, the claims or the checks.

L13 and L14 anchors are one per concept, spread across languages.
L14 has exactly three qualifying concepts in seed 2026, so it has no margin, and a world with fewer would give it fewer instances.

### Claims and carriers

A claim is one plain sentence a correct answer states, plus its carriers.
A carrier is a source item that states the fact: a structured record id, or the id of any document chunk whose text states it.
For example, the multi-hop claim "Incident INC_024 in MKT_CZ was seen on platform version PLV_IDENTITY_2." is carried by the incident's record and by any chunk that says so.
The evidence metric credits a pipeline for whichever source it found.

Carriers are computed once at grounding time from the world's record blocks and chunks, and frozen with the bank.
Planted claims and expected answers come from the ledger only.

### The anchor is excluded

A structural question names its anchor, so the pipeline is given the id and finding it is no discovery.
The anchor is removed from every claim's carriers and from the pipeline's selected evidence before the evidence metrics are computed.
A claim left with no carrier is dropped.
When no claim survives, the instance's evidence metrics are undefined and not zero, and the instance counts toward the answer metrics only.

L01 and L04 are scored on the answer only, because the only source of a game's price or digital flag is the game's own record, which is the anchor.
In the seed 2026 bank the same holds for every H3 instance, so single facts are compared on the answer.
H1 and H2 anchors that would leave no claim are not eligible, so every H1 and H2 instance has evidence to discover.
Whether the anchor was reached is reported separately as anchor resolution.
Pipeline A has no entity resolution stage, so for A that metric reads the selection alone, and the report labels it "selection only".

### Evidence metrics

The selected evidence is the list of carriers a pipeline placed in the prompt, in order, with duplicates and the anchor removed.
Every pipeline fills the same token budget with no item limit (method v0.3, D-084), so the metrics compare equal context, but the number of items that fit is not equal.
Under method 0.2.0 every pipeline also had the same 12 slots.

| Metric | Definition |
|---|---|
| Recall | The share of claims with at least one carrier selected. In method v0.3 this is the evidence metric of the tested family (D-087). |
| Precision | The share of selected items that carry at least one claim. An empty selection has precision 0. Descriptive in v0.3, because it depends on how many items fit. |
| F1 | The harmonic mean of recall and precision. The screens call it the evidence score for a v0.2.0 run, where it was the tested metric; descriptive in v0.3. |
| Efficiency | Claims found per 1,000 context tokens |

Retrieval must select the same carriers in every repeat of an instance, and only generation may vary.
The runner stops the run with an error if a repeat selects anything else.

### Answer checks

Each instance carries one or more checks written at grounding time from the expected answer.
The answer score is the mean of its checks, from 0 to 1.
Number, token and set checks read the verdict and the answer text together.

| Check | Rule |
|---|---|
| Verdict | 1 when the verdict opens with the expected "yes" or "no", else 0 |
| Token | 1 when the answer names the expected value or an alias as a whole word, ignoring case. Boundaries are Unicode-aware, so `INC_01` does not match inside `INC_010`. |
| Set | The F1 of the ids the answer names against the expected ids, over a fixed universe of candidates. An alias shared by more than one id identifies none. The anchor is excluded from every universe. |
| Number | 1 when the expected number is the only distinct number read, 0.5 when other numbers appear beside it, 0 when it is missing |

For a number check with a unit, only numbers standing next to that unit are read (`2.50 EUR`, `€2.50`).
Numbers are compared after normalisation, so `2.50` matches `2.5`.
A comma followed by exactly three digits is a thousands separator, and any other comma is a decimal point.
Citation markers, identifiers such as `INC_042` and dates are not numbers.
European grouping (`1.200,00 €`) and space grouping (`1 200`) are not parsed, and a number run together with its unit (`59Kč`) is not read.

Every expected answer scores 1.0 against its own checks, and a test asserts this for every frozen instance.
The checks are the scorer's answer key, so a frozen bank records the scorer it was grounded for, and a bank grounded for another scorer is stale; the bank for the current scorer goes into a file of its own (D-095).

Question-specific rules and open owner questions:

- Every check whose answer is a version also accepts the version's label when the answer also names what the version belongs to, its owner, anywhere in the text, and names no rival (scorer 2.2.1, D-095).
  For a platform version (L02, L07) the owner is the platform, by name or id, from the world's `platform_versions` and `platforms` tables, such as `2024.3.0` with `Payments Gateway`.
  For an app release (L15) it is the market, by English or local name or id, from `app_versions` and `markets`, such as `5.3.1` with `Greece`.
  A rival is any other platform or market that has a version of the same label: an answer that names one beside the label scores 0, because it ties the label to another owner or does not say which.
  A market is never a rival of a platform version, so "2024.3.0 ... the Web Portal platform in Greece" still counts.
  A correct answer that names any other platform beside the label (or, for L15, any other market) scores 0, accepted as conservative by controller ruling, for example "Web Portal 2024.3.0; the Payments Gateway was not involved".
  The grounder writes the label, the owner's names and the rivals into the check, and only where label and owner identify that one version in the world.
  A bare label scores 0, because every platform and every market has a version of each label, and a label inside a longer dotted number (`5.3.1` in `1.5.3.1`) is not the label.
  Only L02 was labelled (the `version_label` cell, D-089); the rule reaches L07 and L15 by the controller's ruling that the owner's decision is about version answers, not one question, with no labels behind it.
  For L15 the incident in the question fixes the market, so a correct answer usually names that market anyway, and the label in effect counts on its own unless another market is named.
- L18's set check leaves out the primary market and the market the answer should name as unaffected, so it measures recall only.
- L16 and L17 expect every other player linked to the anchor's shared devices or payment instruments in the world data, so the expected sets include baseline players and not only the planted cluster (D-030).
  This is an open owner question.
- L22's expected answer states only the authoritative price, so an answer that also quotes the stale price from the superseded document scores 0.5.
  This is an open owner question.

### Citation metrics

Answers cite context blocks as `[n]` or `[n, m]`.

- Citation accuracy is the share of cited blocks whose carrier carries one of the instance's claims.
  A citation of a block that was not shown counts as inaccurate.
  It is undefined when the answer cites nothing or the instance has no claim.
- The numeric citation rate is the share of the answer's sentences that state a number and also carry a citation.

### Groundedness

Groundedness (D-088) is a deterministic measure that uses no model and no answer key.
It checks the ids, numbers and dates an answer states against the blocks the model was shown, so it measures support, not correctness.
It is descriptive and outside the tested family, and the report and the Results screen say that no test is run.

- A checkable atom is an identifier (case-sensitive, so "inc_024" is not one), a number as the scorer reads numbers, or a date, outside citation markers and outside the question's own text.
  An ISO date with or without a time is read as its date, and a textual date is read through a month table, so "7 October 2025" and "2025-10-07" are one atom.
- For each sentence, an atom is supported when a block the sentence cites holds it, and unsupported when no block the model was shown holds it.
  An atom held only by a shown block the sentence does not cite is neither.
  A sentence without a citation inherits none.
- The supported share is supported atoms over all atoms, and the unsupported share, the hallucination signal, is unsupported atoms over all atoms.
- An answer with no atom has no shares, is left out of the means and is counted as abstained when its verdict is an abstention.
  An abstention is never counted as fully grounded.

What it does not do, and what a reader should know:

- Claims are counted per sentence, so an atom stated in two sentences weighs twice.
- Atoms in the verdict are not counted.
- A sentence is split after an abbreviated month, so "Oct. 7th, 2025" is not read as one date.
  The prompt asks for ISO dates, so this is rare.
- A wrong claim in plain words is invisible to it.
- With zero shown blocks every atom is unsupported.
  The measure is absent, not zero, when blocks exist and every block text is empty, which is how Live Lab scoring (no stored block text) is told apart.
  "Not stored" is inferred from empty texts.
- Ids in a record's heading and in a path line count as shown support (F18), so a B or C answer can be supported by an id that only a path line holds.
- Since the judge view was ruled in Task 11 (F12-R), groundedness reads the full rendered block, document titles included, while the judge and the labelling sheet read it without the document title line.
- For the v0.2.0 addendum it reads the stored block text, which has no title, no facts format and no path line, so a v0.2.0 figure and a v0.3.0 figure are not comparable.

It is recorded per answer, summarised by stratum and approach with its n (the answers with at least one atom), and shown on the Results screen.
In the addendum, each groundedness line says over how many repeats its means are taken, "over the 69 of 108 repeats whose answer states an id, date or number not in the question": the first number is the answers with atoms, the second every repeat groundedness was computed for.

### Failure class

A repeat is weak when its answer score or its evidence recall is below 0.5.
A weak repeat gets one class from its scores and telemetry alone:

- `entity_resolution_failure`: B or C did not resolve the anchor.
- `retrieval_failure`: evidence recall is below 0.5.
- `generation_failure`: the evidence was found and the answer is still weak.

The archived taxonomy listed ten classes.
Three are built.
A repeat whose generation call failed has no score and no class, and is left out of every metric.
Its record keeps the gateway's message.

### The judge

A judge model scores every successful repeat on five dimensions, each 0 (wrong or absent), 1 (partly) or 2 (fully): correctness, completeness, faithfulness to the shown context, citation accuracy and appropriate abstention.
The judge is a second opinion and never replaces a deterministic score (D-031).

- It sees the question, the expected answer, the claim statements, the text of each block the generator was shown, and the whole answer (judge prompt 1.2.0, D-096; 1.1.0 and earlier read the first 2,400 characters).
  The answer is bounded by the answer model's output limit, 4,096 tokens by default, so with a context of at most 2,000 tokens, about 400 tokens of instructions and question and a 300-token reply, a judge call needs about 7,000 tokens, well inside the 32,768-token context the local Ollama server runs gemma4 31B with; no cap is needed.
  The blocks come without titles or ids, in an order shuffled by a hash of the instance, pipeline and repeat, and renumbered from 1.
  Citation markers are rewritten to the new numbers, and any other bracket holding a digit becomes `[?]`.
- No word of the prompt names a pipeline or how the context was retrieved.
- It must be of another model family than the generator in an official run, and the run refuses to start otherwise.
- A judge failure is recorded with its reason and has no scores.
  It is never scored as zero.
- The prompt version is 1.2.0 (D-096), and `judge_prompt_hash` covers the system prompt, its version and the user-message template.
  The change from 1.1.0: the whole answer is shown; the prompt text is unchanged.
  The change from 1.0.0 to 1.1.0 (D-086): correctness is 0 when the answer says the sources do not answer and the reference answer gives an answer.
  The hand-label agreement (D-094) validated judge 1.0.0 with the 1.1.0 abstention rule on answers of at most 1,200 tokens; the full-answer view of 1.2.0 is not separately validated by labels.
  The abstention dimension is unchanged.

What the judge sees of a block (D-085): the rendered prompt block less a document chunk's title line.
A record reads the same in A, B and C: its heading with its source, then its facts.
Two tells remain and are declared, because they are graph information A cannot have:

- the "reached from" path line at the end of a graph record the walk reached, which only B and C show;
- a graph node without a record block, which only B and C can select: it shows exactly `<Label> <id>`, and in C a concept node also shows its ontology text.

The judge is secondary to the deterministic scores (D-031), so the limitation is declared rather than removed.
Blinding is therefore not complete.
Judge scores for v0.2.0 were made with prompt 1.0.0 and the old block rendering.

#### Judge agreement

Agreement compares the deterministic answer score on three levels with the judge's correctness:

| Answer score | Level | Judge correctness |
|---|---|---|
| 0 | 0 | 0 |
| above 0 and below 1 | 1 | 1 |
| exactly 1 | 2 | 2 |

The report gives exact agreement and linear weighted kappa, separately for answered and abstaining answers, for all answers and for each pipeline.
An answer is an abstention when its verdict, trimmed, starts with the word "unknown".
Exact agreement is always shown with its n.
Weighted kappa is shown only when n is at least 10, and otherwise reads "too few to say" (the owner's rule of 2026-10-27, D-086).
The rule holds in the Results screen, the benchmark report, the addendum and the label-agreement output.
The 0.5 threshold and the boolean agreement of method 0.2.0 are gone from the code; a v0.2.0 summary keeps its recorded agreement and Cohen's kappa, and the same n rule is applied when it is shown.

### The hand-labelled sample

A sample of 100 judged v0.2.0 answers is labelled by hand to confirm the scorer and judge fixes (D-089).
It is built from the stored run and writes nothing under the runs directory.

```bash
make label-sample       # writes data/evaluation/labels/v0.2.0-sample/ (no Neo4j, no model)
make label-agreement    # reports how far each measure agrees with the labels
```

- Five cells: 25 abstentions the judge marked correct, 15 L03 answers below 1, 10 L02 answers below 0.5 that the judge marked 2, 25 partial set answers, and 25 answers where the measures agree.
  A repeat goes to the first cell it fits, in the order of a hash of a fixed salt, the instance, the pipeline and the repeat.
- `sheet.md` shows the question, reference answer, key facts, the blocks as the judge saw them (shuffled, renumbered, no titles) and the blinded answer.
  It never shows the approach, the cell or a recorded score; those are in `key.json`, which labellers do not open before labelling.
- Either the owner and the controller fill `labels-owner.csv` and `labels-controller.csv` independently, or one of them fills its file and the other is left untouched.
  With two labellers, disagreements are settled in `labels-consensus.csv`.
  The analysis refuses a partly filled file, an unsettled disagreement, and a sample with no filled file.
  The agreement report names only who labelled, and says plainly when there was one labeller.
- The v0.2.0 sample was labelled by the controller only, a model labeller, by owner decision of 2026-10-28 (D-094).
  No human labelled it, so the report holds no labeller-to-labeller agreement.
- It reports the agreement of the scorer as recorded, the current scorer (2.2.1) rescored, the judge as recorded and the judge with the 1.1.0 abstention rule applied mechanically, with the consensus label, overall, per cell and per approach.
  A rule changes only where the labels show it wrong on at least 80 percent of its cell, and a cell of fewer than 10 items is never flagged.
  Weighted kappa follows the n rule above.
- The labels are not committed, and no pipeline can read them.
- **Declared tell (T6-L1).**
  About 22 of the 100 items show a graph-only block that hints at B or C: a business concept block, a bare node such as `Player PLAYER_GR_000016`, or a record type A never retrieved.
  The sheet keeps the blocks unaltered, since it shows what was shown, and both labellers see the same sheet.
  The per-approach agreement shows whether a labeller's guess of the approach moved the labels.

### The v0.2.0 addendum

```bash
make addendum-v020      # no Neo4j, no model
```

It rescores the stored answers of v0.2.0 with the current scorer, 2.2.1, and adds groundedness and the three-level agreement, recorded against rescored, and writes `addendum.json` and `addendum.md` into `data/evaluation/addenda/official-2026-10-26-scorer-2.2.1/`, never inside the run (D-090).
Because a scorer rule can live in the checks (D-095), it grounds each world of the run again in memory and scores with the checks grounded now.
It refuses when an instance of the run is grounded differently in anything but its checks, or when a check grounded now differs from the recorded one in anything but its qualified aliases, and it writes no bank file.
The label agreement rescores the same way.
Evidence scores, citations, the failure class and the judge's scores stay as recorded, so the recorded failure class can go stale.
The header says that no model was called and that the original record is unchanged.
It runs no test and states no p-value.
The first addendum, written with scorer 2.1.0 on 2026-10-27 into `official-2026-10-26-scorer-2.1.0/`, changed only the H3 answer scores: A 0.722 to 0.944, B 0.667 to 0.917 and C 0.611 to 0.861.
The second, written with scorer 2.2.0 on 2026-10-28 into `official-2026-10-26-scorer-2.2.0/`, moved only C's H3 answer score, to 0.889; A stayed at 0.944 and B at 0.917.

### Statistics

The code is `backend/app/evaluation/statistics.py`, and `report.py` is the only place a benchmark number is computed.
The API and the frontend show `summary.json` and never recompute a score.

- **The observation** is one bank instance in one world.
  Its value for a metric is the mean over its repeats where the metric is defined.
- **Pairing.** B is compared with A (Graph against text search) and C with B (Graph + Ontology against Graph).
  A pair is one instance where both pipelines have a value, and its difference is the first minus the second.
  Pairs are formed for the evidence metric and `answer` in every stratum except `overall`.
  The evidence metric is `evidence_recall` in method v0.3 and `evidence_f1` in method 0.2.0 (D-087).
  C against A is computed for every cell as well, with an interval and no test, and is reported as descriptive.
- **Clustering.** Instances of one logical question in one world share an anchor type and a template, so they are not independent.
  Pairs are grouped into clusters keyed `question_id:world_seed`, and the cluster is the unit for both the interval and the test (D-032).
- **Interval.** A paired bootstrap over clusters, with 10,000 resamples and a fixed seed of 2026, gives a 95 percent interval of the mean difference.
  Differences are shown in points, where one point is 0.01 on the 0 to 1 scale.
- **Test.** A two-sided Wilcoxon signed-rank test (Pratt's treatment of zero differences) on the per-cluster mean differences.
- **Correction.** Holm's step-down correction across the declared family.
  The family is the evidence metric on H1, H2 (id-anchored) and H5, and answer on H1, H2, H3 and H5, each for B against A and C against B, so at most 14 tests.
  C against A is outside the family.
  `H2_name` is reported as a sub-group with an interval and no test.
- **Too few pairs.** A cell is tested only with at least 10 pairs and at least 6 clusters.
  Six is the fewest at which a two-sided signed-rank test can reach p < 0.05.
  Twelve pairs in four clusters make no claim.
- **Headlines.** The harness writes one sentence per tested cell on that stratum's main metric: the evidence metric for H1, H2 and H5, answer for H3.
  There is no headline for C against A.
  A difference is significant when its Holm-adjusted p-value is below 0.05.
  The four forms, with example numbers, are:
  - "Graph exceeds text search by 25.0 evidence points (95 percent interval 23.0 to 27.0, 36 pairs in 12 groups) on multi-hop questions."
  - the same with "trails", when significant and the whole interval is below zero;
  - "No detectable difference between Graph and text search on single facts (36 pairs in 12 groups)."
  - "Too few pairs to say for Graph and text search on planted patterns (8 pairs in 8 groups)."

The arithmetic of the design: per world the bank gives 12 H1 instances, 18 H2 (12 id-anchored and 6 name-anchored), 12 H3 and 8 H5, so the six worlds of the v0.3 official run give at most 72, 72, 72 and 48 pairs for the H1, H2 (id-anchored), H3 and H5 headline cells.
The three worlds of the official run v0.2.0 gave at most 36, 36, 36 and 24.
H3 has no evidence pairs by design.

The `ontology_split` in `summary.json` compares B with A and C with B on the ontology-dependent instances (from the per-instance flag, across every stratum) and on all others.
It is descriptive: outside the Holm family, with no p-value and no headline.

The intervals are on differences.
The Overview tiles show each approach's mean evidence score with the number of questions and runs behind it, and no interval of their own (D-048, which is an open owner question).
The tile is worded "Evidence score, questions with claims" for v0.2.0 and "Evidence recall, questions with claims" for v0.3.0, each with its n, the number of questions with claims behind the mean (114 for v0.2.0) (D-087).

A smoke run keeps every statistic but its only headline says it is a scorer smoke test and not a result.
A dev run does the same: its only headline says it is a development run on seed 2026 and not a result, and its comparisons table says "tested (development run, not a result)".

### Run kinds

| Kind | Command | What it does |
|---|---|---|
| smoke | `make run-smoke` | Scores the three seen worlds with the stand-in generator and judge. It tests the scoring code, and its numbers are not results. |
| dev | `make dev-run` | A development run on seed 2026 only, with the real generator and the gateway judge. It is labelled "development run on seed 2026, not a result" and is never reported as a result of v0.3.0. |
| official | `make run-benchmark` | The full bank on the six unseen worlds, seeds 2029 to 2034, each question asked once (D-097), a hosted or local generation model, and a judge of another family. A part of the bank on seed 2026, as the dry run, is also an official run and is labelled a subset run. |
| sweep | `make run-sweep` | The H1 questions with B and C at graph depth 0, 1, 2 and 3. Reports intervals, runs no test. |
| compare | `python -m app.evaluation compare SMALL_RUN LARGE_RUN` | H7: large minus small per pipeline, stratum and metric, as clustered intervals. Needs two official runs with the same frozen banks and the same settings except the generation model (see Kept worlds and resume). |

Every run uses graph depth 2 except the sweep.
An official run uses the dev profile on its world seeds in turn, with the scenario seed equal to the world seed.
The unseen seeds are guarded in code (D-091):
a full-bank official run must use exactly the six seeds 2029 to 2034;
every other run (smoke, sweep, dev, and an official run over part of the bank such as the dry run) refuses any seed from 2029;
a dev run refuses any seed but 2026;
and the API accepts only the seen seeds, so the official run starts from the command line after the owner agrees, and the Results start panel defaults to a development run on seed 2026.
No development, diagnostic or labelling step may use an unseen world.
A run with `--strata`, `--questions` or `--limit` is labelled a subset run and is never published as the official result.
`--questions` names logical questions of the bank, and an id the bank does not define is refused before any world is prepared.
The dry run is `make dry-run`: the first bank instance of each of the strata H1, H2, H3 and H5, chosen as `GET /api/v1/demo/questions` chooses them, on world 2026 with the official settings, each question asked once.
`python -m app.evaluation dry-run-questions` prints those question ids by reading the frozen bank file, so a bank change cannot leave them stale.

## Operation

```bash
make ground-bank        # freeze the bank into the active world (seed 2026)
make run-smoke          # needs the services, no model
make dev-run            # development run on seed 2026, not a result; wipes and restores Neo4j, calls the models; owner go-ahead first
make dry-run            # four questions on world 2026, each asked once; the official settings, so owner approval first
make run-benchmark      # six unseen worlds; needs GENERATION_PROVIDER=litellm and JUDGE_PROVIDER=litellm; owner agreement first
make run-sweep
make addendum-v020      # rescore v0.2.0, no Neo4j, no model
make label-sample label-agreement   # the hand-labelled sample, no Neo4j, no model
```

Direct form, from `backend/`:

```bash
uv run python -m app.evaluation run --kind smoke|dev|official [--seeds ...] [--repeats N] [--strata H1,H3] [--questions L01,L05] [--limit N] [--out DIR] [--resume]
uv run python -m app.evaluation dry-run-questions
uv run python -m app.evaluation sweep [--seeds ...] [--depths 0,1,2,3] [--repeats N] [--limit N] [--out DIR]
uv run python -m app.evaluation compare SMALL_RUN_DIR LARGE_RUN_DIR [--out DIR]
uv run python -m app.evaluation bank-doc --bank FILE --out FILE
```

Before any world is prepared, the run checks its kind, its repeats and the generator and judge settings, so a wrong setting fails in seconds.
`--seeds` defaults by kind: 2029 to 2034 for official, 2026 for dev and 2026, 2027 and 2028 for smoke and sweep.
`--repeats` defaults to 1 for every kind (D-097).
An official run refuses fewer repeats than `OFFICIAL_MIN_REPEATS` in `backend/app/evaluation/runner.py`, which is 1 since D-097 and was 3 through v0.2.0.
`make run-benchmark REPEATS=N` and `make dry-run REPEATS=N` ask each question N times.
Direct forms of the other commands: `addendum --run DIR [--out DIR]`, `label-sample --run DIR [--out DIR]` and `label-agreement --run DIR [--sample DIR]`.
A sweep or official run refuses the stand-in generator and needs a gateway judge.

### What the shared re-ranker keeps

`make diagnose-selection` measured D-025 with no answer model; its recorded numbers are for the old slot rules (D-025, D-081).
Under method v0.3 (D-083, D-084) it reports the same counts under the graph-rank interleave rule, with one token budget and no item limit.
The embedding model and the re-ranking model still run, because they are part of what it measures.
For every seed 2026 instance that has claims, it runs retrieval for A, B and C and stops where the answer model would start.
The lab is given a generator that refuses, and every candidate and selection event is emitted before a pipeline calls it.
It counts claims with the scorer's carrier notion, after the anchor is removed.
For each stratum and approach it reports the claims to find, the claims found among the graph candidates (B and C), among the document candidates, and among the records that reached the prompt.
Graph candidates are the seeds and the nodes the traversal discovered, less nodes of an excluded label, which the graph never orders.
Document candidates are A's retrieved chunks, and for B and C the chunks they selected or discarded.
C's document search uses the expanded question, as C does in a run.
It also lists every claim the graph found and no selected record states.
For each such claim it gives the discard reason, the record's tier (seed, target or other) and graph rank, and how many records reached the prompt, so a drop because the budget was full can be told from a record the graph ranked low.
Only documents carry a re-ranker score, so the diagnostic shows none for graph records.
It refuses unless the presentation world is the dev world, the vector collection exists, holds the whole corpus and was built by the bank's record serialiser, and the live graph's label counts equal that world's `_graph_stats.json`.
It builds with the official run's settings (graph depth 2) and writes them into the output.
It only reads the graph, with read-access sessions, and it writes `selection.json` and `selection.md` to `data/evaluation/diagnostics/<UTC>-selection/`.

### Kept worlds and resume

A run writes each finished world to `worlds/<seed>.json` inside its run directory.
These files stay after a successful run as part of its record.
If a run fails or is cancelled in a later world, the earlier worlds are already on disk, and nothing is published, because the API publishes only a directory that holds `summary.json`.
The failed run is continued with the same command and `--out DIR --resume`, or `make run-benchmark OUT=DIR RESUME=1`.
`--resume` needs `--out`, and it skips the worlds already kept.
The API never resumes a run; a failed job says how many worlds were kept and names this command.

Resume refuses to mix worlds made under different settings.
Before any world is prepared, it checks each kept world against this run and against the other kept worlds:

- the run kind and the selection of the bank (`--strata`, `--questions`, `--limit`);
- every setting the environment, the configuration, the code and git fix: the repeats, the generation and judge settings, the retrieval and graph limits, the ranking weights, the prompt, the scorer and ontology versions, and the code revision (`git_sha`);
- the frozen bank of that seed, which must be the one the world was scored on;
- the kept worlds among themselves.

The names of the embedding, sparse and re-ranking models need a built lab, so they are checked after the next world is prepared and before it is scored.
Only when the run started, where its world directory is and, for a smoke run, whether the checkout was dirty may differ.
A run of another method is refused before any of that, with a message naming both method versions (D-092).
An official run resumes only from a clean checkout at the same revision, now and in every kept world, because an uncommitted edit would mix two code versions without leaving a trace in the record.
For the same reason a fresh official run, the dry run included, starts only when git reports a clean checkout, and a checkout git cannot read counts as unclean; smoke, sweep and dev runs record `git_dirty` only.
Any code change therefore means a new run, not a resume.
A directory that already holds `summary.json` or `results.json` is never resumed, a directory that holds kept worlds is refused unless `--resume` is given, and `--resume` on a directory that does not exist is refused.
A kept file that cannot be read is named in the refusal, and deleting it reruns that world.

A relative `--out` is relative to the repository root, so the same command works from the root and from `backend/`.
A cancelled API job keeps its finished worlds in the same way, and its message names the resume command too.

`compare` applies the same rule to two runs.
It refuses two runs of different methods first, naming both, and takes the evidence metric of the runs' method (F1 for 0.2.0, recall for 0.3.0).
It then refuses runs whose recorded settings differ in anything except the generation model, its family and quantisation, the code revision and where the run happened, and it names every field that differs with both values.
The worlds are paired by seed, and the output says when the two runs were made at different code revisions.

Each world is brought up to date before it is scored:

| Step | When it runs |
|---|---|
| Generate the world | The world or its ledger is missing, or its manifest names another generator version or seed |
| Ingest the graph | Every time, because Neo4j holds one world at a time |
| Index the vectors | The world was just generated, the collection is empty, or the index names another serialiser version or collection |
| Ground and freeze the bank | The bank is missing, fails its hash, or names another bank version, world, ledger or serialiser |

Every seed other than 2026, the seen 2027 and 2028 and the unseen 2029 to 2034, uses the collection name plus `_seed<seed>`.
After the last world, and after a failed world, the seed 2026 graph is ingested again so the Live Lab and Data Model read the world they expect.
When that restore fails, run `make ingest-graph`.

The benchmark can also be started from the Results screen, as a job on a background thread of the API (one at a time).
It refuses to run unless the active world is the dev world with its own ledger.

Local thinking models need `GENERATION_REASONING=off` and `JUDGE_REASONING=off`.
The first local pilot ran with `default`, and both models spent their token caps on hidden reasoning, returning empty answers for 159 of 198 generations and every judge call.

## Reproducibility

A run is written to `data/evaluation/runs/<run id>/`, where the run id is the UTC start time and the kind, such as `20261019T140507Z-official`.
A run refuses a directory that already holds a run.
Files are written to a temporary name and moved into place, and `summary.json` is written last.

| File | Contents |
|---|---|
| `results.json` | The selection, the record, and for each world every instance, every repeat of every pipeline (answer, shown blocks, selected carriers, resolved ids, tokens, latency) and every score |
| `summary.json` | The published numbers: metrics per stratum, comparisons, headlines, judge agreement, failures, the selection and the record. Schema version 3 for method v0.3 (evidence recall, groundedness, answered and abstaining agreement with weighted kappa, C against A), schema version 2 for v0.2.0. A v0.3 summary carries `method_note`, the fixed declaration that the method was made after seeing v0.2.0 (D-093), which also heads every v0.3 `report.md`. |
| `report.md` | The summary as tables |
| `sweep.json` | Per depth, the H1 metrics for B and C |
| `comparison.json` | H7, written to `data/evaluation/comparisons/` |

The API publishes `summary.json` only, of schema 2 or 3, so v0.2.0 stays listed beside v0.3 runs.
`GET /api/v1/benchmarks/latest` serves the newest official run of the whole bank, and when there is none it serves the newest run of any kind with its label.
While only a smoke run or a subset run exists, the Overview shows "No official run yet" and names the newest run's kind without numbers.

The reproducibility record of every run, stored as `run` (fields every world shares) and `worlds` (each world's full record), holds:

- **Code and bank:** `git_sha`, `git_dirty`, `question_bank_version`, `bank_version`, `bank_hash`, `scorer_version` (2.2.1 in v0.3, 2.0.0 in v0.2.0), `run_kind`, `repeats`, `started_at`.
- **Method:** `method_version` (0.3.0; a record written before the field existed is read as 0.2.0), `record_facts_version`, `prompt_extras` (the path line and the target-type tier for B and C, the ontology target terms for C).
- **World:** `world_dir`, `generator_version`, `profile`, `world_seed`, `scenario_seed`, `reference_date`, `ontology_version`, `graph_label_version`.
- **Retrieval:** `embedding_model`, `embedding_dimensions`, `sparse_model`, `rrf_k`, `record_serialiser_version`, `reranker`, `top_k`, `context_budget_tokens`, `context` (the dedupe threshold; v0.2.0 also held its slot counts), `dedupe_threshold`, `graph_limits`, `relationship_types_b`, `relationship_types_c`, `ranking_weights`, `excluded_labels`.
- **Generation:** `generation_model`, `generation_model_family`, `generation_quantisation`, `generation_temperature`, `max_tokens` (4096 from D-096, 1200 in v0.2.0), `generation_reasoning`, `prompt_version`, `prompt_hash`, `answer_parser_version` (2.0.0 from D-096; a record without it was read by parser 1.0.0).
- **Judge:** `judge_model`, `judge_model_family`, `judge_reasoning`, `judge_temperature`, `judge_prompt_version`, `judge_prompt_hash`.

Each repeat also records its own repeat index.
The runner writes one structured log record per repeat with the world seed, bank hash, instance, question, pipeline, repeat, latency and failure fields.
The records never carry an expected answer, the generated answer or a secret.

What is deterministic: generation of a world, grounding, retrieval, scoring and the statistics, for the same code, seeds, models and indices.
Generation and judging with a real model can vary between repeats even at temperature 0.
The official run v0.2.0 asked every question three times, and the answers did not vary: in all 450 sets of three (150 instances by three approaches) the three answers were word for word the same.
The judge did vary a little: its scores for the same answer differed within 94 of those 450 sets.
Since D-097 an official run asks each question once.
`--repeats N` asks each question N times and reports their mean, which shows any variance a new model or setting brings.

## Configuration

| Variable | Meaning |
|---|---|
| `GENERATION_*` | The answer model (see [retrieval.md](retrieval.md)). An official run needs `GENERATION_MODEL_FAMILY`. |
| `JUDGE_PROVIDER` | `fake` or `litellm`. Smoke runs always use the fake judge. |
| `JUDGE_MODEL`, `JUDGE_MODEL_FAMILY`, `JUDGE_API_BASE`, `JUDGE_TEMPERATURE`, `JUDGE_REASONING` | The judge. Its family must differ from the generator's in an official run. |
| `BENCHMARK_DIR` | Where the API looks for runs. Default `data/evaluation/runs`. |
| `DATASET_DIR`, `TRUTH_LEDGER_PATH` | The presentation world and its ledger. The ledger is read only inside `app.evaluation`. |
| `OPENROUTER_API_KEY` | Read by LiteLLM for hosted models |

The judge reply is capped at 300 tokens, so a thinking judge needs `JUDGE_REASONING=off`.
The Python code reads no `.env` file; the Makefile exports a root `.env` to the benchmark targets.

## Testing

- `test_benchmark_bank.py`, `test_benchmark_grounding.py`, `test_claims.py`: the bank, grounding, carriers and anchor exclusion.
- `test_checks.py`, `test_benchmark_scoring.py`: answer checks (including the date rule), groundedness, citation metrics, evidence metrics and failure classes.
- `test_judge.py`: blinding, parsing, the family rule, the pinned prompt hash, the three-level agreement and weighted kappa.
- `test_addendum.py`, `test_labelling.py`: the addendum (and that it never writes into a run) and the labelling sample, its agreement analysis and the n rule.
- `test_statistics.py`, `test_benchmark_report.py`: bootstrap, Wilcoxon, Holm, headlines and the summary.
- `test_diagnostics.py`: the selection diagnostic, its refusals and its output.
- `test_benchmark_runner.py`, `test_official.py`: repeats, refusals, the seed guards of D-091, world orchestration, sweep and compare, and the method refusals of D-092.
- `test_service_guard.py`: that no test can open a connection to Neo4j, Qdrant or a model (the guard is installed in `backend/tests/conftest.py`).
- `test_truth_ledger_isolation.py`: that retrieval code never reaches the ledger, the bank or the labels.
- `test_benchmark_live.py` (`LIVE_WORLD_E2E=1`): the live benchmark on the presentation world.

CI never needs a live model.
It uses the stand-in generator, the hashing embedder and the lexical judge.

## Extension points

- A new question: add it to `bank.py` with a grounder in `grounders.py`, or `planted.py` for a planted question, then re-ground every world and bump `BANK_VERSION`.
- A new metric: compute it in `report.py` beside the others, so the one place that computes numbers stays one place.
- A new hypothesis stratum needs the Holm family declared again, which changes the correction for every other cell.
- A new judge dimension changes the judge prompt version and hash.
- A new scorer rule bumps `SCORER_VERSION`, which makes every frozen bank stale, so each is grounded again; a rule that depends on world data goes into the checks the grounder writes (D-095).
  A rescoring of an earlier run is a labelled addendum, never a replacement.

## Failure modes

| Failure | What happens |
|---|---|
| Generation call fails | That repeat has no score, is left out of every metric and keeps the gateway's message. A run with failures says why. |
| Judge call fails | Recorded with its reason, never scored as zero. |
| Retrieval selects different carriers across repeats | The run stops with an error. |
| Frozen bank is stale or missing | The run refuses to start. The API answers 503 `CONFIGURATION_ERROR` naming `make ground-bank`. A bank grounded for another scorer is stale. |
| Grounding finds a bank file of the same name that holds another bank | Grounding refuses and leaves the file as it is. Move the file aside on purpose to ground that world again. |
| A rescored run's instance is grounded differently now | The addendum and the label agreement refuse, naming the instance and world, since the stored answers did not answer the question the bank asks now. |
| Another world is in the graph | The benchmark ingests the one it needs, then restores seed 2026. A server stop during a job can leave a benchmark world in Neo4j. Run `make ingest-graph`. |
| Run cancelled or failed | No `summary.json` is written, so the run is never published, and the seed 2026 graph is ingested again. |
| `--repeats` below 1, or below `OFFICIAL_MIN_REPEATS` (1 since D-097) on an official run | Refused. |
| A seed the run kind may not use (D-091) | Refused before any world is prepared, naming the seeds. |
| Two runs of different methods compared or resumed | Refused, naming both method versions (D-092). |

The archived benchmark specifications are [reference/05-benchmark-spec.md](reference/05-benchmark-spec.md) and the pages under [reference/evaluation/](reference/evaluation/scoring.md).
