# Benchmark and Evaluation Specification

## Benchmark v2 as built

This section describes the benchmark as built in Phase 3 (bank 2.0.0, 2026-10-19).
Where it differs from the original specification below, this section and the three pages it points to are the current behaviour; the original sections stay as the starting brief.

- The bank is bank 2.0.0: 22 logical questions (L01 to L22) in four strata, H1 multi-hop (L05 to L08), H2 ontology-dependent (L09 to L14, with L13 and L14 anchored by local-language names), H3 single facts (L01 to L04) and H5 planted patterns (L15 to L22).
  It replaces the 30-question v1 bank of sections 2 and 15.
- Each structural question is grounded to up to three anchors per world, picked in a stable hash order; each planted question is grounded to one instance read from the truth ledger.
  The generated page [evaluation/question-bank.md](evaluation/question-bank.md) lists every instance of the presentation world.
- An official run scores the bank on three generated worlds (seeds 2026, 2027 and 2028) with three repeats of every pipeline, at graph depth 2.
- Scoring is deterministic: answer checks, evidence recall, precision and F1 over discoveries (the question's anchor excluded), citation metrics and a failure class.
  A blinded LLM judge of another model family scores beside them and never replaces them.
  There is no composite score (section 7); each metric is reported on its own.
  Known limitation: a graph node without a record block reaches the judge as the text `<Label> <id>`, which can differ in form from pipeline A's record text, so blinding is not complete.
- Comparisons are B against A and C against B, with clustered paired bootstrap intervals, Wilcoxon tests on cluster means and Holm correction over a declared family; the harness writes the headline sentences.
- The H1 depth sweep and the H7 model comparison are separate commands that report intervals or means without tests.

Read next:

- [evaluation/scoring.md](evaluation/scoring.md): claims and carriers, anchor exclusion, answer checks, citation metrics and the judge.
- [evaluation/statistics.md](evaluation/statistics.md): the observation, pairing, clustering, the bootstrap, Wilcoxon, the Holm family, headline forms and the too-few-pairs rule.
- [evaluation/reproducibility.md](evaluation/reproducibility.md): commands, the three-world run, run directories and every field of the record.

---

## 1. Purpose

Create a defensible benchmark for measuring the incremental value of:

A. Existing data layer + conventional RAG  
B. Existing data layer + graph relationships  
C. Existing data layer + graph + enterprise ontology

The benchmark must reward correctness and evidence quality rather than merely fluent answers.

---

## 2. Initial Benchmark

Initial suite: 30 questions.

Recommended category allocation:

| Category | Count |
|---|---:|
| Simple factual retrieval | 4 |
| Semantic retrieval | 4 |
| Relationship lookup | 4 |
| Two-hop reasoning | 4 |
| Multi-hop reasoning | 4 |
| Cross-domain causal reasoning | 4 |
| Cross-market / ontology / hidden-pattern | 6 |

---

## 3. Difficulty Model

### Level 1 — Fact

One authoritative source.

Example:

> What was the synthetic jackpot for Game X on date Y?

Expected result:

All configurations perform similarly.

### Level 2 — Semantic

Requires locating relevant text or concept.

### Level 3 — Relationship

Requires linking two explicit entities.

### Level 4 — Multi-hop

Requires 2-4 relationships.

### Level 5 — Cross-domain

Requires combining structured and unstructured evidence.

### Level 6 — Ontology / Cross-market / Pattern

Requires canonical concept mapping, graph topology, or hidden pattern discovery.

---

## 4. Benchmark Record

Every question record must contain:

```text
question_id
question_text
category
difficulty
market_scope
time_scope
required_entities
required_concepts
required_evidence_ids
optional_evidence_ids
forbidden_truth_ids
required_relationship_paths
numeric_expectations
answer_rubric
scenario_ids
```

Implementation status (Phase 10, `app/evaluation/bank.py` +
`app/evaluation/grounding.py`): the bank stores the logical fields
(`question_id`, logical `question_text` template, `category`, difficulty by
category, `market_scope`, `scenario_ids`) and grounding produces the
world-bound fields (`question_text` with concrete anchors, expected-answer
checks covering `numeric_expectations`, `required_concepts`,
`required_evidence_ids`). The remaining fields are covered structurally
rather than per record: `time_scope` is the documented `REPORTING_DATE` /
scenario-window convention; `required_entities` live in the grounding
selections; `answer_rubric` is replaced by deterministic checks
(docs/evaluation/scoring.md); `forbidden_truth_ids` is enforced by the
truth-ledger isolation tests rather than per-record lists;
`optional_evidence_ids` and `required_relationship_paths` are not needed by
the deterministic scorer and are deferred until a consumer requires them.

A validated harness run over this bank is committed as
docs/evaluation/harness-validation.md (full bank with the deterministic fake
generator plus a real-model subset and the demo-profile performance
verification).

---

## 5. Example Questions

### Factual

> What was the average ticket price for the synthetic UK flagship draw product in the selected month?

### Semantic

> Summarise the product mechanics of the Austrian synthetic draw game.

### Relationship

> Which platform supports the Greek digital product involved in Incident X?

### Two-hop

> Which games were affected by the platform version involved in Incident X?

### Multi-hop

> Which other market experienced an incident linked to the same platform version?

### Cross-domain causal

> Why did digital conversion fall for the Greek product after the March release?

### Ontology

> Which product in Austria is structurally most similar to the synthetic UK flagship draw game?

### Pattern discovery

> Are there any unusual account clusters connected through shared devices or payment instruments?

### Transferability

> Which successful campaign in another market appears most transferable to the Czech product, and why?

---

## 6. Scoring Dimensions

Track separately.

### 6.1 Answer correctness

0-100.

Use deterministic checks wherever possible.

### 6.2 Evidence precision

```text
relevant evidence retrieved / total evidence used
```

### 6.3 Evidence recall

```text
required evidence retrieved / total required evidence
```

### 6.4 Grounding

Percentage of substantive claims supported by cited evidence.

### 6.5 Relationship discovery

Whether required graph relationships were identified.

### 6.6 Pattern detection

Whether the planted pattern was discovered without unsupported escalation.

### 6.7 Cross-market discovery

Whether relevant evidence from another market was located.

### 6.8 Ontology usefulness

Whether canonical concepts enabled correct mapping or comparison.

### 6.9 Context efficiency

Useful evidence per context token.

### 6.10 Latency

End-to-end and stage-level.

### 6.11 Token usage

Input/output.

### 6.12 Tool calls

Count by tool type.

### 6.13 Estimated cost

Applicable for remote models.

---

## 7. Composite Score

Do not lead with one composite score.

If a composite is used, publish the formula.

Suggested optional composite:

```text
30% correctness
20% evidence recall
15% evidence precision
15% grounding
10% relationship discovery
10% pattern/cross-market/ontology score
```

Latency and cost should be shown separately rather than hidden inside quality.

---

## 8. Deterministic Evaluation

Use deterministic evaluation for:

- numeric answers
- known entity IDs
- expected markets
- required source IDs
- required path IDs
- presence/absence of planted patterns

Use fuzzy matching only where necessary.

---

## 9. LLM-as-Judge

May be used for:

- explanation quality
- causal reasoning completeness
- calibrated uncertainty
- recommendation usefulness

Requirements:

- judge prompt versioned
- judge model recorded
- same judge used across configurations
- judge never sees which configuration produced the answer
- judge never sees hidden truth beyond the rubric required for scoring
- judge scores should not replace deterministic metrics

---

## 10. Experimental Repetition

Official benchmark runs should support:

```text
N repeated runs per configuration
```

Recommended initial:

```text
3 runs
```

for any non-deterministic model configuration.

For temperature 0 and deterministic retrieval, one run may be sufficient for early development.

---

## 11. Reproducibility

Every result stores:

```text
git_sha
application_version
dataset_version
world_seed
scenario_seed
question_bank_version
prompt_version
model
model_provider
model_parameters
embedding_model
reranker
top_k
graph_depth
graph_limits
ontology_version
timestamp
```

---

## 12. Fairness Controls

For A/B/C comparison:

- same source world
- same question
- same generation model
- same embedding model
- same temperature
- equivalent context budget
- no truth access
- same time filters
- same authoritative structured data access where enabled

Document any unavoidable asymmetry.

---

## 13. Benchmark Dashboard

Show:

- quality by configuration
- quality by question class
- quality by relational complexity
- evidence recall
- grounding
- latency
- token usage
- cross-market discovery
- ontology advantage
- individual question results

Key presentation chart:

```text
quality
  ^
  |                        Graph + Ontology
  |                  Graph
  |            Baseline
  +--------------------------------------> context complexity
```

Values must come from real experiment results.

---

## 14. Failure Analysis

Every failed question must be classifiable:

```text
retrieval_failure
entity_resolution_failure
graph_traversal_failure
ontology_mapping_failure
context_budget_failure
generation_failure
evaluation_failure
source_conflict
```

This makes the POC useful for engineering, not just presentation.

---

## 15. Initial 30-Question Design

The final question wording should be generated only after the synthetic data/ontology and scenario IDs are approved.

Do not hard-code benchmark answers before HITL-05.

---

## 16. HITL Gate

This specification is subject to **HITL-09 Benchmark and Scoring Approval**.

Before official benchmark runs present:

- complete question bank
- category coverage
- required evidence
- scoring formula
- deterministic checks
- judge prompt if used
- fairness matrix
