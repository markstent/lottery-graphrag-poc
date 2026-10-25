# Phase 8: Official Run Proposal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the official run safe to start, and give the owner the evidence and the proposal CP3 needs: the D-025 options, the model and cost choice, and a ready dry-run command.

**Architecture:** Four backend changes close the open CP3 prerequisites: an explicit reasoning switch per provider in the model gateway, one settings-equality check shared by `compare_runs` and a new resume path, per-world results kept on disk while a run is under way, and a question filter for the four-question dry run. A read-only retrieval diagnostic measures how often the shared re-ranker (D-025) drops the claim records the graph found. The controller then writes the CP3 proposal from those numbers and the pilot data.

**Tech Stack:** Python 3.12, LiteLLM, pytest, the existing `app.evaluation` CLI.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md` (section 9 step 8, the CP3 row of section 4, and the risk table row "Official run cost and duration").

## Global Constraints

- Never use the em dash; British spelling; long Markdown one sentence per line.
- Commits carry no co-author or agent-name line; never push; never merge.
- Truth-ledger isolation: `app.retrieval`, `app.graph`, `app.ontology`, datasets and scenarios never import `app.evaluation`; in `app/api` only `benchmarks.py` and `scoring.py` may.
- Never start a benchmark, smoke run, sweep, dry run, ingestion or `prepare_world` against the live Neo4j; it must stay at dev-seed2026 with 36,888 nodes. `make test` and `pytest` never set `GRAPH_E2E`.
- Never call a real model or OpenRouter in tests; LiteLLM is stubbed or exercised through its offline request transformation only.
- No D-025 method change in this plan: the re-ranker rule stays as built until the owner rules at CP3.
- Every new decision goes into `DECISIONS.md` as "Proposed (controller ruling, for owner review at CP3)".
- Gates per task: `uv run ruff format --check .`, `uv run ruff check .`, `uv run mypy app`, `uv run pytest -W error` from `backend/`.

## Review Focus

1. A thinking model on OpenRouter ignores "off" and spends the token cap on hidden reasoning: the run must fail loudly, not score empty answers.
2. A resumed run silently mixes worlds produced under different settings: resume must refuse any difference outside the allowed list.
3. A run fails in world 3 after 6 hours: worlds 1 and 2 must be on disk and the API must still publish nothing.
4. Two runs compared with different `max_tokens` or reasoning modes: `compare_runs` must refuse and name every differing field.
5. The diagnostic touches the graph: it must refuse unless the live graph is the presentation world, and must never write to Neo4j.

---

### Task 1: Reasoning switch per provider

**Files:** `backend/app/models/gateway.py`, `backend/app/config/__init__.py`, `.env.example`, `backend/tests/test_gateway.py`, `docs/operations.md` (the reasoning lines).

- [ ] **Step 1: Failing tests.**
  - `test_reasoning_off_for_ollama_sends_think_false`: build the outgoing request with LiteLLM's offline transformation for `ollama/qwen3.6:latest` and assert `think` is `False` in the body.
  - `test_reasoning_off_for_openrouter_sends_reasoning_disabled`: for `openrouter/<model>`, assert the outgoing body carries `"reasoning": {"enabled": False}` whether or not LiteLLM flags the model as reasoning-capable.
  - `test_reasoning_off_refused_for_unmapped_provider`: `GENERATION_MODEL=anthropic/x` with `GENERATION_REASONING=off` fails at settings load with a message naming the supported prefixes; `default` stays allowed for any provider.
  - `test_reasoning_off_but_model_reasoned_is_an_error`: a stubbed response whose usage reports `completion_tokens_details.reasoning_tokens > 0` while reasoning is off raises `GatewayError` naming the model.
- [ ] **Step 2: Implement.** Replace the single `REASONING_OFF` splat with an explicit per-prefix mapping: `ollama/` and `ollama_chat/` send `reasoning_effort="none"` (LiteLLM maps it to `think=false`); `openrouter/` sends `extra_body={"reasoning": {"enabled": False}}`. `reasoning_mode_supported(model) -> bool` is used by settings validation for both generation and judge. Verify each mapping against the installed LiteLLM source, and cite the file in a comment.
- [ ] **Step 3: Gates, then commit** `feat(models): explicit reasoning switch per provider`.

### Task 2: One settings-equality check

**Files:** `backend/app/evaluation/official.py` (or a new `backend/app/evaluation/settings_check.py` if `official.py` would grow past a cohesive size), `backend/tests/test_official.py`.

**Interfaces (Produces):** `settings_differences(a: Mapping[str, Any], b: Mapping[str, Any], allowed: frozenset[str]) -> list[str]` returns the sorted field names whose values differ, including fields present on one side only. `RESUME_MAY_DIFFER = frozenset({"started_at", "world_dir", "git_dirty"})`. `COMPARE_MAY_DIFFER = RESUME_MAY_DIFFER | {"git_sha", "generation_model", "generation_model_family", "generation_quantisation"}`. Per-world fields (`world_seed`, `scenario_seed`, `bank_hash`) are compared world by world, not across worlds.

- [ ] **Step 1: Failing tests.** `test_compare_refuses_different_max_tokens`, `test_compare_refuses_different_reasoning`, `test_compare_refuses_different_judge` (each asserts the field name is in the message), `test_compare_names_every_differing_field`, `test_compare_accepts_runs_that_differ_only_in_the_model`.
- [ ] **Step 2: Implement** `settings_differences` and call it in `compare_runs` on the run records and on each world's record, after the existing checks. The refusal is a `ValueError` listing every differing field with both values.
- [ ] **Step 3: Gates, then commit** `feat(evaluation): compare_runs refuses runs whose settings differ`.

### Task 3: Keep completed worlds, and resume

**Files:** `backend/app/evaluation/official.py`, `backend/app/evaluation/__main__.py`, `backend/app/api/benchmarks.py` (failure message only), tests in `backend/tests/test_official.py` and `backend/tests/test_api_benchmarks.py`, `Makefile`, `docs/evaluation.md`, `docs/operations.md`.

**Interfaces:** consumes `settings_differences` and `RESUME_MAY_DIFFER` from Task 2. Produces `run_benchmark(..., resume: bool = False)` and the CLI flag `--resume` (requires `--out`).

- [ ] **Step 1: Failing tests.**
  - `test_failed_world_keeps_completed_worlds`: world 2027 raises; `out_dir/worlds/2026.json` exists and holds that world's `WorldRun` payload; `summary.json`, `results.json` and `report.md` do not exist; the original error propagates; the presentation graph is restored.
  - `test_resume_skips_kept_worlds`: a kept 2026 file plus `resume=True` runs only 2027 and 2028 (the runner factory sees two seeds), and the final `results.json` equals a run that never failed, apart from `started_at`.
  - `test_resume_refuses_different_settings`: a kept world whose record differs in `max_tokens` is refused before any world is prepared, naming the field.
  - `test_resume_refuses_different_selection_or_kind`.
  - `test_resume_without_kept_worlds_is_an_ordinary_run`, and `test_used_dir_still_refused_without_resume` (`_refuse_used_dir` keeps refusing a directory with `summary.json`, with or without resume).
  - API: `test_failed_job_keeps_worlds_and_publishes_nothing`; the job's error detail says how many worlds were kept and names the `--resume` command, without a path outside the runs directory.
- [ ] **Step 2: Implement.** After each world, write `worlds/<seed>.json` atomically with the run's kind, selection and the world payload. On resume, load each kept file, check kind, selection and settings against a fresh record for this process (`settings_differences` with `RESUME_MAY_DIFFER`), and skip those seeds. The world files stay after a successful run as part of the record. The bank hash of a kept world must match the current frozen bank of that seed, or resume is refused.
- [ ] **Step 3: Makefile.** `run-benchmark` accepts `OUT=` and `RESUME=1`, passing `--out $(OUT) --resume` only when both are set.
- [ ] **Step 4: Docs.** `docs/evaluation.md` and `docs/operations.md` describe kept worlds and resume in plain language, one sentence per line.
- [ ] **Step 5: Gates, then commit** `feat(evaluation): keep completed worlds and resume a failed run`.

### Task 4: Four-question dry run

**Files:** `backend/app/evaluation/official.py` (`select_instances`, `Selection`, `run_label`), `backend/app/evaluation/__main__.py`, `backend/app/api/benchmarks.py` (accept the field only if the existing `BenchmarkStart` validation pattern makes it a one-line addition; otherwise CLI only, ledgered), `Makefile`, tests.

- [ ] **Step 1: Failing tests.** `test_questions_filter_keeps_only_named_questions` (`questions=("L01","L05")` with `limit=1` gives two instances), `test_unknown_question_id_refused`, `test_selection_records_questions` (the selection and the run label name the questions), `test_compare_and_resume_treat_questions_as_selection`.
- [ ] **Step 2: Implement** `--questions L01,L05,...` as part of `Selection`.
- [ ] **Step 3: `make dry-run`.** Official kind, `--seeds 2026 --repeats 1 --limit 1`, and `--questions` set to the first bank question of each stratum H1, H2, H3 and H5, taken the way `GET /demo/questions` takes them (D-036), not hand-picked. The question ids are computed by a small CLI helper, not hard-coded, so a bank change cannot leave them stale. Help text: "Four-question dry run of the official settings (wipes and restores the graph; owner approval required)".
- [ ] **Step 4: Gates, then commit** `feat(evaluation): question filter and the four-question dry run`. Do not run the target.

### Task 5: D-025 retrieval diagnostic (read-only)

**Files:** `backend/app/evaluation/diagnostics.py` (new), `backend/app/evaluation/__main__.py` (`diagnose-selection` command), `backend/tests/test_diagnostics.py`, `Makefile` (`diagnose-selection`).

**Purpose:** For every instance of the frozen seed-2026 bank that has claims, run retrieval only for A, B and C with no generation, and report for each pipeline: the claim carriers the bank expects, how many of them appeared among the graph candidates (B and C), how many among the document candidates, and how many the shared re-ranker selected into the prompt. Totals per stratum and overall, plus the list of instances where the graph found a carrier the re-ranker dropped.

- [ ] **Step 1: Failing tests** with a fake lab and fake events: `test_counts_carriers_found_and_selected`, `test_dropped_list_names_instance_and_carrier`, `test_refuses_when_graph_is_not_the_presentation_world` (the fingerprint check of D-037), `test_never_calls_the_generator` (the generator stub raises if called), `test_writes_json_and_markdown`.
- [ ] **Step 2: Implement.** Read candidates and selected ids from the pipelines' recorded events, the same events Live Lab shows. The module is in `app.evaluation`, which may read the bank; nothing it computes reaches a pipeline. Output to `data/evaluation/diagnostics/<UTC>-selection/` as `selection.json` and `selection.md`. No Neo4j write, no ingestion, no `prepare_world`.
- [ ] **Step 3: Gates, then commit** `feat(evaluation): read-only diagnostic of what the shared re-ranker keeps`.
- [ ] **Step 4 (controller):** check the node count is 36,888, run `make diagnose-selection` once with `GENERATION_PROVIDER=fake`, check the count again, and keep the output for Task 6.

### Task 6 (controller): CP3 proposal and status

- [ ] `docs/evaluation/official-run-proposal.md`: the D-025 evidence from Task 5, three or four options with what each changes in A, B and C and why it is or is not fair, and a recommendation; the model and judge candidates with current prices, the call and token counts projected from the pilot, the cost and duration of each choice, and a recommendation; the dry-run command and what it checks.
- [ ] `DECISIONS.md` entries for the rulings of Tasks 1 to 5, Proposed.
- [ ] `HITL_STATUS.md`: Phase 8 built; the CP3 row lists what the owner must decide; prerequisites 2 to 4 closed with commits; record the owner's "continue" of 2026-10-25 as permission to start Phase 8, not as approval of D-060 to D-075.
- [ ] The final whole-branch review (Opus), one fix wave, then stop at CP3.
