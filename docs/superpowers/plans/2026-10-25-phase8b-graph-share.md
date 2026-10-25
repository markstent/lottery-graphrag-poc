# Phase 8b: Graph Share of the Evidence Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the D-025 selection rule with option 3 of `docs/evaluation/official-run-proposal.md`: in B and C, half of the evidence slots go to the graph channel's own candidates, in the shared re-ranker's order, and unused graph slots go back to the documents.

**Architecture:** One selection function in `app/retrieval/standard/context.py` gains a graph share; A has no graph candidates, so its selection is unchanged by construction. The share is a recorded context setting, and `SELECTION_RULE` changes so runs under the old and new rules never compare or resume together.

**Tech Stack:** Python 3.12, pytest.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md`, with the owner's CP3 reply "continue" of 2026-10-25 to the proposal whose stated next step was building option 3.

## Global Constraints

- The rule is fixed before measuring: `graph_slots = 6` of `evidence_slots = 12`. No value may be tried against the bank or the diagnostic.
- The same question, world, corpus, models, prompt, record text, citation builder, token budget (2,000) and slot count (12) for A, B and C.
- A's selection must be identical to the old rule for every input (it has no node candidates).
- No em dash; British spelling; long Markdown one sentence per line; commits carry no co-author line; never push; never merge.
- Never touch Neo4j, Qdrant or a real model in tests; never run a benchmark, dry run or ingestion.
- Truth-ledger isolation unchanged.

## Review Focus

1. A's selection changes for some input: it must not.
2. A graph node fills a document slot or the reverse beyond the stated rule.
3. The selected list handed to the generator is no longer in judge order, so the prompt format differs between A and B.
4. The token budget is spent by graph nodes so that no document fits: the budget rule must be stated and tested.
5. Old runs compare or resume with new ones.

---

### Task 1: The graph share

**Files:** `backend/app/config/__init__.py`, `backend/app/retrieval/standard/context.py`, `backend/app/retrieval/graph/stages.py` (only if the call needs the share), tests beside the existing context tests, `.env.example`, `docs/retrieval.md`, `docs/evaluation.md` (status lines), `README.md` (the D-025 paragraph), `DECISIONS.md`.

- [ ] **Step 1: Failing tests.**
  - `test_documents_only_selection_is_unchanged`: for a set of document-only candidate lists (including budget and duplicate cases), the new selection equals the old rule's output exactly.
  - `test_graph_candidates_get_their_share`: 20 reranked candidates where all nodes rank below 12 documents; the selection holds the top 6 nodes and the top 6 documents.
  - `test_unused_graph_slots_go_to_documents`: 2 usable nodes give 2 node slots and 10 document slots.
  - `test_nodes_never_take_more_than_their_share`: 15 nodes ranked above every document give 6 nodes and 6 documents.
  - `test_selected_list_is_in_judge_order`: the final list is ordered by re-ranker rank, whatever the channel.
  - `test_budget_is_shared_in_judge_order`: the token budget is checked as candidates enter in judge order across both channels, so neither channel reserves budget; a candidate that does not fit is `context_budget` as before.
  - `test_share_discard_reason`: a node refused because the graph share is full, or a document refused because the document slots are full, is `slot_limit`.
  - `test_selection_rule_is_recorded`: `SELECTION_RULE` is `"reranker-graph-share-6-of-12"`, and `graph_slots` appears in the recorded context settings.
- [ ] **Step 2: Implement.**
  `ContextSettings.graph_slots: int = 6` (env `RAG_GRAPH_SLOTS`, validated `0 <= graph_slots <= evidence_slots`).
  Selection: first decide which node candidates take graph slots (the top `graph_slots` usable nodes in judge order); the document slots are `evidence_slots` minus the node slots taken.
  Then walk the reranked list once in judge order, admitting a node only if it was given a graph slot and a document only while document slots remain, with the budget and duplicate checks unchanged.
  A node given a slot but refused by the budget frees its slot for documents only if the implementer can do so without a second walk changing earlier decisions; otherwise the slot stays unused, and the docstring says so.
  Update the module docstring and the `SELECTION_RULE` comment.
- [ ] **Step 3: Docs.** `docs/retrieval.md` describes the new rule and its reason in plain language, keeps a short history line for D-025, and points to the proposal. `docs/evaluation.md` and `README.md` say the rule changed on 2026-10-25 after the CP3 proposal and that the pilot runs used the old rule. `DECISIONS.md`: add D-081 ("Proposed (controller ruling on the owner's CP3 reply)") describing the rule, and mark D-025 "Superseded by D-081" in its decision text without deleting it.
- [ ] **Step 4: Gates.** From `backend/`: `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy app`, `uv run pytest -W error -q`. Fix any golden or trace test whose expected selection changes for B or C, and list each one in the report with the reason; a changed expectation for A is a defect.
- [ ] **Step 5: Commit** `feat(retrieval): half of the evidence slots go to the graph's own selection (D-081)`.

### Task 2 (controller)

- [ ] Run `make diagnose-selection` once (node count before and after), and report the numbers whatever they show.
- [ ] Regenerate `docs/evaluation/example-traces.md` with `make traces` if it reads only the live graph (check the target first).
- [ ] Update the proposal's status, `HITL_STATUS.md` and the ledger; then ask the owner for the dry-run go-ahead.
