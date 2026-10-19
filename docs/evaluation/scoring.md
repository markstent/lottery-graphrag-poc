# Scoring (benchmark v2, as built)

This page explains how one answer of one pipeline is scored in bank 2.0.0.
The code is `backend/app/evaluation/`: `claims.py` and `scoring.py` for evidence, `checks.py` for answers and citations, `judge.py` for the LLM judge, and `runner.py`, which applies them to every repeat.
How scores become comparisons between pipelines is in [statistics.md](statistics.md); what each run records is in [reproducibility.md](reproducibility.md).

Every repeat of every pipeline gets four deterministic results: an answer score, evidence metrics, citation metrics and a failure class.
Beside them, a judge model gives five scores of its own.
The judge never replaces a deterministic score.
A repeat whose generation failed (a gateway error) has no score at all, and it is left out of every metric rather than counted as zero.

## Claims and carriers

Each bank instance lists the claims a correct answer makes.
A claim is one plain sentence, for example "Incident INC_024 in MKT_CZ was seen on platform version PLV_IDENTITY_2.", plus its carriers.
A carrier is a source item that states the fact: a structured record id, or the id of any document chunk whose text states it.
So the evidence metric credits a pipeline for whichever source it found, a record or a document.

Carriers are computed once, at grounding time, from the world's record blocks and document chunks, and they are frozen into the bank file with the bank hash.
Retrieval code never sees them (ADR-008).

Rules from bank 2.0.0 that shape the carriers:

- L11 claims are carried by the segment's record id only.
- L20 and L21 game claims are carried by the game's record id only.
- Planted (H5) claims and expected answers come from the truth ledger only.

## The anchor is excluded

Every structural question names an anchor, for example the incident in "Which platform version was incident INC_022 seen on?".
The pipeline is given that id, so finding it is no discovery.
The anchor is therefore removed from every claim's carriers and from the pipeline's selected evidence before the evidence metrics are computed.
A claim left with no carrier is dropped.

When no claim survives, the instance's evidence metrics are undefined (not zero) and the instance counts for the answer metrics only.
L01 and L04 are scored on the answer only: the only source of a game's price with its currency, or of its digital flag, is the game's own record, which is the anchor.
In the seed 2026 bank the same holds for every single-fact (H3) instance, L02 and L03 included, so single facts are compared on the answer, which is their headline metric.
For multi-hop (H1) and ontology (H2) questions an anchor that would leave no claim is not eligible at grounding, so every H1 and H2 instance has evidence to discover.

Whether the anchor itself was reached is reported separately as anchor resolution.
For B and C the anchor is resolved when it is among the selected carriers or the entities the pipeline resolved.
Pipeline A has no entity resolution stage, so for A the metric reads the selection alone, and the report labels A's value "selection only".

## Evidence metrics

The selected evidence is the list of carriers the pipeline placed in the prompt, in order, with duplicates and the anchor removed.
Every pipeline places at most the same number of evidence items (`RAG_EVIDENCE_SLOTS`, 12 by default) within the same token budget (`RAG_CONTEXT_TOKEN_BUDGET`, 2,000 by default), so the metrics compare equal slot counts.

- Recall: the share of claims with at least one carrier in the selection.
- Precision: the share of selected items that carry at least one claim; an empty selection has precision 0.
- F1: the harmonic mean of recall and precision.
- Efficiency: claims found per 1,000 context tokens.

Retrieval must select the same carriers in every repeat of an instance; only generation may vary.
The runner stops the run with an error if a repeat selects anything else.

## Answer checks

Each instance carries one or more checks, written at grounding time from the expected answer.
The answer score is the mean of its checks, from 0 to 1.
Number, token and set checks read the structured verdict and the answer text together, so a fact stated only in the verdict counts.

- Verdict check (yes or no questions): 1 when the verdict opens with the expected "yes" or "no", else 0.
- Token check: 1 when the answer names the expected value or one of its aliases as a whole word, ignoring case, else 0.
  Word boundaries are Unicode-aware, so `INC_01` never matches inside `INC_010` and accented local names match as whole words.
- Set check: the F1 of the ids the answer names against the expected ids, over a fixed universe of candidate ids with their aliases.
  An alias shared by more than one id in the universe identifies none of them.
  Every set check's universe excludes the anchor.
- Number check: the expected number must appear in the answer.
  When the check has a unit and some number in the answer stands next to that unit (for example `2.50 EUR` or `€2.50`), only those numbers are read.
  The score is 1 when the expected number is the only distinct number read, 0.5 when other numbers appear beside it (the contradictory-number rule), and 0 when it is missing.
  Citation markers, identifiers such as `INC_042` and dates are not numbers.

How numbers are read:

- Numbers are compared after normalisation, so `2.50` matches `2.5`.
- A comma followed by exactly three digits is a thousands separator (`1,200` is 1200); any other comma is a decimal point (`2,5` is 2.5).
- Accepted limits: European digit grouping (`1.200,00 €`) and space grouping (`1 200`) are not parsed; `1,2,3` reads as 1.2 and 3; a number run together with its unit (`59Kč`) is not read as a number.

Question-specific rules in bank 2.0.0:

- L18's set check leaves out the primary market and the market the answer should name as unaffected, so it measures recall only: naming the unaffected market as affected is not penalised by the set check.
- L16 and L17 expect every other player linked to the anchor's shared devices (L16) or payment instruments (L17) in the world data, so the expected sets include baseline players, not only the planted cluster.
  In seed 2026, L17 expects PLAYER_UK_000605 and PLAYER_UK_002023 among them.
  This is an open owner question.
- The L16 and L17 universes are every player on any device (L16) or payment instrument (L17) that two or more players share; L16 has 6,068 ids in seed 2026.
- L22's expected answer states only the authoritative price.
  An answer that also quotes the stale price from the superseded document scores 0.5 under the contradictory-number rule.
  This is an open owner question.

Every expected answer scores 1.0 against its own checks; a test asserts this for every frozen instance.

## Citation metrics

Answers cite context blocks as `[n]` or `[n, m]`.

- Citation accuracy: the share of cited blocks whose carrier carries one of the instance's claims; a citation of a block that was not shown counts as inaccurate.
  It is undefined when the answer cites nothing or the instance has no claim.
- Numeric citation rate: the share of the answer's sentences that state a number and also carry a citation.
  It is undefined when no sentence states a number.

## Failure class

A repeat is weak when its answer score is below 0.5 or its evidence recall is below 0.5.
A weak repeat gets one class, from its scores and telemetry alone:

- `entity_resolution_failure`: B or C did not resolve the anchor.
- `retrieval_failure`: evidence recall is below 0.5.
- `generation_failure`: the evidence was found but the answer is weak.

## The LLM judge

A judge model scores every successful repeat on five dimensions, each 0 (wrong or absent), 1 (partly) or 2 (fully): correctness, completeness, faithfulness to the shown context, citation accuracy, and appropriate abstention.
The rubric and the reply format are the judge prompt, version `1.0.0` (`JUDGE_PROMPT_VERSION`).

What the judge sees:

- the question, the expected answer and the claim statements;
- the text of each context block the generator was shown, without titles or carrier ids, in an order shuffled by a hash of the instance, pipeline and repeat, and renumbered from 1;
- the answer, capped at 2,400 characters, with its citation markers rewritten to the new numbers.

A marker of a block that was not shown becomes `[?]`, and so does any other bracket holding a digit that is not a citation marker, such as `[1-3]` or `[Q3 2025]`.
No word of the prompt names a pipeline or how the context was retrieved.

Known limitation: a graph node without a record block is shown as the text `<Label> <id>`, which can differ in form from the record text pipeline A retrieves for the same record.
That residual tell remains after blinding.

Rules:

- The judge must be of another model family than the generator in an official run (`JUDGE_MODEL_FAMILY` differs from `GENERATION_MODEL_FAMILY`); the run refuses to start otherwise.
- Smoke runs use the fake judge, which measures nothing; sweep and official runs need a gateway judge (`JUDGE_PROVIDER=litellm`).
- A judge failure (gateway error or an unusable reply) is recorded with its reason and has no scores; it is never scored as zero.
- Judge scores are reported beside the deterministic scores and never replace them.
- Agreement: for every judged repeat with an answer score, "judge correctness is 2" is compared with "answer score is at least 0.5"; the summary reports the agreement rate and Cohen's kappa, overall and per pipeline.
- `judge_prompt_hash` is the sha256 of the system prompt plus its version only, so a change to the layout of the user message does not change the hash.

## Cost, latency and tokens

Latency and context tokens are recorded per repeat and reported as their own metrics.
They are never folded into a quality score.
