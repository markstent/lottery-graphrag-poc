# Scoring

Scoring is deterministic. The implementation is `app/evaluation/scoring.py`;
the harness is `app/evaluation/runner.py`. No dimension is relied on alone.

## Answer correctness

Each question grounds to a tuple of expected-answer checks
(`docs/evaluation/question-bank.md` binding keys):

- `number`: the expected value appears in the answer text with normalised
  decimal formatting (`2.50` matches `2.5`).
- `token`: a case-insensitive word-boundary match (`INC_01` does not match
  `INC_010`).
- `set`: the fraction of expected record ids named in the answer.

The question score is the mean of its checks. Semantic questions whose
binding key has no deterministic surface form (summaries, "why" questions)
grade on evidence only and record no answer score; this is stated per
question at grounding time.

## Evidence precision and recall

Evidence recall is the fraction of required record ids a run surfaced as
selected evidence (graph nodes plus cited document ids). Evidence precision
is the share of selected evidence that is required. Both are computed
against the required-evidence list produced by grounding; retrieval code
never sees it (ADR-008).

Set-valued questions grade recall over the full expected set, which is
intentionally demanding against the fixed evidence budget; the budgets are
identical for every pipeline, so the comparison stays fair.

## Failure taxonomy

Weak results receive one primary deterministic failure class from pipeline
telemetry alone: `retrieval_failure` (including pipeline A, which has no
resolution stage), `entity_resolution_failure`, `graph_traversal_failure`
(required node reached but discarded), `generation_failure` (evidence
retrieved, answer wrong).

## Cost, latency and tokens

Latency and context tokens are recorded per run and reported separately.
They are never folded into the quality score. Local model runs cost nothing;
remote runs would record estimated cost per docs/05 section 6.

## LLM-as-judge

Not used in this phase. If introduced later it must be clearly identified
and versioned per result, and must never replace these deterministic
metrics (docs/05 section 9).
