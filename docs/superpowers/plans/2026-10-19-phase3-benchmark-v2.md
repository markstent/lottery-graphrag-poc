# Benchmark v2 (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 30-question benchmark with bank 2.0.0, claim-carrier evidence scoring, improved deterministic answer scoring, a blinded versioned LLM judge, clustered paired statistics with generated headline sentences, and a three-seed harness, then run a scorer smoke test and a small real-model pilot.

**Architecture:** Everything lives in the evaluator-only package `backend/app/evaluation`, which may import retrieval and graph code but is never imported by them.
Logical questions are data in `bank.py`; `grounding.py` instantiates them per world from Parquet and the truth ledger into a frozen, hashed bank file; `runner.py` executes A, B and C with repeats and scores each repeat; `judge.py`, `statistics.py` and `report.py` turn results into `summary.json`, the only source the API publishes.
Model access for the judge and the generator goes through one gateway module, `backend/app/models/gateway.py`.

**Tech Stack:** Python 3.12, DuckDB over Parquet, LiteLLM through the gateway, scipy (Wilcoxon only), pytest, ruff, mypy.

**Spec:** `docs/superpowers/specs/2026-10-18-overhaul-design.md` sections 5.5, 5.6, 9 and 10a (1, 3, 5, 6, 7).
Phase 2 decisions D-021 to D-028 in `DECISIONS.md` are binding; this plan does not change retrieval behaviour.

## Global Constraints

- Never use the real employer name or the codename AGENTS.md bans, anywhere.
- The truth ledger is evaluator-only: `app.retrieval`, `app.graph`, `app.ontology`, `app.datasets`, `app.scenarios` and `app.api` never import `app.evaluation` (the isolation test stays green; 10a.1's API exception arrives in Phase 4).
- Bank version string: `BANK_VERSION = "2.0.0"`; scorer version `SCORER_VERSION = "2.0.0"`; judge prompt version `JUDGE_PROMPT_VERSION = "1.0.0"`.
- Target 90 to 150 paired observations across three world seeds, at least 20 per hypothesis stratum (spec 5.5).
- Official runs use the dev profile on world seeds 2026, 2027, 2028, sequentially regenerated, re-ingested and re-indexed per world (10a.6); headline cells use depth 2 (10a.7).
- Question anchors are excluded from required and retrieved evidence; anchor resolution is a separate metric (spec 5.5).
- Three generation repeats per cell with a real model (spec 5.5); retrieval must be identical across repeats.
- The judge is a different model family from the generator; pipeline identity stripped, block order randomised, answer length capped; judge scores sit beside deterministic scores with their agreement rate and never replace them (spec 5.5).
- Paired bootstrap 95 percent intervals clustered by logical question and world; Wilcoxon signed-rank p-values with Holm correction across the hypothesis family (spec 5.5).
- The fake-generator run is labelled "scorer smoke test" and is never shown as a result (spec 5.5).
- `summary.json` is the only source the API publishes; the frontend never recomputes a score (spec 5.5).
- `RECORD_SERIALISER_VERSION` stays "2.1.0"; any serialiser change after grounding invalidates frozen banks.
- No generated data is committed (`data/`); `docs/evaluation/question-bank.md` is a generated file and is only ever written by its CLI.
- Lean code: no abstraction with one implementation unless it isolates an external dependency or a test seam (AGENTS.md).
- Markdown: British spelling, one sentence per line, no em dashes; commit messages carry no co-author line (owner rule).

## Review Focus

1. Grounding the same world twice must give a byte-identical frozen bank, including anchor choice and carrier sets: test `test_frozen_bank_is_byte_identical_across_groundings` in Task 6.
2. An answer that states the authoritative price and also the stale document price (SCN-015) must score 0.5, not 1.0: test `test_number_check_penalises_a_contradictory_number` in Task 2.
3. A judge reply that is not valid JSON or carries an out-of-range score is recorded as a judge failure, never as a zero and never a crash: test `test_malformed_judge_reply_is_a_recorded_failure` in Task 8.
4. A stratum or comparison with fewer than 10 pairs yields "too few pairs to say" and is excluded from the Holm family: test `test_small_strata_make_no_claim` in Task 10.
5. A frozen bank built from another world, bank version or serialiser version is refused before any question runs: test `test_runner_refuses_a_bank_from_another_world` in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/models/gateway.py` (create) | One completion call through LiteLLM with typed request, result and error |
| `backend/app/evaluation/checks.py` (create) | Answer checks (number, set, token, verdict), answer score, citation metrics |
| `backend/app/evaluation/claims.py` (create) | `Claim`, carrier computation over record blocks and chunks, anchor exclusion |
| `backend/app/evaluation/scoring.py` (rewrite) | Evidence metrics over claims, anchor resolution, efficiency, failure class |
| `backend/app/evaluation/bank.py` (rewrite) | The 22 logical questions of bank 2.0.0 and stratum constants |
| `backend/app/evaluation/grounding.py` (rewrite) | Per-question grounders, anchor eligibility and sampling, frozen bank file |
| `backend/app/evaluation/runner.py` (rewrite) | Run kinds, repeats, per-repeat scoring, reproducibility record |
| `backend/app/evaluation/judge.py` (create) | Judge prompt, blinding, parsing, fake and gateway judges, agreement |
| `backend/app/evaluation/statistics.py` (create) | Clustered paired bootstrap, Wilcoxon, Holm, headline sentence |
| `backend/app/evaluation/report.py` (rewrite) | `summary.json` v2 and `report.md` |
| `backend/app/evaluation/official.py` (create) | Three-seed orchestration, depth sweep, model comparison |
| `backend/app/evaluation/__main__.py` (rewrite) | CLI: `ground`, `run`, `sweep`, `compare`, `bank-doc` |

`truth_ledger.py` keeps its shape and gains nothing.

---

### Task 1: One model gateway

**Files:**
- Create: `backend/app/models/gateway.py`
- Modify: `backend/app/retrieval/standard/generation.py` (`LiteLLMAnswerGenerator` uses the gateway)
- Test: `backend/tests/test_gateway.py`, `backend/tests/test_generation_v2.py`

**Interfaces:**
- Produces: `CompletionRequest(model: str, system: str, user: str, temperature: float, max_tokens: int, api_base: str | None, timeout_s: float)` frozen dataclass; `Completion(text: str, latency_ms: float, usage: dict[str, int] | None)`; `class GatewayError(RuntimeError)`; `complete(request: CompletionRequest) -> Completion` (lazy `import litellm`, raises `GatewayError` on any provider exception or empty content).
- `LiteLLMAnswerGenerator.generate` builds a `CompletionRequest`, calls `complete`, and maps `GatewayError` to `GenerationError` with the original as cause; behaviour and tests of Task 9 of Phase 2 are otherwise unchanged.

- [ ] **Step 1: Write the failing tests**

```python
def test_complete_returns_text_usage_and_latency(stub_litellm) -> None:
    result = complete(CompletionRequest("m", "sys", "user", 0.0, 50, None, 5.0))
    assert result.text == "ok" and result.usage == {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}
    assert stub_litellm.calls[0]["max_tokens"] == 50 and stub_litellm.calls[0]["messages"][0] == {"role": "system", "content": "sys"}

def test_complete_raises_gateway_error_on_empty_content(stub_litellm_empty) -> None:
    with pytest.raises(GatewayError):
        complete(CompletionRequest("m", "s", "u", 0.0, 50, None, 5.0))

def test_generator_maps_gateway_errors_to_generation_errors(stub_litellm_raises) -> None:
    with pytest.raises(GenerationError):
        LiteLLMAnswerGenerator(model="m").generate("q", [])
```

The stubs replace `sys.modules["litellm"]` as the existing `test_generation_v2` stub does; move that stub into a shared fixture in `backend/tests/conftest.py`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_gateway.py -v`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `complete` and switch the generator to it**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_gateway.py tests/test_generation_v2.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models backend/app/retrieval/standard/generation.py backend/tests
git commit -m "refactor(models): one completion gateway shared by generation and the judge"
```

---

### Task 2: Answer checks and citation metrics

**Files:**
- Create: `backend/app/evaluation/checks.py`
- Test: `backend/tests/test_checks.py`

**Interfaces:**
- Produces:
  - `NumberCheck(value: str, unit: str | None)`; `SetCheck(expected: frozenset[str], universe: Mapping[str, tuple[str, ...]])`; `TokenCheck(expected: str, aliases: tuple[str, ...] = ())`; `VerdictCheck(expected: Literal["yes", "no"])`; `Check = NumberCheck | SetCheck | TokenCheck | VerdictCheck`; all frozen dataclasses with `to_payload() -> dict[str, object]` and `check_from_payload(payload) -> Check`.
  - `check_score(check: Check, verdict: str, answer: str) -> float` and `answer_score(checks: Sequence[Check], verdict: str, answer: str) -> float | None` (mean; None when no checks).
  - `scored_numbers(text: str) -> list[str]` (normalised numbers after removing citation markers, identifiers and ISO dates).
  - `citation_metrics(answer: str, cited_blocks: Sequence[int], block_carriers: Sequence[frozenset[str]], claims: Sequence[Claim]) -> CitationMetrics(accuracy: float | None, numeric_citation_rate: float | None)` (Claim from Task 3; import under `TYPE_CHECKING` only if Task 3 lands later, otherwise import directly).

Rules the tests pin:
- Number, set and token checks read `verdict + "\n" + answer` (a fact stated only in the verdict counts); `VerdictCheck` reads the verdict only: it passes when the casefolded verdict starts with the expected word.
- `scored_numbers` removes `\[\d+(?:\s*,\s*\d+)*\]`, identifiers `\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b` and dates `\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+)?` before extracting `\d+(?:[.,]\d+)?`; normalisation is the v1 `_normalise_number`.
- `NumberCheck`: candidates are numbers adjacent (immediately before or after, ignoring one space) to the unit code or its symbol (`GBP` "£", `EUR` "€", `CZK` "Kč", `%` "%"); when no unit-adjacent number exists, every scored number is a candidate. Score 1.0 when the expected value is a candidate and no other distinct candidate exists, 0.5 when the expected value and another distinct candidate both appear, 0.0 otherwise.
- `SetCheck`: an id is mentioned when the id or any of its aliases occurs as a whole word (case-insensitive); predicted = universe ids mentioned; score is F1 of predicted against expected (0.0 when nothing predicted).
- `TokenCheck`: 1.0 when the expected id or an alias occurs as a whole word, else 0.0.
- Citation accuracy = cited blocks whose carriers intersect any claim's carriers / cited blocks (None when no citation or no claims); numeric citation rate = answer sentences (split on `(?<=[.!?])\s+`) containing a scored number that also contain a citation marker / sentences containing a scored number (None when none).

- [ ] **Step 1: Write the failing tests**

```python
def test_number_check_reads_the_unit_adjacent_value() -> None:
    assert check_score(NumberCheck("2.5", "GBP"), "", "It costs £2.50 per line [1].") == 1.0

def test_number_check_penalises_a_contradictory_number() -> None:
    answer = "The price is 2.50 GBP [1]; the rules document still says 3.00 GBP [2]."
    assert check_score(NumberCheck("2.5", "GBP"), "", answer) == 0.5

def test_identifiers_dates_and_citations_are_not_numbers() -> None:
    assert scored_numbers("GAME_UK_01 on 2025-06-30 [3] costs 2.50") == ["2.5"]

def test_set_check_is_f1_against_the_universe() -> None:
    universe = {"MKT_GR": ("Greece",), "MKT_AT": ("Austria",), "MKT_CZ": ("Czech Republic",)}
    check = SetCheck(frozenset({"MKT_GR", "MKT_AT"}), universe)
    assert check_score(check, "", "Greece and the Czech Republic.") == pytest.approx(0.5)

def test_fact_in_the_verdict_counts() -> None:
    assert check_score(TokenCheck("PLV_PAYMENTS_3"), "PLV_PAYMENTS_3", "See the incident report.") == 1.0

def test_verdict_check_reads_the_verdict_only() -> None:
    assert check_score(VerdictCheck("yes"), "Yes, it is digital.", "no") == 1.0
    assert check_score(VerdictCheck("yes"), "unknown", "yes") == 0.0

def test_citation_metrics() -> None:
    claims = [Claim("c1", "price", frozenset({"REC_A"}))]
    metrics = citation_metrics("Price 2.50 [1]. Other 7 items.", [1, 2], [frozenset({"REC_A"}), frozenset({"X"})], claims)
    assert metrics.accuracy == 0.5 and metrics.numeric_citation_rate == 0.5

def test_check_payload_round_trip() -> None:
    check = SetCheck(frozenset({"MKT_GR"}), {"MKT_GR": ("Greece",)})
    assert check_from_payload(check.to_payload()) == check
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_checks.py -v`
Expected: FAIL

- [ ] **Step 3: Implement `checks.py`**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_checks.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation/checks.py backend/tests/test_checks.py
git commit -m "feat(evaluation): number, set, token and verdict checks with citation metrics"
```

---

### Task 3: Claims, carriers and evidence metrics

**Files:**
- Create: `backend/app/evaluation/claims.py`
- Rewrite: `backend/app/evaluation/scoring.py`
- Test: `backend/tests/test_claims.py`, `backend/tests/test_benchmark_scoring.py`

**Interfaces:**
- Produces:
  - `Claim(claim_id: str, statement: str, carriers: frozenset[str])` with `to_payload()` and `claim_from_payload()`.
  - `ClaimSpec(claim_id: str, statement: str, record_ids: tuple[str, ...], markers: tuple[tuple[str, ...], ...], document_ids: tuple[str, ...] = ())`: what a grounder declares.
  - `class CarrierIndex`: built once per world by `CarrierIndex.build(world_dir: Path)` from `serialise_records(world_dir)` (record id to block text) and `document_chunks.parquet` (chunk id to text and document id); `carriers(spec: ClaimSpec) -> frozenset[str]` = `record_ids` ∪ ids of `document_ids`' chunks ∪ every record id and chunk id whose text matches every marker group (a group matches when any alternative occurs as a whole word, casefold).
  - `exclude_anchor(claims: Sequence[Claim], anchor_id: str) -> tuple[Claim, ...]`: removes the anchor id from every carrier set and drops claims left with no carrier.
  - `selection_carrier(kind: str, chunk_id: str, document_id: str) -> str`: record → `document_id` (the record id), node → `chunk_id` (the node id), chunk → `chunk_id`.
  - `EvidenceScore(recall, precision, f1, claims_found, claims_total, efficiency_per_1k, anchor_resolved)`; `evidence_score(claims: Sequence[Claim], selected: Sequence[str], anchor_id: str, resolved_ids: Sequence[str], context_tokens: int) -> EvidenceScore`.
  - `classify_failure(answer: float | None, evidence: EvidenceScore, seeded: bool) -> str | None` (v1 classes: `entity_resolution_failure`, `retrieval_failure`, `generation_failure`; threshold 0.5).

Rules the tests pin:
- `selected` is the pipeline's selected carriers in selection order; the anchor id is removed from it before precision.
- recall = found / total; precision = selected items carrying at least one claim / selected items; f1 = harmonic mean (0.0 when both are 0); all evidence fields None when no claim survives anchor exclusion.
- efficiency = claims found per 1,000 context tokens (None when `context_tokens` is 0).
- `anchor_resolved` = the anchor id is among the selected carriers or the resolved entity ids (pipeline A has no resolved ids; documented as definitional).

- [ ] **Step 1: Write the failing tests**

```python
def test_carriers_include_records_and_chunks_that_state_the_fact(carrier_index) -> None:
    spec = ClaimSpec("c1", "INC_X ran on PLV_Y", ("INC_X",), (("INC_X",), ("PLV_Y",)))
    assert carrier_index.carriers(spec) == frozenset({"INC_X", "CHNK_0001_00"})

def test_anchor_exclusion_drops_claims_carried_only_by_the_anchor() -> None:
    claims = (Claim("a", "s", frozenset({"GAME_UK_01"})), Claim("b", "s", frozenset({"GAME_UK_01", "CHNK_1"})))
    assert exclude_anchor(claims, "GAME_UK_01") == (Claim("b", "s", frozenset({"CHNK_1"})),)

def test_evidence_score_excludes_the_anchor_and_scores_discoveries() -> None:
    claims = (Claim("a", "s", frozenset({"INC_2"})), Claim("b", "s", frozenset({"INC_3"})))
    score = evidence_score(claims, ["INC_1", "INC_2", "DOC_9"], anchor_id="INC_1", resolved_ids=["INC_1"], context_tokens=500)
    assert (score.recall, score.precision, score.claims_found, score.efficiency_per_1k, score.anchor_resolved) == (0.5, 0.5, 1, 2.0, True)

def test_no_surviving_claim_means_no_evidence_score() -> None:
    score = evidence_score((), ["X"], anchor_id="X", resolved_ids=[], context_tokens=10)
    assert score.recall is None and score.f1 is None and score.anchor_resolved is True
```

`carrier_index` builds a two-record, one-chunk world in `tmp_path` with the real Parquet layout (reuse the tiny-world builder from `test_benchmark_grounding.py` if it is cheaper; otherwise write the three Parquet files directly).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_claims.py tests/test_benchmark_scoring.py -v`
Expected: FAIL

- [ ] **Step 3: Implement `claims.py` and rewrite `scoring.py`; retire the v1 harness in the same commit**

The v1 `grounding.py`, `runner.py`, `report.py` and `__main__.py` import the v1 scoring functions and bank, so they are deleted here together with `test_benchmark_grounding.py`, `test_benchmark_live.py`, the v1 parts of `test_benchmark_scoring.py`, and the `run-benchmark` Makefile target.
Tasks 5 to 11 create their v2 replacements; between Task 3 and Task 11 the repository has no runnable benchmark, and every remaining test stays green.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_claims.py tests/test_benchmark_scoring.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation backend/tests
git commit -m "feat(evaluation): claim carriers, anchor exclusion and evidence metrics over discoveries"
```

---

### Task 4: Bank 2.0.0 logical questions

**Files:**
- Rewrite: `backend/app/evaluation/bank.py`
- Test: `backend/tests/test_benchmark_bank.py`

**Interfaces:**
- Produces:
  - `BANK_VERSION = "2.0.0"`, `ANCHORS_PER_QUESTION = 3`.
  - `STRATA: dict[str, str]` = `{"H1": "multi-hop questions", "H2": "ontology-dependent questions", "H3": "single facts", "H5": "planted patterns"}`; `NAME_ANCHORED = "entity resolution through the ontology"` (the H2 name-anchored sub-stratum label).
  - `LogicalQuestion(question_id: str, stratum: str, sub_stratum: str | None, template: str, tests: str, anchor_kind: str, scenario_id: str | None, ontology_dependent: bool)`; `BANK: tuple[LogicalQuestion, ...]`; `question_by_id(question_id: str) -> LogicalQuestion`.
  - `sub_stratum` is `"id_anchored"` or `"name_anchored"` for H2 and None elsewhere.
- H4 (citations, explainability), H6 (latency, context efficiency) and H7 (model size) are metrics or run kinds over every question, not question strata.

The bank (template placeholders: `{anchor}` for an id, `{anchor_name}` for a local-language name):

| Id | Stratum | Template | Tests (one sentence) | Anchor kind | Scenario | Ontology |
|---|---|---|---|---|---|---|
| L01 | H3 | What is the ticket price of game {anchor}? | Reads one price from one record. | game | | no |
| L02 | H3 | Which platform version was incident {anchor} seen on? | Reads one link from one record. | incident | | no |
| L03 | H3 | When does campaign {anchor} end? | Reads one date from one record. | campaign | | no |
| L04 | H3 | Is game {anchor} available on digital channels? | Reads one flag and answers yes or no. | game | | no |
| L05 | H1 | Which other markets had incidents on the same platform version as incident {anchor}? | Follows incident to version to other incidents. | incident | | no |
| L06 | H1 | Which game mechanics do the games affected by incident {anchor} use? | Follows incident to games to mechanics. | incident | | no |
| L07 | H1 | Which platform version is behind the incident linked to support case {anchor}? | Follows case to incident to version. | support_case | | no |
| L08 | H1 | Which games were affected by incidents on platform version {anchor}? | Follows version to incidents to games. | platform_version | | no |
| L09 | H2 id | Which games in other markets belong to the same kind of game family as game {anchor}? | Needs family equivalence across markets. | game | | yes |
| L10 | H2 id | Which incidents in other markets are the same kind of incident as incident {anchor}? | Needs incident-type equivalence across markets. | incident | | yes |
| L11 | H2 id | Which player segments in other markets correspond to segment {anchor}? | Needs segment equivalence across markets. | segment | | yes |
| L12 | H2 id | Which games in other markets use the same kind of mechanic as the main mechanic of game {anchor}? | Needs mechanic equivalence across markets. | game | | yes |
| L13 | H2 name | Which games, in any market, belong to the kind of game family called "{anchor_name}"? | Needs a local-language family name resolved to a concept. | family | | yes |
| L14 | H2 name | Which games, in any market, use the kind of mechanic called "{anchor_name}"? | Needs a local-language mechanic name resolved to a concept. | mechanic | | yes |
| L15 | H5 | What caused incident {anchor}? | Finds the app release behind a checkout failure. | incident | SCN-001 | no |
| L16 | H5 | Which other players share a device with player {anchor}? | Finds a shared-device cluster. | player | SCN-002 | no |
| L17 | H5 | Which other accounts share a payment instrument with player {anchor}? | Finds a shared-payment cluster. | player | SCN-003 | no |
| L18 | H5 | Which other markets saw incidents on the same platform version as incident {anchor}, and which market was unaffected? | Finds a cross-market incident and its exception. | incident | SCN-007 | no |
| L19 | H5 | Which payment provider is behind support case {anchor}, and which markets are affected? | Finds a degraded provider behind support cases. | support_case | SCN-009 | no |
| L20 | H5 | Which games in other markets show the same mechanic affinity as game {anchor}? | Finds a planted cross-market mechanic affinity. | game | SCN-010 | yes |
| L21 | H5 | Which game in another market is the best transfer target for campaign {anchor}? | Finds a planted transferable campaign. | campaign | SCN-011 | yes |
| L22 | H5 | What is the current ticket price of game {anchor}, and is the rules document that states a different price still valid? | Prefers the record over a stale document. | game | SCN-015 | no |

Observation count at three anchors per structural question and one per planted question per world: H3 36, H1 36, H2 id-anchored 36, H2 name-anchored 18, H5 24, total 150.

- [ ] **Step 1: Write the failing tests**

```python
def test_bank_shape() -> None:
    assert BANK_VERSION == "2.0.0" and len(BANK) == 22
    assert len({q.question_id for q in BANK}) == 22
    counts = Counter((q.stratum, q.sub_stratum) for q in BANK)
    assert counts == {("H3", None): 4, ("H1", None): 4, ("H2", "id_anchored"): 4, ("H2", "name_anchored"): 2, ("H5", None): 8}

def test_templates_carry_exactly_one_anchor_slot() -> None:
    for q in BANK:
        slots = q.template.count("{anchor}") + q.template.count("{anchor_name}")
        assert slots == 1, q.question_id

def test_planted_questions_name_catalogued_scenarios() -> None:
    planted = {q.scenario_id for q in BANK if q.stratum == "H5"}
    assert planted == {"SCN-001", "SCN-002", "SCN-003", "SCN-007", "SCN-009", "SCN-010", "SCN-011", "SCN-015"}
    assert planted <= {spec.scenario_id for spec in SCENARIO_CATALOGUE}
```

Check the catalogue's exported name in `app/scenarios/catalogue.py` and use it.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_benchmark_bank.py -v`
Expected: FAIL

- [ ] **Step 3: Rewrite `bank.py` with the table above verbatim; remove `CATEGORY_DIFFICULTY`, `profile`, `binding_key` and every v1 question**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_benchmark_bank.py -q`
Expected: PASS, and the full suite stays green (the v1 harness was retired in Task 3)

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation/bank.py backend/tests
git commit -m "feat(evaluation): bank 2.0.0 logical questions in four strata"
```

---

### Task 5: Grounding the structural questions (H1, H2, H3)

**Files:**
- Create: `backend/app/evaluation/grounding.py` (v2)
- Test: `backend/tests/test_benchmark_grounding.py`

**Interfaces:**
- Consumes: `LogicalQuestion` (Task 4), `ClaimSpec`, `CarrierIndex`, `exclude_anchor` (Task 3), the checks (Task 2), `load_ontology()`, `local_name_variants()`.
- Produces:
  - `BankInstance(instance_id: str, question_id: str, stratum: str, sub_stratum: str | None, ontology_dependent: bool, world_seed: int, anchor_id: str, text: str, expected_answer: str, checks: tuple[Check, ...], claims: tuple[Claim, ...])` with `to_payload()` / `instance_from_payload()`; `instance_id = f"{question_id}-{world_seed}-{anchor_id}"`.
  - `class WorldGrounding(world_dir: Path, ledger_path: Path)` with `ground(question: LogicalQuestion) -> GroundingOutcome(instances: tuple[BankInstance, ...], eligible: int, note: str)` and `close()`.
  - `sample_anchors(question_id: str, eligible: Sequence[str], k: int = ANCHORS_PER_QUESTION) -> list[str]`: sort by `sha256(f"{BANK_VERSION}:{question_id}:{anchor}")` hex digest, take the first `k`.
  - `class GroundingError(RuntimeError)`.

Grounding rules (eligibility before sampling; every set must have between 1 and 6 members after excluding the anchor unless stated):
- L01: games; `NumberCheck(price, currency_code)`; claim "price of {game} is {price} {currency}" with markers `((game_id, game_name), price variants)` where price variants are the two-decimal and the shortest forms ("2.50", "2.5").
- L02: incidents with a platform version; `TokenCheck(platform_version_id)`; claim markers `((incident_id,), (platform_version_id,))`, record ids `(incident_id,)`.
- L03: campaigns with an `end_at`; `TokenCheck(end date as YYYY-MM-DD)`; claim markers `((campaign_id, campaign_name), (date,))`.
- L04: games; `VerdictCheck("yes" if digital_enabled else "no")`; claim markers `((game_id, game_name), ("digital",))`.
- L05: incidents whose platform version has incidents in other markets; `SetCheck(other markets, universe = all markets with their names)`; one claim per other incident (record ids `(incident,)`, markers `((incident,), (platform_version_id,))`).
- L06: incidents affecting 1 to 4 games whose mechanics total 1 to 6; `SetCheck(mechanic ids, universe = all mechanics with code and local description)`; one claim per (game, mechanic) from `game_mechanic_map` valid on the incident start date (record ids `(game,)`, markers `((game, game_name), (mechanic_id, mechanic_code))`) plus one claim per affected game (record ids `(incident,)` markers `((incident,), (game,))`).
- L07: support cases with an incident whose platform version is set; `TokenCheck(platform_version_id)`; claims: case links incident (record `(support_case,)`), incident runs on version (record `(incident,)`).
- L08: platform versions with incidents affecting 1 to 6 games; `SetCheck(games, universe = all games with names)`; one claim per (incident, game) (record `(incident,)`, markers `((incident,), (game, game_name))`).
- L09: games whose family concept has families in other markets with 1 to 6 games; `SetCheck(other-market games)`; one claim per game (record `(game,)`, markers `((game, game_name), (family_id, family_name))`).
- L10: incidents whose incident-type concept has 1 to 6 incidents in other markets; `SetCheck(incidents, universe = all incidents)`; one claim per incident (record `(incident,)`, markers `((incident,), (incident_type,))`).
- L11: segments whose concept binds segments in 1 to 3 other markets; `SetCheck(segments, universe = all segments with names)`; one claim per segment, record ids none, markers `((segment_id, segment_name),)`.
- L12: games whose highest-weight mechanic (ties by mechanic id) maps to a concept with 1 to 6 games in other markets; `SetCheck(games)`; one claim per game (record `(game,)`, markers `((game, game_name), (mechanic_id, mechanic_code))`).
- L13: family codes whose concept binds families in at least two markets with 2 to 6 games in total; `anchor_id` = family code, `anchor_name` = its local name; `SetCheck(games in every bound family)`; one claim per game (record `(game,)`, markers `((game, game_name), (family_id, family_name))`).
- L14: mechanic ids whose concept has 2 to 6 games across markets; `anchor_name` = the mechanic's local description; claims as L12.
- Every instance's claims pass through `exclude_anchor`; an H1 or H2 instance left with no claim is ineligible (it cannot score discoveries); an H3 instance may have none.
- `expected_answer` is one plain English sentence naming the answer ids, for example "The ticket price of GAME_UK_01 is 2.50 GBP."
- The ontology equivalence for L09 to L14 comes from `load_ontology()` bindings (kind, code to concept); the grounding never reads Neo4j.

- [ ] **Step 1: Write the failing tests** (tiny world fixture from the existing file, plus the dev world when `data/generated/dev-seed2026` exists, skipped otherwise)

```python
def test_structural_questions_ground_with_sampled_anchors(grounding) -> None:
    outcome = grounding.ground(question_by_id("L01"))
    assert 1 <= len(outcome.instances) <= ANCHORS_PER_QUESTION
    assert all("{" not in instance.text for instance in outcome.instances)

def test_anchor_sampling_is_a_stable_hash_order() -> None:
    assert sample_anchors("L01", ["GAME_B", "GAME_A", "GAME_C"]) == sample_anchors("L01", ["GAME_C", "GAME_A", "GAME_B"])

def test_h1_and_h2_instances_score_discoveries_only(grounding) -> None:
    for qid in ("L05", "L06", "L07", "L08", "L09", "L10", "L11", "L12", "L13", "L14"):
        for instance in grounding.ground(question_by_id(qid)).instances:
            assert instance.claims, instance.instance_id
            assert all(instance.anchor_id not in claim.carriers for claim in instance.claims)

def test_name_anchored_text_carries_a_local_name(grounding) -> None:
    instance = grounding.ground(question_by_id("L13")).instances[0]
    assert instance.anchor_id.startswith("FAM_") and instance.anchor_id not in instance.text

@dev_world
def test_dev_world_meets_the_structural_counts(dev_grounding) -> None:
    counts = Counter(i.question_id for q in BANK if q.stratum != "H5" for i in dev_grounding.ground(q).instances)
    assert all(counts[q.question_id] == ANCHORS_PER_QUESTION for q in BANK if q.stratum != "H5")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_benchmark_grounding.py -v`
Expected: FAIL

- [ ] **Step 3: Implement the structural grounders; one small function per question, sharing query helpers; delete every v1 rule**

If the dev world gives fewer than three eligible anchors for a question, report it with the counts (status DONE_WITH_CONCERNS); never widen a bound silently.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_benchmark_grounding.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation/grounding.py backend/tests/test_benchmark_grounding.py
git commit -m "feat(evaluation): ground structural bank questions with hashed anchor sampling"
```

---

### Task 6: Grounding the planted questions and the frozen bank

**Files:**
- Modify: `backend/app/evaluation/grounding.py`
- Create: `backend/app/evaluation/__main__.py` (v2) (subcommands `ground` and `bank-doc`)
- Test: `backend/tests/test_benchmark_grounding.py`

**Interfaces:**
- Produces:
  - Planted grounders for L15 to L22, one instance per world, anchors and answers from the ledger only.
  - `FrozenBank(bank_version: str, world_seed: int, world_manifest_hash: str, record_serialiser_version: str, ledger_hash: str, instances: tuple[BankInstance, ...], unavailable: tuple[Unavailable, ...], bank_hash: str)`; `Unavailable(question_id: str, reason: str)`.
  - `freeze_bank(world_dir: Path, ledger_path: Path) -> FrozenBank`; `write_frozen_bank(bank: FrozenBank, path: Path) -> None` (canonical JSON: sorted keys, two-space indent, trailing newline); `load_frozen_bank(path: Path) -> FrozenBank` (recomputes and verifies `bank_hash`).
  - `bank_hash` = sha256 of the canonical JSON of everything except `bank_hash`; `world_manifest_hash` = sha256 of `_manifest.json` bytes; `ledger_hash` = sha256 of the ledger bytes.
  - CLI: `python -m app.evaluation ground --world DIR --ledger PATH --out PATH`; `python -m app.evaluation bank-doc --bank PATH --out ../docs/evaluation/question-bank.md`.

Planted rules (truth keys are those the v2 ledger already writes):
- Claims for every planted question: one per ledger `required_evidence` item that is not the anchor and does not start with `kpi:`; a `DOC_` item's carriers are that document's chunks; every other item's carriers are the record id plus records and chunks matching markers `((item,),)`; then `exclude_anchor`.
- L15: anchor `truth.incident_id`; `TokenCheck(truth.app_version_id)`.
- L16: anchor = first of sorted `truth.cluster_players`; `SetCheck(other cluster players, universe = cluster players plus every player id in the shared devices' links)`.
- L17: as L16 with SCN-003.
- L18: anchor = the planted incident in `truth.primary_market` (first by id among `truth.planted_ids` incidents); `SetCheck(truth.related_markets, markets)` and `TokenCheck(first of truth.unaffected_markets)`.
- L19: anchor = first planted support case by id; `TokenCheck(truth.provider_id)` and `SetCheck(truth.affected_markets, markets)`.
- L20: anchor = first of sorted planted games in `truth.per_market` excluding the control market; `SetCheck(the other planted games, all games)`.
- L21: anchor `truth.source_campaign_id`; `TokenCheck(truth.target_game_id)`.
- L22: anchor = the scenario's game (first of `affected_games`); `NumberCheck(truth.authoritative_price, the game's currency)`.
- A scenario absent from the ledger yields `Unavailable(question_id, "scenario not planted")`; a structural question with no eligible anchor yields `Unavailable(question_id, "no eligible anchor")`.
- `bank-doc` writes a Markdown page marked as generated at the top ("Generated by `python -m app.evaluation bank-doc`; do not edit."), with one section per stratum listing each logical question, what it tests, and for each instance of the given bank the question text and expected answer; one sentence per line; no em dashes.

- [ ] **Step 1: Write the failing tests**

```python
@dev_world
def test_planted_questions_ground_one_instance_per_scenario(dev_grounding) -> None:
    for q in (q for q in BANK if q.stratum == "H5"):
        outcome = dev_grounding.ground(q)
        assert len(outcome.instances) == 1 and outcome.instances[0].claims, q.question_id

@dev_world
def test_scn015_expects_the_authoritative_price(dev_grounding, dev_ledger) -> None:
    truth = scenario(dev_ledger, "SCN-015").truth
    check = dev_grounding.ground(question_by_id("L22")).instances[0].checks[0]
    assert isinstance(check, NumberCheck) and check.value == normalise(truth["authoritative_price"])

def test_frozen_bank_is_byte_identical_across_groundings(tiny_dataset, tiny_ledger, tmp_path) -> None:
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), tmp_path / "a.json")
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), tmp_path / "b.json")
    assert (tmp_path / "a.json").read_bytes() == (tmp_path / "b.json").read_bytes()

def test_loading_a_tampered_bank_fails(tiny_dataset, tiny_ledger, tmp_path) -> None:
    path = tmp_path / "bank.json"
    write_frozen_bank(freeze_bank(tiny_dataset, tiny_ledger), path)
    path.write_text(path.read_text().replace("L01", "L99", 1))
    with pytest.raises(GroundingError):
        load_frozen_bank(path)

def test_unplanted_scenarios_are_reported_not_invented(tiny_dataset, tiny_ledger) -> None:
    bank = freeze_bank(tiny_dataset, tiny_ledger)
    planted = {i.question_id for i in bank.instances}
    assert all(u.question_id not in planted for u in bank.unavailable)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_benchmark_grounding.py -v`
Expected: FAIL

- [ ] **Step 3: Implement the planted grounders, freezing, the two CLI subcommands**

- [ ] **Step 4: Run tests, then ground the dev world**

Run: `cd backend && uv run pytest tests/test_benchmark_grounding.py -q && uv run python -m app.evaluation ground --world ../data/generated/dev-seed2026 --ledger ../data/truth/ledger.json --out ../data/evaluation/bank/bank-2.0.0-seed2026.json`
Expected: PASS; the CLI prints the instance count per stratum (H3 12, H1 12, H2 12 id plus 6 name, H5 8 for one world) and any unavailable questions.

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation backend/tests
git commit -m "feat(evaluation): planted bank questions from the ledger and a hashed frozen bank"
```

---

### Task 7: Runner v2 with repeats and per-repeat scoring

**Files:**
- Create: `backend/app/evaluation/runner.py` (v2)
- Modify: `backend/app/config/__init__.py` (`GenerationSettings.model_family: str | None`, env `GENERATION_MODEL_FAMILY`; `GenerationSettings.quantisation: str | None`, env `GENERATION_MODEL_QUANTISATION`), `.env.example`
- Test: `backend/tests/test_benchmark_runner.py` (create; move runner tests out of `test_benchmark_scoring.py`)

**Interfaces:**
- Consumes: `FrozenBank` and `load_frozen_bank` (Task 6), `evidence_score`, `classify_failure`, `selection_carrier` (Task 3), `answer_score`, `citation_metrics` (Task 2), `Lab`, `wired_pipelines`, `graph_pipelines`.
- Produces:
  - `RUN_KINDS = ("smoke", "official", "sweep")`; `SMOKE_LABEL = "scorer smoke test"`; `SCORER_VERSION = "2.0.0"`.
  - `ShownBlock(carrier_id: str, title: str, text: str)`.
  - `PipelineRun(pipeline: str, repeat: int, verdict: str, answer: str, raw_text: str, cited_blocks: tuple[int, ...], blocks: tuple[ShownBlock, ...], selected: tuple[str, ...], resolved_ids: tuple[str, ...], seeded: bool, context_tokens: int, latency_ms: float, generation_failed: bool)` with `to_payload()`.
  - `RunScore(answer: float | None, evidence: EvidenceScore, citations: CitationMetrics, failure_class: str | None, judge: JudgeVerdict | None = None)` (`JudgeVerdict` arrives in Task 8; until then the field holds None).
  - `InstanceResult(instance: BankInstance, runs: dict[str, list[PipelineRun]], scores: dict[str, list[RunScore]])`.
  - `WorldRun(world_seed: int, bank_hash: str, results: list[InstanceResult], unavailable: tuple[Unavailable, ...])`.
  - `BenchmarkRun(kind: str, label: str | None, record: ReproducibilityRecord, worlds: list[WorldRun])` with `to_payload()`.
  - `BenchmarkRunner(lab: Lab, graph_config: GraphConfig, bank: FrozenBank, world_dir: Path, kind: str, repeats: int, pipelines: tuple[str, ...] = ("A", "B", "C"), judge: Judge | None = None)` with `run(question_ids: Sequence[str] | None = None, limit: int | None = None) -> WorldRun`.
- `ReproducibilityRecord` keeps every Phase 2 field and adds `bank_version`, `bank_hash`, `scorer_version`, `prompt_hash` (sha256 of the v2 system prompt), `relationship_types_b`, `relationship_types_c`, `dedupe_threshold`, `generation_quantisation`, `generation_model_family`, `repeats`, `run_kind`, `judge_model`, `judge_model_family`, `judge_prompt_version`, `judge_prompt_hash` (judge fields None until Task 8 wires them).

Rules the tests pin:
- The runner refuses before any question runs when the frozen bank's `world_manifest_hash` differs from the world directory's manifest, its `bank_version` differs from `BANK_VERSION`, or its `record_serialiser_version` differs from the lab's index manifest (`GroundingError` with a message naming the mismatch).
- Each pipeline runs `repeats` times per instance; the selected carriers must be identical across repeats, otherwise the runner raises `RuntimeError("retrieval is not deterministic: ...")`.
- A `GenerationError` in one repeat is recorded (`generation_failed=True`, empty answer, scores None) and the run continues; any other exception fails the run.
- `kind == "smoke"` requires the fake generator and sets `label = SMOKE_LABEL`; `kind == "official"` refuses the fake generator, requires `repeats >= 3`, and requires `generation.model_family` to be set.
- Selected carriers are `selection_carrier(kind, chunk_id, document_id)` over the pipeline's selected evidence in selection order; `blocks` are the same items in prompt order with their titles and texts; `resolved_ids` are the ids from `graph.entity.resolved` events (empty for A).

- [ ] **Step 1: Write the failing tests** (static lab built like `test_lab_fairness.build_lab_offline`, fake generator, a two-instance frozen bank written in `tmp_path`)

```python
def test_runner_refuses_a_bank_from_another_world(tmp_path, offline_lab, bank_for_other_world) -> None:
    with pytest.raises(GroundingError, match="world manifest"):
        BenchmarkRunner(offline_lab, GRAPH, bank_for_other_world, world_dir=tmp_path, kind="smoke", repeats=1)

def test_each_repeat_is_recorded_and_scored(runner_smoke) -> None:
    world = runner_smoke.run()
    result = world.results[0]
    assert {tag: len(runs) for tag, runs in result.runs.items()} == {"A": 2, "B": 2, "C": 2}
    assert all(len(result.scores[tag]) == 2 for tag in ("A", "B", "C"))

def test_retrieval_must_not_change_between_repeats(runner_with_flaky_store) -> None:
    with pytest.raises(RuntimeError, match="not deterministic"):
        runner_with_flaky_store.run()

def test_a_generation_failure_is_recorded_not_fatal(runner_with_failing_generator) -> None:
    run = runner_with_failing_generator.run().results[0].runs["A"][0]
    assert run.generation_failed and run.answer == ""

def test_smoke_runs_are_labelled_and_official_runs_refuse_the_fake_generator(offline_lab, frozen_bank, world_dir) -> None:
    assert BenchmarkRunner(offline_lab, GRAPH, frozen_bank, world_dir, kind="smoke", repeats=1).label == SMOKE_LABEL
    with pytest.raises(ValueError, match="fake generator"):
        BenchmarkRunner(offline_lab, GRAPH, frozen_bank, world_dir, kind="official", repeats=3)

def test_reproducibility_record_names_the_bank_and_scorer(runner_smoke) -> None:
    payload = runner_smoke.record().to_payload()
    assert payload["bank_version"] == "2.0.0" and payload["scorer_version"] == "2.0.0" and payload["repeats"] == 2
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_benchmark_runner.py -v`
Expected: FAIL

- [ ] **Step 3: Implement the runner; delete the v1 `QuestionResult`, `_select_questions` and the v1 `BenchmarkRun.to_payload`**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_benchmark_runner.py tests/test_benchmark_scoring.py tests/test_truth_ledger_isolation.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation backend/app/config/__init__.py .env.example backend/tests
git commit -m "feat(evaluation): runner v2 with repeats, per-repeat scoring and bank checks"
```

---

### Task 8: The blinded LLM judge

**Files:**
- Create: `backend/app/evaluation/judge.py`
- Modify: `backend/app/evaluation/runner.py` (judge each successful repeat), `.env.example`
- Judge settings live in `judge.py`, not `app/config`, because only the evaluator reads them.
- Test: `backend/tests/test_judge.py`

**Interfaces:**
- Produces:
  - `JUDGE_PROMPT_VERSION = "1.0.0"`; `JUDGE_DIMENSIONS = ("correctness", "completeness", "faithfulness", "citation_accuracy", "abstention")`; `ANSWER_CHAR_CAP = 2400`; `JUDGE_MAX_TOKENS = 300`.
  - `JudgeSettings(provider: str, model: str, model_family: str | None, api_base: str | None, temperature: float)`; `judge_settings_from_env() -> JudgeSettings` (env `JUDGE_PROVIDER` default "fake", `JUDGE_MODEL` default "fake-judge-v1", `JUDGE_MODEL_FAMILY`, `JUDGE_API_BASE`, `JUDGE_TEMPERATURE` default 0).
  - `JudgeScores` (five ints 0 to 2); `JudgeVerdict(scores: JudgeScores | None, failure: str | None, model: str, latency_ms: float)`.
  - `class Judge(Protocol)`: `model_name: str`; `judge(item: JudgeItem) -> JudgeVerdict`. Implementations: `FakeJudge`, `GatewayJudge(settings)`. (Two real implementations: the protocol is warranted.)
  - `JudgeItem(question: str, expected_answer: str, claim_statements: tuple[str, ...], blocks: tuple[ShownBlock, ...], answer: str, cited_blocks: tuple[int, ...], blind_seed: str)`.
  - `blind(item: JudgeItem) -> tuple[list[ShownBlock], str]`: shuffles blocks with `random.Random(int(sha256(blind_seed).hexdigest()[:16], 16))`, renumbers them from 1, rewrites every `[n]` and `[n, m]` marker in the answer to the new numbers (citations to unshown blocks become `[?]`), and truncates the answer to `ANSWER_CHAR_CAP` characters with " [truncated]" appended when cut.
  - `build_judge_prompt(item: JudgeItem) -> tuple[str, str]` (system, user); `JUDGE_SYSTEM_PROMPT` asks for exactly one JSON object with the five integer fields, each 0, 1 or 2, using a fixed rubric (0 wrong or absent, 1 partly, 2 fully) per dimension; abstention scores 2 when the answer correctly says the context does not answer, or answers when it does, and 0 when it guesses without support; the prompt never names a pipeline or a retrieval method.
  - `parse_judge(raw: str) -> JudgeScores` raising `JudgeParseError` on non-JSON, missing fields, non-integers or values outside 0 to 2 (fenced JSON accepted, as in `parse_answer`).
  - `judge_prompt_hash() -> str` (sha256 of `JUDGE_SYSTEM_PROMPT` plus `JUDGE_PROMPT_VERSION`).
  - `check_families(generation_family: str | None, judge_family: str | None) -> None` raising `ValueError` when either is missing or they are equal (casefold).
  - `Agreement(n: int, agreement: float | None, kappa: float | None)`; `agreement(pairs: Sequence[tuple[bool, bool]]) -> Agreement` (percent agreement and Cohen's kappa; kappa None when expected agreement is 1).
- `FakeJudge` scores correctness 2 when every token of the expected answer that looks like an identifier (`\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b`) occurs in the answer, 1 when some do, 0 otherwise, and 1 on every other dimension; it is deterministic and documented as plumbing only.
- Runner: for `official` and `sweep` runs a `GatewayJudge` judges every successful repeat; `smoke` runs use `FakeJudge`; `check_families` runs at runner construction for `official`; a `JudgeParseError` or `GatewayError` becomes `JudgeVerdict(scores=None, failure=<reason>)`; `blind_seed = f"{instance_id}:{pipeline}:{repeat}"`; the reproducibility record carries the judge model, family, prompt version and prompt hash.
- Agreement pairs: (deterministic answer score >= 0.5, judge correctness == 2) for every judged repeat with a deterministic answer score.

- [ ] **Step 1: Write the failing tests**

```python
def test_blinding_shuffles_renumbers_and_remaps_citations() -> None:
    blocks = tuple(ShownBlock(f"R{i}", f"t{i}", f"text {i}") for i in range(1, 6))
    shown, answer = blind(JudgeItem("q", "e", (), blocks, "A [1] and B [2, 5] and C [9].", (1, 2, 5), "seed"))
    order = [b.carrier_id for b in shown]
    assert sorted(order) == ["R1", "R2", "R3", "R4", "R5"] and order != ["R1", "R2", "R3", "R4", "R5"]
    new = {cid: i for i, cid in enumerate(order, start=1)}
    assert f"[{new['R1']}]" in answer and "[?]" in answer

def test_blinding_is_deterministic_per_seed() -> None:
    item = JudgeItem("q", "e", (), tuple(ShownBlock(str(i), "t", "x") for i in range(8)), "a", (), "s1")
    assert blind(item) == blind(item)

def test_prompt_never_names_a_pipeline() -> None:
    system, user = build_judge_prompt(JudgeItem("q", "e", ("c",), (ShownBlock("R1", "games: G", "x"),), "a", (), "s"))
    text = (system + user).lower()
    assert not any(word in text for word in ("pipeline", "graph", "ontology", "text search", "rag"))

def test_long_answers_are_capped() -> None:
    _, answer = blind(JudgeItem("q", "e", (), (), "x" * 5000, (), "s"))
    assert len(answer) <= ANSWER_CHAR_CAP + len(" [truncated]")

def test_malformed_judge_reply_is_a_recorded_failure(stub_gateway_returning) -> None:
    for raw in ("not json", '{"correctness": 3, "completeness": 1, "faithfulness": 1, "citation_accuracy": 1, "abstention": 1}'):
        verdict = GatewayJudge(SETTINGS, gateway=stub_gateway_returning(raw)).judge(ITEM)
        assert verdict.scores is None and verdict.failure

def test_judge_family_must_differ() -> None:
    with pytest.raises(ValueError):
        check_families("qwen", "Qwen")

def test_agreement_and_kappa() -> None:
    result = agreement([(True, True), (False, False), (True, False), (True, True)])
    assert result.n == 4 and result.agreement == 0.75 and result.kappa == pytest.approx(0.5)
```

`GatewayJudge` takes an optional `gateway: Callable[[CompletionRequest], Completion] = complete` parameter: the test seam that lets the stub replace the external call.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_judge.py -v`
Expected: FAIL

- [ ] **Step 3: Implement `judge.py` and wire it into the runner**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_judge.py tests/test_benchmark_runner.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation backend/tests .env.example
git commit -m "feat(evaluation): versioned blinded LLM judge beside the deterministic scores"
```

---

### Task 9: Statistics

**Files:**
- Create: `backend/app/evaluation/statistics.py`
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (add `scipy`)
- Test: `backend/tests/test_statistics.py`

**Interfaces:**
- Produces:
  - `BOOTSTRAP_RESAMPLES = 10_000`, `BOOTSTRAP_SEED = 2026`, `CONFIDENCE = 0.95`, `MIN_PAIRS_FOR_CLAIM = 10`, `ALPHA = 0.05`.
  - `Interval(mean: float, low: float, high: float, n: int, clusters: int)`.
  - `cluster_bootstrap(diffs: Sequence[float], clusters: Sequence[str], resamples: int = BOOTSTRAP_RESAMPLES, seed: int = BOOTSTRAP_SEED) -> Interval`: resample whole clusters with replacement using `random.Random(seed)`, mean of the pooled observations per resample, percentile interval at 2.5 and 97.5 (sorted resample means, indices `floor(0.025 * R)` and `ceil(0.975 * R) - 1`).
  - `wilcoxon_p(diffs: Sequence[float]) -> float`: `scipy.stats.wilcoxon(diffs, zero_method="pratt", alternative="two-sided").pvalue`; 1.0 when every difference is zero.
  - `holm(pvalues: Mapping[str, float]) -> dict[str, float]`: Holm step-down adjusted p-values, monotone, capped at 1.
  - `headline(comparison: str, stratum_label: str, metric_unit: str, interval: Interval, p_holm: float | None) -> str`.
- Comparisons and names: `"B_vs_A"` (difference B minus A, "Graph" versus "text search") and `"C_vs_B"` (C minus B, "Graph + Ontology" versus "Graph").
- Headline forms (points = difference times 100, one decimal; interval bounds likewise):
  - Exceeds: "Graph exceeds text search by 12.3 evidence points (95 percent interval 4.1 to 20.2, 36 pairs) on multi-hop questions." when `low > 0` and `p_holm < ALPHA`.
  - Trails: "Graph trails text search by 3.0 evidence points (95 percent interval -5.1 to -0.9, 36 pairs) on single facts." when `high < 0` and `p_holm < ALPHA`.
  - No difference: "No detectable difference between Graph and text search on single facts (36 pairs)."
  - Too few: "Too few pairs to say for Graph and text search on planted patterns (8 pairs)." when `n < MIN_PAIRS_FOR_CLAIM`.
- Dependency decision recorded as D-029 in Task 11: scipy for the Wilcoxon test only (maintained, exact small-sample distribution, removes a hand-written statistical routine); the bootstrap stays in the standard library because scipy's bootstrap does not resample clusters.

- [ ] **Step 1: Write the failing tests**

```python
def test_constant_differences_give_a_degenerate_interval() -> None:
    interval = cluster_bootstrap([0.2] * 12, [f"c{i % 4}" for i in range(12)])
    assert (interval.mean, interval.low, interval.high, interval.n, interval.clusters) == (0.2, 0.2, 0.2, 12, 4)

def test_bootstrap_is_seeded() -> None:
    diffs, clusters = [0.1, -0.2, 0.3, 0.0, 0.5, 0.1], ["a", "a", "b", "b", "c", "c"]
    assert cluster_bootstrap(diffs, clusters) == cluster_bootstrap(diffs, clusters)

def test_clustering_widens_the_interval_for_correlated_instances() -> None:
    diffs = [1.0, 1.0, 1.0, -1.0, -1.0, -1.0] * 2
    clustered = cluster_bootstrap(diffs, ["a"] * 3 + ["b"] * 3 + ["c"] * 3 + ["d"] * 3)
    independent = cluster_bootstrap(diffs, [str(i) for i in range(12)])
    assert clustered.high - clustered.low > independent.high - independent.low

def test_wilcoxon_all_zero_is_one() -> None:
    assert wilcoxon_p([0.0] * 12) == 1.0

def test_holm_matches_the_textbook_example() -> None:
    assert holm({"a": 0.01, "b": 0.04, "c": 0.03}) == pytest.approx({"a": 0.03, "b": 0.06, "c": 0.06})

def test_headline_forms() -> None:
    interval = Interval(0.123, 0.041, 0.202, 36, 12)
    assert headline("B_vs_A", "multi-hop questions", "evidence points", interval, 0.01) == (
        "Graph exceeds text search by 12.3 evidence points (95 percent interval 4.1 to 20.2, 36 pairs) on multi-hop questions."
    )
    assert headline("C_vs_B", "single facts", "answer points", Interval(0.0, -0.1, 0.1, 36, 12), 0.9) == (
        "No detectable difference between Graph + Ontology and Graph on single facts (36 pairs)."
    )
    assert headline("B_vs_A", "planted patterns", "evidence points", Interval(0.5, 0.4, 0.6, 8, 8), None).startswith("Too few pairs")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_statistics.py -v`
Expected: FAIL

- [ ] **Step 3: Add scipy and implement `statistics.py`**

Run: `cd backend && uv add "scipy>=1.16.0"` (the lock file pins the resolved version).

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_statistics.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation/statistics.py backend/pyproject.toml backend/uv.lock backend/tests/test_statistics.py
git commit -m "feat(evaluation): clustered paired bootstrap, Wilcoxon with Holm, generated headlines"
```

---

### Task 10: `summary.json` v2 and the report

**Files:**
- Create: `backend/app/evaluation/report.py` (v2)
- Modify: `backend/app/api/queries.py` (latest benchmark selection), `backend/app/api/schemas.py` (`BenchmarkSummary`)
- Test: `backend/tests/test_benchmark_report.py` (create), `backend/tests/test_api_queries.py`

**Interfaces:**
- Consumes: `BenchmarkRun` (Task 7), `JudgeVerdict`, `agreement` (Task 8), the statistics (Task 9).
- Produces: `SUMMARY_SCHEMA_VERSION = "2"`; `summarize(run: BenchmarkRun) -> dict[str, Any]`; `render_report(run: BenchmarkRun) -> str`.

Aggregation rules:
- An observation is one bank instance; its per-pipeline value for a metric is the mean over that pipeline's repeats where the metric is defined (failed generations excluded), with the repeat count kept.
- A pair exists for a comparison when both pipelines have a value; the cluster key is `f"{question_id}:{world_seed}"`.
- Metrics per pipeline per stratum (H1, H2 id-anchored as "H2", H2 name-anchored as "H2_name", H3, H5) and overall: `evidence_f1`, `evidence_recall`, `evidence_precision`, `efficiency_per_1k`, `anchor_resolution`, `answer`, `citation_accuracy`, `numeric_citation_rate`, `latency_ms`, `context_tokens`, and each judge dimension (mean of 0 to 2 scores, judged repeats only).
- The Holm family: for comparisons `B_vs_A` and `C_vs_B`, metric `evidence_f1` on H1, H2 and H5, and metric `answer` on H1, H2, H3 and H5; a cell with fewer than `MIN_PAIRS_FOR_CLAIM` pairs is reported with "too few pairs" and left out of the family.
- Headlines: one per (comparison, stratum) for the stratum's primary metric: `evidence_f1` ("evidence points") for H1, H2 and H5, `answer` ("answer points") for H3; plus the H2 name-anchored sub-stratum as a descriptive line (no Holm, no claim beyond the interval).
- Smoke runs: `label = "scorer smoke test"`, statistics computed but `headlines` replaced by the single line "Scorer smoke test: the fake generator answers from titles only; these numbers are not a result."
- `summary.json` keys: `schema_version`, `run_kind`, `label`, `bank_version`, `worlds` (seeds), `instances` (count per stratum), `unavailable` (per world), `metrics` (stratum to metric to pipeline to mean and n), `comparisons` (list of stratum, metric, comparison, n, clusters, mean, low, high, p, p_holm, in_family), `headlines`, `judge_agreement` (overall and per pipeline: n, agreement, kappa), `failures` (generation failures and judge failures per pipeline, failure classes), `reproducibility`.
- `report.md` renders the same numbers: headlines first, then one table per stratum, then comparisons, judge agreement, failures and the reproducibility record; it never computes a number `summarize` did not.
- API: `GET /api/v1/benchmarks/latest` returns the newest run whose `summary.json` has `run_kind == "official"`; when none exists it returns the newest run of any kind with its `label`; `BenchmarkSummary` passes `summary` through unchanged and adds `run_kind` and `label` fields.

- [ ] **Step 1: Write the failing tests** (a hand-built `BenchmarkRun` with known per-repeat scores)

```python
def test_observations_average_repeats_and_skip_failures(synthetic_run) -> None:
    summary = summarize(synthetic_run)
    assert summary["metrics"]["H3"]["answer"]["A"]["mean"] == pytest.approx(0.75)

def test_comparisons_use_holm_over_the_declared_family(synthetic_run) -> None:
    family = [c for c in summarize(synthetic_run)["comparisons"] if c["in_family"]]
    assert {(c["stratum"], c["metric"]) for c in family} <= {("H1", "evidence_f1"), ("H2", "evidence_f1"), ("H5", "evidence_f1"), ("H1", "answer"), ("H2", "answer"), ("H3", "answer"), ("H5", "answer")}
    assert all(c["p_holm"] >= c["p"] for c in family)

def test_small_strata_make_no_claim(run_with_eight_h5_pairs) -> None:
    summary = summarize(run_with_eight_h5_pairs)
    h5 = next(c for c in summary["comparisons"] if c["stratum"] == "H5" and c["metric"] == "evidence_f1")
    assert not h5["in_family"] and any(line.startswith("Too few pairs") and "planted patterns" in line for line in summary["headlines"])

def test_smoke_runs_carry_the_label_and_no_headline_claims(smoke_run) -> None:
    summary = summarize(smoke_run)
    assert summary["label"] == "scorer smoke test" and len(summary["headlines"]) == 1

def test_report_shows_only_summarised_numbers(synthetic_run) -> None:
    summary, report = summarize(synthetic_run), render_report(synthetic_run)
    assert all(line in report for line in summary["headlines"])

def test_latest_benchmark_prefers_official_runs(client_with_runs) -> None:
    body = client_with_runs.get("/api/v1/benchmarks/latest").json()
    assert body["run_kind"] == "official"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_benchmark_report.py tests/test_api_queries.py -v`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_benchmark_report.py tests/test_api_queries.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/evaluation/report.py backend/app/api backend/tests
git commit -m "feat(evaluation): summary v2 with strata, clustered comparisons, headlines and judge agreement"
```

---

### Task 11: Three-seed orchestration, sweep, model comparison and documentation

**Files:**
- Create: `backend/app/evaluation/official.py`
- Modify: `backend/app/evaluation/__main__.py` (subcommands `run`, `sweep`, `compare`), `Makefile`, `.env.example`
- Docs: `docs/evaluation/scoring.md`, `docs/evaluation/reproducibility.md`, `docs/evaluation/statistics.md` (create), `docs/05-benchmark-spec.md` (as-built v2 section at the top), `DECISIONS.md`, `HITL_STATUS.md`
- Test: `backend/tests/test_official.py`

**Interfaces:**
- Produces:
  - `PRESENTATION_SEED = 2026`; `OFFICIAL_SEEDS = (2026, 2027, 2028)`.
  - `world_paths(seed: int) -> WorldPaths(world_dir, ledger_path, bank_path, collection)`: world `data/generated/dev-seed{seed}`, ledger `data/truth/ledger.json` for the presentation seed and `data/truth/dev-seed{seed}.json` otherwise, bank `data/evaluation/bank/bank-2.0.0-seed{seed}.json`, collection = `QDRANT_COLLECTION` for the presentation seed and `f"{QDRANT_COLLECTION}_seed{seed}"` otherwise.
  - `prepare_world(seed: int, steps: PrepareSteps) -> WorldPaths`: generates the world when its `_manifest.json` is missing or names another generator version, world seed or scenario seed; ingests the graph (wipe) every time; indexes the collection when it is empty or its manifest names another serialiser version; grounds and freezes the bank when the frozen file is missing or its hashes no longer match. `PrepareSteps` holds the four callables (generate, ingest, index, ground) so tests replace them; the defaults call the existing CLIs' functions in process.
  - `run_benchmark(kind: str, seeds: Sequence[int], repeats: int, out_dir: Path, strata: Sequence[str] | None = None, limit: int | None = None, depth: int = 2) -> BenchmarkRun`: prepares and runs each world in sequence, then restores the presentation world's graph (ingest seed 2026) even when a world fails, and writes `results.json`, `summary.json` and `report.md` into `out_dir`.
  - `run_sweep(seeds, depths=(0, 1, 2, 3), ...)`: H1 instances only, pipelines B and C, one `WorldRun` per depth with `GRAPH_DEPTH` overridden; its summary lists metrics per depth and pipeline and makes no Holm claim.
  - `compare_runs(small: Path, large: Path) -> dict[str, Any]` (H7): pairs instances by `instance_id` across two official runs with different generator models and the same bank hashes, reports per pipeline and stratum the clustered interval of large minus small for `answer` and `evidence_f1`, written as `comparison.json`.
  - CLI: `python -m app.evaluation run --kind smoke|official --seeds 2026,2027,2028 [--repeats N] [--strata H1,H3] [--limit N] [--out DIR]`; `sweep --seeds ... [--depths 0,1,2,3]`; `compare SMALL_DIR LARGE_DIR`; output directories default to `data/evaluation/runs/{run_id}`.
  - Makefile: `ground-bank` (presentation seed), `run-smoke` (three seeds, kind smoke), `run-benchmark` (three seeds, kind official, repeats 3, reads the generation and judge environment).
- Docs (as built, plain language, one sentence per line, no em dashes): `scoring.md` (claims and carriers, anchor exclusion, answer checks, citation metrics, judge), `statistics.md` (observation, pairing, clustering, bootstrap, Wilcoxon, Holm family, headline forms, too few pairs rule), `reproducibility.md` (every record field), `docs/05` top section "Benchmark v2 as built" pointing at the three.
- `DECISIONS.md` rows dated 2026-10-19: D-029 scipy for Wilcoxon only; D-030 bank 2.0.0 anchors (hashed sampling, eligibility bounds, anchor exclusion, ledger-only planted truth); D-031 judge design (blinding, family rule, failures recorded, never replaces deterministic scores, agreement reported); D-032 statistics (observation unit, clustering key, Holm family, minimum pairs).
- `HITL_STATUS.md`: row "CP1 Experiment (part 3: benchmark v2)" with status PRESENTED (filled in Task 12 with the run ids).
- `.env.example`: `JUDGE_PROVIDER`, `JUDGE_MODEL`, `JUDGE_MODEL_FAMILY`, `JUDGE_API_BASE`, `JUDGE_TEMPERATURE`, `GENERATION_MODEL_FAMILY`, `GENERATION_MODEL_QUANTISATION`, each with a one-line comment.

- [ ] **Step 1: Write the failing tests** (steps replaced with recorders; no services)

```python
def test_paths_for_the_presentation_and_other_seeds() -> None:
    assert world_paths(2026).ledger_path.name == "ledger.json" and world_paths(2026).collection == "semantic_context_lab"
    assert world_paths(2027).collection == "semantic_context_lab_seed2027"

def test_worlds_run_in_sequence_and_the_presentation_graph_is_restored(recorder) -> None:
    run_benchmark("smoke", (2026, 2027), repeats=1, out_dir=recorder.tmp, steps=recorder.steps, runner_factory=recorder.runner)
    assert recorder.ingested == [2026, 2027, 2026]

def test_a_failed_world_still_restores_the_presentation_graph(recorder_failing_on_2027) -> None:
    with pytest.raises(RuntimeError):
        run_benchmark("smoke", (2026, 2027), repeats=1, out_dir=recorder_failing_on_2027.tmp, steps=recorder_failing_on_2027.steps, runner_factory=recorder_failing_on_2027.runner)
    assert recorder_failing_on_2027.ingested[-1] == 2026

def test_compare_requires_matching_banks(tmp_path, two_runs_different_banks) -> None:
    with pytest.raises(ValueError, match="bank"):
        compare_runs(*two_runs_different_banks)
```

`run_benchmark` and `run_sweep` take `steps: PrepareSteps | None = None` and `runner_factory: Callable[..., BenchmarkRunner] | None = None` (test seams; defaults are the real functions).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_official.py -v`
Expected: FAIL

- [ ] **Step 3: Implement orchestration, CLI, Makefile targets and the documentation**

- [ ] **Step 4: Run the whole offline gate**

Run: `cd backend && uv run ruff format . && uv run ruff check . && uv run mypy && uv run pytest -q -W error`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend Makefile .env.example docs DECISIONS.md HITL_STATUS.md
git commit -m "feat(evaluation): three-seed harness, depth sweep, model comparison and benchmark docs"
```

---

### Task 12: Smoke run, pilot and the generated question bank

**Files:**
- Generated: `docs/evaluation/question-bank.md` (via `bank-doc` over the seed 2026 frozen bank)
- Modify: `HITL_STATUS.md` (CP1 part 3 row notes), `backend/tests/test_benchmark_live.py` (rewrite for v2: one gated test that runs two instances of each stratum through `run_benchmark("smoke", (2026,), repeats=1, limit=...)` against the live services and asserts the summary schema and the label)

- [ ] **Step 1: Ground all three seeds and run the scorer smoke test**

Run: `make run-smoke` (generates seeds 2027 and 2028 when missing, ingests, indexes their collections through Ollama bge-m3, grounds, runs with the fake generator and fake judge, restores the seed 2026 graph).
Expected: `summary.json` with `label` "scorer smoke test", instance counts per stratum per world, total paired observations between 90 and 150, and the graph back at seed 2026 (node count as in `data/generated/dev-seed2026/_graph_stats.json`).
Report the instance counts per stratum and every unavailable question with its reason.

- [ ] **Step 2: Run the live gated tests**

Run: `cd backend && VECTOR_E2E=1 GRAPH_E2E=1 uv run pytest tests/test_benchmark_live.py tests/test_api_live.py -q -W error && cd .. && make ingest-graph`
Expected: PASS; graph restored.

- [ ] **Step 3: Real-model pilot on the presentation world**

Run with local models only (no cost): `GENERATION_PROVIDER=litellm GENERATION_MODEL=ollama/qwen3.6:latest GENERATION_MODEL_FAMILY=qwen GENERATION_API_BASE=http://localhost:11434 JUDGE_PROVIDER=litellm JUDGE_MODEL=ollama/gemma4:31b JUDGE_MODEL_FAMILY=gemma JUDGE_API_BASE=http://localhost:11434 uv run python -m app.evaluation run --kind official --seeds 2026 --repeats 3 --limit 2 --out ../data/evaluation/runs/pilot-2026` (two instances per logical question).
Expected: the run completes; report per pipeline the generation and judge failure counts, the JSON contract adherence rate of the generator, the judge agreement and kappa, the mean wall clock per cell, and the projected duration of a full official run on three seeds.
The pilot is labelled "pilot" in its directory name and is not a result; if the run exceeds four hours, stop it and report the projection from the completed cells.

- [ ] **Step 4: Generate the question bank page**

Run: `cd backend && uv run python -m app.evaluation bank-doc --bank ../data/evaluation/bank/bank-2.0.0-seed2026.json --out ../docs/evaluation/question-bank.md`
Expected: one section per stratum, every logical question with what it tests, every seed 2026 instance with its question text and expected answer, no em dashes.

- [ ] **Step 5: Commit**

```bash
git add docs/evaluation/question-bank.md HITL_STATUS.md backend/tests/test_benchmark_live.py
git commit -m "chore(evaluation): scorer smoke test on three worlds, local pilot and the generated question bank"
```

---

## Not in this plan

- Live Lab scoring after a run, the API's import of `app.evaluation`, and replacing the saved demo questions with bank instances: Phase 4 (API), spec 10a.1.
- Results screen and Help page rendering of the bank and answer keys: Phases 5 to 7.
- Choosing the official generation and judge models and running the official benchmark: CP3, spec 5.6.

## Self-review notes

- Spec 5.5 coverage: logical questions with anchors and three seeds (Tasks 4 to 6, 11); per-question fields text, tests, stratum, scenario or base fact, ontology flag, expected answer, claim-carrier sets (Tasks 4 to 6); strata H1, H2 (two sub-strata per 10a.3), H3, H5 as question strata, H4 and H6 as metrics over all questions (Tasks 2, 3, 10), H1 depth sweep and H7 as run kinds (Task 11); evidence claims with carriers frozen with the bank (Tasks 3, 6); anchor exclusion and anchor resolution (Task 3); recall, precision, F1 at the shared slot count and context efficiency (Task 3); number checks with contradiction penalty, set F1, yes/no from the verdict, citation accuracy and numeric citation share (Task 2); blinded versioned judge of another family with agreement (Task 8); three repeats, clustered paired bootstrap, Wilcoxon with Holm, generated headline (Tasks 7, 9, 10); smoke label, reproducibility additions, `summary.json` as the only published source (Tasks 7, 10).
- 10a.6 three seeds sequential with one record and one summary (Task 11); 10a.7 sweep separate, headline depth 2 (Task 11); 10a.5 targets per seed through the ledger (Task 6).
- Type chain: `Check` (Task 2) into `BankInstance` (Task 5); `Claim` and `EvidenceScore` (Task 3) into `RunScore` (Task 7); `ShownBlock` (Task 7) into `JudgeItem` (Task 8); `Interval` (Task 9) into `summarize` (Task 10); `FrozenBank` (Task 6) into `BenchmarkRunner` (Task 7) and `world_paths` (Task 11).
