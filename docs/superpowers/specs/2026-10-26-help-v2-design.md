# Help v2: a one-stop guide for two audiences

Status: draft for the project owner's approval.
Branch: `help-v2`, in the worktree `../lottery-graphrag-poc-help`, cut from `overhaul/v2` at 27a4ce4.

## Intent

The owner needs Help to be the single place where anyone can learn what the product does, how, and why, without someone beside them to explain it.
Help is not part of the experiment; it makes the experiment explainable.
Two audiences read it.

- Executives and other non-technical readers want the plain story: what was tested, why it matters to the business, what the result means, and what it does not prove.
- Technical readers want everything needed to check the method: definitions, every setting with its value, every assumption with its reason, the fairness controls, the scoring rules, the known limits, and how to reproduce a run.

The owner's words: "excellent and exhaustive", but "concise enough to capture everything without over explaining or adding unnecessary noise".

## Goals

- A reader with no prior knowledge can understand, from Help alone, what the product tests and how to read its results.
- A technical reader can, from Help alone, understand and challenge every choice that shapes a result.
- Every term is defined where it first appears in a chapter and in the glossary.
- Every setting that shapes a result is listed with its value, its reason and what it costs if the choice is wrong.
- Every assumption and every known limit is stated plainly, including those that cut against the graph.

## Non-goals

- No change to the experiment, the pipelines, scoring, or any recorded setting.
- No change to other screens' copy or to the copy rules outside Help.
- No new tutorial video, tour or chat assistant.

## Anti-goals (a failure even if it works)

- Reassurance or sales copy; Help states the result and its limits as they are (memory: the owner wants the truth in plain language).
- A value typed into Help that drifts from the code: a setting shown in Help must come from the code or the API, not a second hand-written copy.
- Two readings that disagree with each other.
- Padding: repetition, preamble, or explanation of the obvious.
- Exposing answer keys anywhere but where Help already shows them, or giving any pipeline access to them.

## The owner's decisions (2026-10-26, in conversation)

1. Layout: **a reading-level switch** (option B of the mock-ups): one Help screen, a control at the top with two levels, "Plain" and "Technical".
2. Chapters (below) agreed as played back.
3. The Help word cap (1,650 words, D-055 and D-066) is lifted for Help only.
4. Technical terms are allowed in Help, each defined where first used.
   The banned-word scan keeps applying everywhere outside Help and to Help's Plain level.

These need a decision record (D-082) worded "Approved by the project owner in conversation on 2026-10-26", and `docs/ux.md` "Help" rewritten to match.

## The reading levels

- Plain is the default, and the level used in presentation mode.
- Technical shows the Plain text of each chapter followed by its technical detail, so a technical reader still sees the framing; it does not replace the Plain text.
- The level is in the URL (`?level=technical`) so a link opens at the right level, and it is remembered per viewer in local storage with a safe fallback when storage fails.
- The switch is a labelled two-option control, keyboard operable, with the current level announced to screen readers.
- Switching keeps the reader's place: the chapter in view stays in view.
- Deep links that work today (`?section=`, `?story=`, `?stratum=`) keep working at both levels; links from other screens open at Plain.

## Chapters

Each chapter has a Plain part and a Technical part.
The list gives the substance; wording is the builder's, under the writing rules below.

1. **Why this exists.**
   Plain: the business question; what a knowledge graph and an ontology are, in one paragraph each; why they might help answer questions that cross systems and markets; what the experiment can and cannot show.
   Technical: the hypotheses as stated in the spec, and the experimental design in one paragraph (three approaches, everything else held equal).
2. **The made-up company.**
   Plain: a synthetic lottery operator in four markets, what it contains, and why synthetic data is used.
   Technical: entities and volumes, the data layers (structured records, documents, graph), generator version, world and scenario seeds, determinism and how it is tested.
3. **The planted stories.**
   Plain: what a planted story is and why there are eight; each story in two or three sentences (today's story cards stay).
   Technical: the truth ledger, the signals each story leaves in the data, noise, and the isolation rule and its tests.
4. **The three approaches.**
   Plain: A, B and C with one simple diagram each.
   Technical: chunking, embedding and sparse models, hybrid search, graph seeding and traversal limits, what the ontology adds to C, and the candidate pool sizes.
5. **How evidence is chosen.**
   Plain: the model sees at most 12 pieces of evidence, a relevance scorer picks them, and in B and C six places are kept for graph records; why there is a limit at all.
   Technical: the re-ranker model, the 12 slots, the 6 graph slots, the 2,000-token budget, duplicate removal, discard reasons, D-025 and D-081 and what the diagnostic measured.
6. **The answer and the judge.**
   Plain: what the answer model is told and must return; what the judge does and why it comes from a different model family.
   Technical: the prompt contract and its version, models, temperatures, token caps, reasoning off and why (the first pilot's empty answers), judge rules.
7. **Scoring.**
   Plain: what "right" means.
   Technical: claim and citation checks, the judge's place, failure causes, repeats, intervals and how differences are reported.
8. **Reading the results.**
   Plain: how to read Overview and Results; what a difference between approaches does and does not mean.
   Technical: run kinds (official, subset, quick check), what makes a run comparable, the recorded settings, how `compare` decides.
9. **Assumptions and limits.**
   A register, one row each: the assumption or limit, why it was made, what it costs if wrong.
   Plain shows the row in one sentence; Technical adds the reason, the cost and the decision record.
   Includes at least: synthetic data, one company shape, the 12-slot and token limits, the 6-of-12 share chosen before measuring, reasoning off, local model size, the judge as a model, question bank size, the re-ranker scoring graph records low, and that the bank was written by the builders of the system.
10. **The questions.** The question bank with answer keys and scores, as today.
11. **Glossary.** Every term used anywhere in Help, with a Plain definition and, where it adds something, a Technical one.
12. **Running it.** Plain: a short note that this is for operators. Technical: every Makefile target in use, the settings that matter, how to reproduce an official run and resume one.

## Values come from the code

- Settings shown in Help (slots, graph slots, token budget, models, reasoning, temperatures, pool sizes, traversal limits, versions) are read from the backend, not typed into Help.
- My call: one new read-only endpoint, `GET /api/v1/settings`, returning the current experiment settings that are not secret, with a typed schema; the frontend types are regenerated with `make api-contract`.
  Help shows these as "the settings this system runs with now", and, where an official run exists, also the settings recorded in that run, so a reader can see both and spot a difference.
- Model availability stays on the existing `/models` endpoint.
- Decision records are cited by number (D-0xx); Help does not copy their text.

## Writing rules

- No em dash; British spelling; one sentence per line in Markdown docs.
- Plain level: short sentences, no undefined term, the banned-word list applies, and the glossary's plain replacements are used.
- Technical level: real terms, each defined at first use in the chapter or linked to the glossary.
- Say each thing once; link instead of repeating.
- State results and limits as they are; never "promising", "powerful" or similar.
- Words on screen never include the real employer name or the banned project name.

## Accuracy

Every factual statement in Help must be checked against the code or the docs it describes, not against memory.
The build ends with a review whose only job is accuracy: each claim traced to its source, any mismatch fixed in Help or raised as a spec gap.
Where the code and a spec disagree, Help describes what the code does and the gap goes in `docs/reference/phase7-spec-gaps.md`.

## Constraints

- The official run of 2026-10-26 is in progress on `overhaul/v2` at 27a4ce4 and its resume needs that branch unchanged with a clean tree.
  All Help work happens on `help-v2` in its own worktree and merges into `overhaul/v2` only after the run has finished and been verified, with the owner's approval.
- Do not touch Neo4j, Qdrant or a model from tests; do not start a benchmark or ingestion; do not stop the running API (port 8000) or UI (port 5173) in the main tree; use other ports in the worktree.
- Gates: backend ruff, format, mypy, pytest -W error; frontend lint, format, typecheck, api:check, vitest, build, e2e and visual tests, with Help's visual baselines regenerated and inspected by eye at both levels.
- Accessibility as elsewhere: keyboard, focus, contrast, reduced motion, semantic headings, text alternatives for every diagram.

## Calls made by the controller after the builder check

These are the controller's calls, not the owner's; the owner may overrule any of them.

1. **Section links.**
   The 12 chapters get new ids.
   The 8 old ids stay as aliases to the nearest new chapter (`what` to 1, `data` to 2, `stories` to 3, `approaches` to 4, `scoring` to 7, `questions` to 10, `glossary` to 11, `running` to 12), so links from other screens and their tests keep working unchanged.
2. **What `GET /api/v1/settings` returns.**
   Exactly the fields a run records: the endpoint reuses `runner.settings_fields()` (`backend/app/evaluation/runner.py`), the function that builds a run's recorded settings, so "settings now" and "settings recorded in a run" are the same schema by construction.
   It lives in `backend/app/api/benchmarks.py`, one of the two API modules allowed to import `app.evaluation`.
   No setting is moved into config and no pipeline code changes; a value that is neither recorded nor in config is described in prose, citing the file that holds it.
   It is read-only and tested with the existing fake adapters; no live service is needed.
3. **Recorded settings of a run.**
   Help reads them from the newest official run's record.
   A field the run did not record shows "not recorded"; a field whose value differs from the current one is marked as different.
4. **Numbers in prose.**
   The reference is the code on `help-v2`.
   Where prose states a current setting (12 slots, 6 graph slots, 2,000 tokens), the number is filled in from `/api/v1/settings`, not typed.
   Historical measurements (the pilot, the diagnostic, the dry run) are typed, each with its date and source record, because they are facts about past events.
5. **Copy checks.**
   Each chapter's content is held as separate Plain and Technical fields, not mixed JSX, so the scan can tell them apart.
   The banned-word scan applies to Plain fields and to the glossary's plain definitions; the Help word cap is removed, not raised.
6. **Presentation mode.**
   Plain by default; an explicit `?level=technical` in the URL is honoured; local storage is ignored in presentation mode.
7. **Visual baselines.**
   Help top at both levels; one chapter with a diagram at both levels; the assumptions register at Technical; the existing loading, error, questions and presentation baselines kept.

## Left to the builder

- Wording, within the rules above.
- Diagram style, within the design tokens; diagrams are static SVG or HTML, not images.
- How chapters split into files.
- Whether a chapter's Technical part opens with a short "settings in this chapter" table.

## Done when

- The owner reads Help at both levels and approves it.
- The accuracy review finds no unresolved mismatch.
- All gates pass, and visual baselines are reviewed.
