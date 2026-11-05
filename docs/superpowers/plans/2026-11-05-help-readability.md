# Help Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Help readable for a newcomer (one shape for every chapter, a diagram where a picture explains, short sections, terms explained at first use, "world" explained first) and add two views of the official run, evidence found / missed / extra and answers by score with declines marked, to Help chapter 7 and the Results screen.

**Architecture:** One read-only backend endpoint works out the two views' counts from a stored run's `results.json` on request (cached by file stamp; no published file is rewritten). Help gains three block kinds (key line, "More detail" disclosure, numbered list), automatic first-use glossary marks, six hand-laid SVG diagrams and two live components; the chapter copy is then rewritten in four batches. A shared `OutcomeBars` component draws the two views for Help and Results.

**Tech Stack:** FastAPI + Pydantic (uv, pytest); React 19 + TypeScript strict + Tailwind 4 (pnpm, Vitest, React Testing Library, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-05-help-readability-design.md` (approved by the owner on 2026-11-05). The approved layout is option A in `.superpowers/brainstorm/7019-1793888483/content/help-chapter-styles.html`; the audit is `.superpowers/brainstorm/help-audit.md`.

## Global Constraints

- AGENTS.md in full: never the em dash, never the real employer name, never "Atlas", plain language, design tokens, keyboard access and visible focus, every diagram has a text alternative, hover help also works on keyboard focus.
- Copy rules in `frontend/src/copy/`: banned words (seed, chunk, rerank, telemetry, real, never, honest, fake, prototype, MAPS_TO); plain glossary definitions of 5 to 35 words; each chapter's `terms` appear in its text; any new block kind is added to the scan in `banned-words.test.ts`.
- Figures pinned by tests (such as "22.1 percentage points" and "2026-10-29") keep their wording.
- No change to the experiment, the scores, the published official run or its files (`summary.json`, `results.json`), the chapter list, the questions page or the two reading levels.
- No Plain paragraph longer than about 60 words; every chapter has at least one heading below its title; chapters 6, 7, 8 and 12 end under half their current Plain length (813, 706, 706, 2,933 words); nothing true is dropped: cut text moves to "More detail" or Technical.
- Answers view: three bands by answer score, right (exactly 1), partly right (above 0, below 1), wrong (0), as shares of all scored answers; inside each band a hatched part counts the answers that declined (verdict is an abstention); declines are never moved into a band of their own; the caption says an answer can decline and still score.
- Evidence view: found and missed over repeats with claims total above 0; extra records by the scorer's rule (distinct selected items, apart from the anchor, that carry no claim), shown as the average per question beside each bar.
- Docs one sentence per line; commits on `overhaul/v2`, never pushed; each commit ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A run with no `results.json`, or one without `selected` or `claims` fields (older or pilot runs): the endpoint says so and both screens show "not recorded for this run", never zeros. Test in Task 1 and Task 4.
2. A repeat with no answer score (generation failed, no checks): counted as not scored, outside the three bands, and the bands still add up to the scored answers. Test in Task 1.
3. A glossary term that appears inside another word or inside a heading: only whole words in body text are marked, and only the first time in a chapter. Test in Task 2.
4. Keyboard and screen reader: the term's meaning shows on focus and is read out; "More detail" opens with Enter and Space; each diagram's text alternative states its content. Test in Task 2 and Task 3.
5. Help chapter 7 while the run loads or fails: loading and error states with retry, the rest of the chapter still readable. Test in Task 4.

---

### Task 1: The outcomes endpoint

**Files:**
- Create: `backend/app/evaluation/outcomes.py`, `backend/tests/test_outcomes.py`
- Modify: `backend/app/api/schemas.py`, `backend/app/api/benchmarks.py` (a route beside `/benchmarks/{run_id}/instances`), `backend/tests/test_api_benchmarks.py`, `backend/tests/test_openapi_contract.py` (route count), `frontend/src/api/client.ts`, `docs/api.md`

**Interfaces:**
- Produces: `run_outcomes(results: Sequence[InstanceResult]) -> RunOutcomes` in `app/evaluation/outcomes.py` (pure; uses `is_abstention` from `checks.py` and the scorer's carrying rule from `scoring.py`, shared, not copied).
- Produces: `GET /api/v1/benchmarks/{run_id}/outcomes` returning `RunOutcomesOut { recorded: bool, evidence: dict[pipeline, EvidenceOutcome], answers: dict[pipeline, AnswerOutcome] }`, where `EvidenceOutcome { repeats: int, found: int, missed: int, extra_per_question: float | None }` and `AnswerOutcome { scored: int, right: int, partly: int, wrong: int, right_declined: int, partly_declined: int, wrong_declined: int, not_scored: int }`; `recorded` is false (and the dicts empty) when the run lacks the fields.
- Produces: `getBenchmarkOutcomes(runId, signal)` in `frontend/src/api/client.ts`.

- [ ] **Step 1: Write failing tests** in `test_outcomes.py` with a tiny fixture of `InstanceResult`s: `test_answers_band_by_score_and_mark_declines` (scores 1, 0.5, 0, 0 with verdicts "unknown ..." on the 0.5 and one 0: right 1, partly 1, wrong 2, partly_declined 1, wrong_declined 1); `test_unscored_repeat_is_outside_the_bands` (answer None: not_scored 1, scored excludes it); `test_evidence_counts_skip_repeats_without_claims` (claims_total 0 repeats left out of repeats, found, missed); `test_extra_uses_the_scorer_rule` (anchor and claim carriers not extra; duplicates counted once); `test_missing_fields_are_not_recorded`. In `test_api_benchmarks.py`: the route returns the counts for a fixture run, 404 for an unknown run, `recorded: false` for a run without the fields, and the second call reads from the cache (stat key unchanged).
- [ ] **Step 2: Run** `cd backend && uv run pytest tests/test_outcomes.py tests/test_api_benchmarks.py -q` and see them fail.
- [ ] **Step 3: Implement** `outcomes.py`, the schemas, and the route with a cache keyed on `_stat_key(results.json)` as `benchmarks.py` already does for its checks.
- [ ] **Step 4: Run** the backend suite, ruff, mypy; then `make api-contract` from the repo root, add the client function, run `cd frontend && pnpm exec tsc -b`; update `docs/api.md`; check against the official run that the endpoint answers (`curl localhost:8000/api/v1/benchmarks/official-2026-10-29/outcomes`) and that the answer shares match the published answer score means to within rounding.
- [ ] **Step 5: Commit** `feat(api): evidence and answer outcomes of a stored run`.

### Task 2: Help block kinds and first-use glossary marks

**Files:**
- Modify: `frontend/src/screens/help/chapters.ts` (`Block` union), `frontend/src/screens/help/blocks.tsx`, `frontend/src/screens/help/chapter.tsx`, `frontend/src/copy/banned-words.test.ts` (scan the new kinds)
- Create: `frontend/src/screens/help/term.tsx` (+ test), tests in `frontend/src/screens/help/chapter.test.tsx`

**Interfaces:**
- Produces: block kinds `{ kind: 'key'; text: string }` (drawn as the boxed "In one line" with the label "In one line"), `{ kind: 'more'; summary: string; blocks: readonly Block[] }` (a native `details` disclosure, closed by default, summary defaults to "More detail"), `{ kind: 'steps'; items: readonly string[] }` (a numbered list).
- Produces: `Term({ term, children })`: a marked word that shows the glossary meaning on hover and on keyboard focus (focusable, `aria-describedby` to the meaning), and the chapter renderer marks the first whole-word, case-insensitive occurrence in body text of each term in the chapter's `terms`, never inside headings or table headers.

- [ ] **Step 1: Write failing tests:** each new kind renders (key box with "In one line", `details` closed then opened by Enter, numbered `ol`); a term in `terms` is marked only at its first body occurrence, not inside another word ("worlds" marks, "otherworld" does not), not in a heading; focus shows and announces the meaning; the banned-word scan reads text inside `key`, `more` and `steps` (plant a banned word in a test block and see it caught).
- [ ] **Step 2: Run** `cd frontend && pnpm exec vitest run src/screens/help src/copy` and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Help and copy tests, then the full vitest run, tsc, oxlint, prettier.
- [ ] **Step 5: Commit** `feat(help): key lines, more-detail disclosures, numbered steps and first-use term help`.

### Task 3: Six Help diagrams

**Files:**
- Create: in `frontend/src/screens/help/diagrams/`: `test-diagram.tsx` (the test: questions to three approaches to answers, compared with an answer key, giving scores), `world-diagram.tsx` (a recipe makes tables, documents and eight planted stories, together one world, rebuilt the same each time), `countries-diagram.tsx` (four countries' own names for one kind of game, joined by one shared idea), `found-diagram.tsx` (the records a question needs against the records an approach found: found, missed, extra), `marking-diagram.tsx` (an answer and the key go to the scoring program and to two judges), `interval-diagram.tsx` (a difference with its margin of error, one crossing zero and one clear of it); tests beside them or in one `diagrams.test.tsx`
- Modify: `frontend/src/screens/help/chapters.ts` (`DIAGRAM_NAMES` gains `test`, `world`, `countries`, `found`, `marking`, `interval`), `frontend/src/screens/help/blocks.tsx`

**Interfaces:**
- Consumes: the existing diagrams' pattern in `approach-diagram.tsx` and `evidence-diagram.tsx` (hand-laid SVG, design tokens, a text alternative), and presentation scale as they handle it.

- [ ] **Step 1: Write failing tests:** each new name renders an `img`-role SVG whose accessible name and text alternative state the diagram's content in words (assert the key phrases above); none uses colour as the only cue.
- [ ] **Step 2: Run** the diagram tests and see them fail.
- [ ] **Step 3: Implement** the six diagrams, small and calm, the same visual language as the existing two.
- [ ] **Step 4: Run** the tests, the full vitest run, tsc, oxlint, prettier; look at each diagram in the browser (a temporary dev page or a test chapter is fine, not committed) at 1440 and 1920.
- [ ] **Step 5: Commit** `feat(help): six diagrams for the test, a world, the four countries, evidence found, marking and margins of error`.

### Task 4: The outcome views on Help and Results

**Files:**
- Create: `frontend/src/results/outcomes.ts` (+ test: shares from counts), `frontend/src/components/outcome-bars.tsx` (+ test)
- Modify: `frontend/src/screens/help/chapters.ts` (`ComponentName` gains `outcomes`), `frontend/src/screens/help/blocks.tsx` or the component registry Help uses, `frontend/src/screens/results/results.tsx` (place the views under the Verdict tiles), `frontend/src/copy/budget.ts` only if the copy cap outside Help must rise (with a D-116 comment)

**Interfaces:**
- Consumes: `getBenchmarkOutcomes` (Task 1); Help's newest-run loader (`loadLatest` in `frontend/src/app/latest-run.ts`) for the run id; pipeline names and colours from `frontend/src/design/pipelines.ts`.
- Produces: `OutcomeBars({ outcomes })` drawing per approach a found/missed bar with "about N extra records per question" beside it, and a right/partly/wrong bar with a hatched declined part in each band (pattern plus a text cue), a legend, and a "Show as table" twin like the other Results charts; `recorded: false` shows "Not recorded for this run."

- [ ] **Step 1: Write failing tests:** shares and labels from a stubbed `RunOutcomesOut`; declined parts sit inside their bands and the band widths add up to 100 percent of scored answers; the table twin lists every count; "Not recorded for this run." for `recorded: false`; Help chapter 7's component shows loading, error with retry, and ready; Results shows the views for the selected run.
- [ ] **Step 2: Run** the tests and see them fail.
- [ ] **Step 3: Implement** and wire into Help (component `outcomes`, placed by Task 6's copy) and Results.
- [ ] **Step 4: Run** the full vitest run, tsc, oxlint, prettier; check Results in the browser with the official run.
- [ ] **Step 5: Commit** `feat(results): evidence and answer outcomes per approach, on Results and in Help`.

### Task 5: Copy, chapters 1 to 3 and the glossary

**Files:**
- Modify: `frontend/src/screens/help/copy/why.ts`, `company.ts`, `stories.ts`, `glossary.ts`, `frontend/src/copy/glossary.ts`, the chapter tests (`chapters-1-6.test.tsx`) where structure changes

**Interfaces:**
- Consumes: block kinds (Task 2), diagrams `test` and `world` (Task 3).

- [ ] **Step 1: Write failing tests:** chapter 1 opens with the sentence "This is a test with an answer key, like an exam." and the `test` diagram; chapter 2's first section is headed "What a world is", has a key line and the `world` diagram before any other use of "world" in Help (assert no earlier chapter's Plain text uses the word); every Plain paragraph in chapters 1 to 3 is at most 60 words; the glossary has entries for world, retrieval, benchmark, run, approach, precision and multi-hop, each 5 to 35 plain words.
- [ ] **Step 2: Run** the chapter tests and see them fail.
- [ ] **Step 3: Rewrite** the Plain and Technical copy of chapters 1 to 3 in the option A shape (opening sentence, key line, diagram, short headed sections, "More detail"), keeping every pinned figure and every fact; add the glossary terms and each chapter's `terms`.
- [ ] **Step 4: Run** the Help and copy tests, the full vitest run, tsc, oxlint, prettier; read chapters 1 to 3 in the browser at both levels.
- [ ] **Step 5: Commit** `docs(help): chapters 1 to 3 in short sections, a world explained first`.

### Task 6: Copy, chapters 4 to 8

**Files:**
- Modify: `frontend/src/screens/help/copy/approaches.ts`, `evidence.ts`, `answer.ts`, `scoring.ts`, `results.ts`, `chapters-1-6.test.tsx`, `chapters-7-12.test.tsx`

**Interfaces:**
- Consumes: block kinds (Task 2), diagrams `countries`, `found`, `marking`, `interval` (Task 3), component `outcomes` (Task 4).

- [ ] **Step 1: Write failing tests:** chapters 6, 7 and 8 have Plain word counts under 407, 353 and 353; chapter 7 shows the `outcomes` component before its score sections and each score is a headed section with a one-line definition; chapter 6 has the `marking` diagram and its judges' limits as a list; chapter 8 has the `interval` diagram; chapter 5 has the `found` diagram; every Plain paragraph in chapters 4 to 8 is at most 60 words; pinned figures unchanged.
- [ ] **Step 2: Run** the chapter tests and see them fail.
- [ ] **Step 3: Rewrite** the copy of chapters 4 to 8 in the option A shape; cut text moves to "More detail" or Technical.
- [ ] **Step 4: Run** the Help and copy tests, the full vitest run, tsc, oxlint, prettier; read chapters 4 to 8 in the browser.
- [ ] **Step 5: Commit** `docs(help): chapters 4 to 8 in short sections, with the marking, evidence and margin diagrams`.

### Task 7: Copy, chapter 12, chapters 9 to 11 and the questions page

**Files:**
- Modify: `frontend/src/screens/help/copy/lessons.ts`, `limits.ts`, `running.ts`, `questions.ts`, `chapter-13.test.tsx`, `chapters-7-12.test.tsx`
- Modify if needed: `frontend/src/screens/help/chapters.ts` (`ComponentName` gains `resultsByKind`, a grouped bar chart of the newest run by kind of question, reusing `GroupedBars` from `frontend/src/charts/grouped-bars.tsx` as the Overview does)

**Interfaces:**
- Consumes: block kinds (Task 2), `GroupedBars`, Help's newest-run loader.

- [ ] **Step 1: Write failing tests:** chapter 12's Plain word count is under 1,467; it opens with the `resultsByKind` chart (loading and error states) and each section is a short list of findings with its longer explanation in "More detail"; the judges' figures and every pinned figure unchanged; chapters 9 to 11 have a heading below the title; the questions page opens with a short lead and a list; every Plain paragraph at most 60 words.
- [ ] **Step 2: Run** the tests and see them fail.
- [ ] **Step 3: Rewrite** the copy.
- [ ] **Step 4: Run** the Help and copy tests, the full vitest run, tsc, oxlint, prettier; read chapter 12 in the browser at both levels.
- [ ] **Step 5: Commit** `docs(help): what the results teach as short findings with a chart, and the last chapters tidied`.

### Task 8: End-to-end paths, baselines and docs

**Files:**
- Modify: `frontend/e2e/help.spec.ts`, `frontend/e2e/results.spec.ts`, `frontend/e2e/visual.spec.ts` (Help and Results cases), the e2e mock if it must serve the outcomes endpoint, `docs/ux.md` (Help and Results sections), `DECISIONS.md` (D-116: the owner's choice of option A, the declines-inside-bands decision, the outcomes endpoint, the new block kinds and diagrams)

- [ ] **Step 1: Write the end-to-end paths:** Help chapter 1 to chapter 12 by the "Next" links at Plain; a "More detail" opens by keyboard; a term's meaning appears on focus; chapter 7's outcome views load; Results shows the outcome views for the official run; no sideways scroll at 1440 on every Help chapter.
- [ ] **Step 2: Run** `cd frontend && pnpm exec playwright test` until green.
- [ ] **Step 3: Update** only the Help and Results visual baselines with `-g` and `--update-snapshots`, Read every new image and check it critically, and run the whole visual suite green.
- [ ] **Step 4: Run everything:** full vitest, e2e, visual, tsc, oxlint, prettier, the backend suite with ruff and mypy.
- [ ] **Step 5: Update the docs** and commit `docs: Help readability and run outcomes (D-116)`.
