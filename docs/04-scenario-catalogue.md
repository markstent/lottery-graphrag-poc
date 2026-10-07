# Scenario Catalogue and Truth-Ledger Specification

## 1. Purpose

Planted scenarios provide known hidden truth against which RAG and GraphRAG can be evaluated objectively.

Scenarios must create realistic signals distributed across:

- structured data
- graph relationships
- documents
- telemetry
- support records
- campaigns
- market behaviour

Retrieval systems must never see the truth ledger.

---

## 2. Scenario Object

Every scenario has:

```text
scenario_id
scenario_type
enabled
scenario_seed
start_date
duration
affected_markets
affected_games
affected_segments
strength
noise_level
expected_signals
required_evidence
truth
```

---

## 3. Scenario 01 — App Release Conversion Failure

### Hidden truth

A new application release introduces a checkout problem for a specific device/OS cohort.

### Signals

- lower checkout completion
- higher abandoned sessions
- elevated support contacts
- release note mentions changed checkout component
- incident appears after several days
- other unaffected segments remain stable

### Graph value

```text
Game
-> RUNS_ON
-> MobilePlatform
<- RELATED_TO
<- Incident
-> AFFECTS
-> DeviceSegment
```

### Benchmark questions

- Why did digital participation fall?
- Which cohort was most affected?
- Was the same release implicated elsewhere?

---

## 4. Scenario 02 — Shared Device Cluster

### Hidden truth

A group of synthetic player accounts is unusually connected through shared devices.

### Signals

- normal-looking individual transactions
- high graph connectivity
- time-coordinated activity
- limited textual evidence

### Graph value

Excellent for relationship and community detection.

### Important constraint

Do not label the pattern as fraud automatically.

The expected answer should say it is an unusual cluster worthy of investigation.

---

## 5. Scenario 03 — Shared Payment Cluster

Multiple accounts share a small number of payment instruments.

Signals:

- normal spend per player
- abnormal shared-instrument topology
- cross-device and cross-account overlap

Graph value:

- relationship discovery
- connected-component analysis
- evidence path explanation

---

## 6. Scenario 04 — Promotion-Driven Product Migration

A campaign causes a player cohort to migrate from one product family to another.

Signals:

- campaign exposures
- shift in product mix
- segment affinity
- campaign evaluation document
- unchanged overall engagement

Graph path:

```text
Segment
<- TARGETS -
Campaign
- PROMOTES ->
Game B

Segment
- PREVIOUSLY_PLAYED ->
Game A
```

---

## 7. Scenario 05 — Product Cannibalisation

A newly launched product increases its own performance while reducing participation in a structurally similar existing product.

Signals:

- new launch
- overlapping audience
- similar mechanics
- flat overall category spend
- product review document

Ontology value:

Product similarity may be easier to recognise via canonical game/mechanic concepts.

---

## 8. Scenario 06 — Jackpot Halo Effect

A large jackpot on one product increases activity in related products.

Signals:

- jackpot increase
- traffic increase
- higher cross-product activity
- campaign references
- increased retail visits

Graph value:

Shared product family/mechanics and cross-sell relationships.

---

## 9. Scenario 07 — Cross-Market Platform Incident

A shared platform version causes similar symptoms across multiple markets.

Example pattern:

```text
PlatformVersion 4.8.2
  -> incident in Greece
  -> incident in Austria
  -> weaker symptoms in Czech Republic
  -> no impact in UK
```

This is one of the primary presentation scenarios.

Questions:

- Have we seen this problem elsewhere?
- Which other markets used the same platform version?
- Why was one market unaffected?

---

## 10. Scenario 08 — Campaign Audience Mismatch

A campaign performs poorly because the targeted audience has low affinity with the promoted game's mechanics.

Signals:

- high exposure
- low conversion
- segment-game mechanic mismatch
- creative/campaign brief
- other segments perform normally

Ontology value:

Segment affinity and mechanic concepts.

---

## 11. Scenario 09 — Payment Provider Degradation

One payment provider experiences intermittent failures.

Signals:

- higher payment failure rate
- support cases
- increased abandoned checkout
- multiple games affected
- market-specific provider usage

Graph value:

One shared provider explains multiple apparently unrelated product symptoms.

---

## 12. Scenario 10 — Game Mechanic Affinity

A player segment consistently performs strongly on products sharing a mechanic across markets.

Signals:

- cross-product activity
- different local product names
- shared canonical mechanic
- multilingual documents

Ontology value:

Strong.

---

## 13. Scenario 11 — Transferable Campaign

A campaign succeeds in one market.

Another market contains a structurally similar product and audience segment.

The benchmark asks whether the first campaign has evidence supporting transfer.

Expected answer must express recommendation confidence, not certainty.

---

## 14. Scenario 12 — Support Complaint Precursor

Support complaints increase before KPI degradation is visible in monthly reporting.

Signals:

- complaint topic cluster
- release or platform change
- later conversion impact

Graph value:

Documents/support cases connect operational change to later metrics.

---

## 15. Scenario 13 — Retailer Regional Anomaly

A set of retailers within one synthetic region shows unusual performance.

Possible causes:

- local campaign
- retail technology issue
- product stock/availability change
- synthetic data-quality issue

Benchmark should require evidence differentiation.

---

## 16. Scenario 14 — Digital Adoption Shift

A cohort moves from retail to digital over several months.

Signals:

- channel migration
- device uptake
- campaign exposure
- changed session behaviour
- stable overall player value

Graph value:

Cross-domain customer context.

---

## 17. Scenario 15 — Document/Structured Conflict

A document contains outdated guidance while structured records reflect the new state.

Purpose:

Test provenance and temporal reasoning.

Graph/ontology system should not blindly prefer text.

Expected behaviour:

- identify conflict
- use validity timestamps
- cite authoritative current source

---

## 18. Scenario Signal Strength

Use:

```text
0.2 subtle
0.5 moderate
0.8 strong
1.0 obvious
```

Noise controls should affect:

- unrelated incidents
- random support cases
- background campaign activity
- normal market variance
- misleading-but-plausible document mentions

Noise must not invalidate the truth.

---

## 19. Truth Ledger Structure

Example:

```json
{
  "scenario_id": "SCN-007",
  "scenario_type": "cross_market_platform_incident",
  "truth": {
    "root_cause_entity": "PLATFORM_VERSION_4_8_2",
    "primary_market": "GR",
    "related_markets": ["AT", "CZ"],
    "unaffected_markets": ["UK"],
    "required_path": [
      "INCIDENT_GR_021",
      "PLATFORM_VERSION_4_8_2",
      "INCIDENT_AT_009"
    ]
  },
  "required_evidence": [
    "DOC_RELNOTE_188",
    "INCIDENT_GR_021",
    "INCIDENT_AT_009",
    "KPI_GR_CONVERSION"
  ]
}
```

Truth files must be stored separately from retrievable corpus.

---

## 20. Scenario Acceptance Tests

Each scenario must have automated tests that confirm:

- expected signals exist
- expected relationships exist
- unrelated noise also exists
- truth is not exposed
- benchmark can identify required evidence
- deterministic regeneration works

---

## 21. HITL Gate

This specification is subject to **HITL-05 Scenario and Truth-Ledger Approval**.

Before official benchmark data generation, present:

- final enabled scenarios
- scenario signal strength
- expected evidence
- truth objects
- representative synthetic records
