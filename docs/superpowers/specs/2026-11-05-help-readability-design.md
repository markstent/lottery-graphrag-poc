# Help readability redesign

Status: draft for the project owner's approval.
Date: 2026-11-05.

## Why

The project owner says the Help screen "just looks like large blobs of text".
The owner asked to "make it easier to read, add diagrams to support explanations, make sure its clear to someone without prior knowledge", and "make sure you explain what a world is".
The owner also approved two new views of the official run, "found / missed / extra" for evidence and "right / wrong / declined" for answers, for the scoring chapter and the Results screen.

What a read-through of Help found on 2026-11-05 (the full audit is `.superpowers/brainstorm/help-audit.md`):

- About 7,500 Plain words over 13 pages, and 70 percent of them in five chapters: 1 Why this exists (844), 6 The answer and the judge (813), 7 How scoring works (706), 8 Reading the results (706) and 12 What the results teach (2,933).
- The longest Plain paragraph is 218 words; chapters 7 and 8 are twelve paragraphs each with no heading and no picture.
- Help has four diagrams in all (the three approaches and evidence) and one text style for everything else.
- Terms are used before they are explained: "world" first appears about 500 words into chapter 1 and is explained in three places; "answer score" is used in chapter 1 and explained in chapter 7; retrieval, benchmark, run, approach (pipeline), precision and multi-hop are not in the glossary.

## What the owner chose

The owner compared two layouts in the visual companion (`.superpowers/brainstorm/7019-1793888483/content/help-chapter-styles.html`) and chose option A, "short sections, a diagram, a key line", then said "continue" to the playback below.

Every chapter takes the same shape:

1. One opening sentence in plain words.
2. A boxed "In one line" summary.
3. A diagram where a picture explains better than words.
4. Short headed sections, each a few lines or a short numbered or bulleted list.
5. Longer detail behind a "More detail" disclosure, or at the Technical level.
6. Terms explained at their first use; a glossary term in the text is marked and shows its plain definition on hover and on keyboard focus.

## Goals

- A reader with no prior knowledge can follow Help from chapter 1 without meeting an unexplained word.
- No Plain paragraph is longer than about 60 words, and every chapter has at least one heading below its title.
- Every chapter that explains a process or a comparison has a diagram.
- The four longest chapters (12, 6, 7, 8) are under half their current Plain length, with nothing true dropped: what is cut moves to "More detail" or the Technical level.
- "World" is defined in plain words, with a diagram, before it is used anywhere in Help.
- The two new views are on the scoring chapter and on the Results screen.

## Non-goals

- No change to the experiment, the scores, the published official run or its figures.
- No change to the chapter list, the questions-and-answers page, or the two reading levels.
- No new charting library; diagrams follow Help's existing hand-laid SVG diagrams with text alternatives.

## Anti-goals

- Help that is shorter but less true: every published figure and every limit stays, in the same words where tests pin them.
- Diagrams that decorate rather than explain, or that show anything the data does not.
- A view that hides or moves answers that said they could not tell, or that no longer adds up to the answer score.

## Constraints

- AGENTS.md in full: never the em dash, never the real employer name, plain language, accessibility (every diagram has a text alternative; hover help also works on keyboard focus), design tokens.
- The copy rules in `frontend/src/copy/`: the banned words (seed, chunk, rerank, telemetry, real, never, honest, fake, prototype, MAPS_TO), plain glossary definitions of 5 to 35 words, and glossary terms used in their chapter; any new block kind is added to the scan in `banned-words.test.ts` so it is still checked.
- Figures pinned by tests (such as "22.1 percentage points" and "2026-10-29") keep their wording.
- Help has no word cap (D-082); the Results screen is under the copy budget outside Help, which may rise with a decision record.
- Docs (`docs/ux.md` Help and Results sections, `DECISIONS.md`) change with the behaviour, one sentence per line.

## The design, as decided

### The chapter shape

- New block kinds in `frontend/src/screens/help/chapters.ts` and `blocks.tsx`: a key line ("In one line"), a "More detail" disclosure holding other blocks, and a short-list form for numbered steps if the existing list block cannot show numbers.
- The existing `diagram` block gains new diagram names, one per diagram below.
- Glossary terms in body text are marked and show their definition on hover and focus, from the existing glossary (`frontend/src/copy/glossary.ts`).
- The Technical level keeps its fuller text, also broken into headed sections, and may reuse the same diagrams.

### Chapter by chapter (Plain level)

- 1 Why this exists: opens with "This is a test with an answer key, like an exam." and a diagram of the test: questions, three approaches, answers, an answer key, scores.
- 2 The made-up company: "What a world is" first, with the recipe diagram (a recipe makes tables, documents and the planted stories, together one world, the same every time it is rebuilt) and three short reasons it is made up.
- 3 The planted stories: one line on what a story is and why planting it gives a known answer; the story cards stay.
- 4 The three approaches: the three existing diagrams stay, each with a one-line lead.
- 5 How evidence is chosen: the existing diagram stays; a diagram of needed records against found records introduces "evidence found".
- 6 The answer and the judge: a flow diagram of how an answer is marked (the answer and the key go to the scoring program and to two judges); the judges' limits as a short list.
- 7 How scoring works: the two new views, then each score as a headed section with a one-line definition and an example.
- 8 Reading the results: a diagram of how to read a margin of error (a difference with its interval, crossing zero or not) and what "passed the test" means.
- 9 Assumptions and limits, 10 Glossary, 11 Running it: small edits only; the glossary gains retrieval, benchmark, run, approach, precision and multi-hop.
- 12 What the results teach: a grouped bar diagram of the results by kind of question, then each section as a short list of findings, with the longer explanations behind "More detail".
- Questions and answers: its opening paragraph is split into a short lead and a list.

### The two new views

- Evidence, per approach: of the records the questions needed, the share found and the share missed, from the official run's stored claims found and claims total per repeat; and the number of extra records brought that were not needed, shown beside each bar.
- Answers, per approach: three bands by the answer score, right (exactly 1), partly right (above 0 and below 1) and wrong (0), each as a share of all answers, so the bands match the answer score shown everywhere else.
- Inside each band, a hatched part (with a non-colour cue and its count in the text alternative) shows how many of those answers said the sources could not answer (an abstention, from the stored verdict).
- Owner's decision, 2026-11-05 (option 1): declines are marked inside the score bands, not moved into a band of their own; in the official run 263 of 900 answers declined, of which 182 scored 0, 65 scored partly and 16 scored 1.
- The caption explains in plain words that an answer can decline and still score, because it named part of the answer key on the way.
- Both are worked out from the stored official run with no new run, and shown on Help chapter 7 and on the Results screen beside the existing tiles.
- Writer's call: the counts are worked out when the API serves a run, from its stored `results.json`, cached by the file's modification time as the benchmarks API already caches its checks; no published artefact (`summary.json`, `results.json`) is rewritten, so the published figures cannot change.
- Writer's call: found and missed are counted over the repeats whose scored claims are not empty (claims total above 0), the same repeats evidence recall uses; extra records use the scorer's own rule in `backend/app/evaluation/scoring.py` (distinct selected items, apart from the anchor, that carry no claim) over the same repeats, and are shown as the average number per question beside each bar.
- Writer's call: a run that lacks the stored fields a view needs (an older or pilot run) shows that view's "not recorded for this run" note instead of the view.
- Writer's call: Help chapter 7 reads the figures from the latest official run through the loader Help already uses for the newest run, with loading and error states, so no figure is written into the copy.


## Left to the builder

- Component and file structure, keeping to the lean rules in AGENTS.md.
- The exact wording, within the plain-language rules, the banned words and the pinned figures.
- Diagram layout and styling, following the existing Help diagrams.
- How the summary counts are computed and named, and whether the official run's summary is regenerated in place or the counts are worked out when the API serves it, as long as the published figures do not change.
- Where exactly the views sit on the Results screen.

## Testing

- Vitest for the new block kinds, the hover and focus glossary help, the views' figures from stubbed summaries, and that "said it could not tell" is never inside wrong.
- The existing Help tests keep passing, updated only where structure changes; the banned-word and glossary scans cover the new blocks.
- Backend tests for the new summary counts against a fixture run.
- Playwright: Help and Results end-to-end paths, and new visual baselines for every Help chapter that changed and for Results, normal and presentation mode.
