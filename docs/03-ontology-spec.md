# Enterprise Ontology Specification

## 1. Purpose

The ontology gives the agent a stable semantic model of the synthetic enterprise.

The graph answers:

> What is connected?

The ontology also answers:

> What does each thing mean?

The ontology is a primary part of the POC and must be evaluated separately from graph relationships alone.

---

## 2. Design Goals

The ontology must:

- unify terminology across four markets
- represent product concepts independently of local names
- define allowed business relationships
- support cross-market equivalence
- support multi-language mappings
- support graph traversal
- support explainable evidence paths
- remain understandable to humans

---

## 3. Ontology Layers

### Layer A — Foundational concepts

```text
Entity
BusinessObject
BusinessEvent
BusinessActor
BusinessCapability
KnowledgeAsset
Metric
Location
```

### Layer B — Lottery domain concepts

```text
LotteryProduct
DrawGame
InstantGame
HighFrequencyGame
MultinationalGame
AddOnGame
GameMechanic
PrizeStructure
Draw
Ticket
Player
PlayerSegment
Campaign
Channel
Retailer
Platform
Incident
SupportInteraction
```

### Layer C — Enterprise operational concepts

```text
DigitalPlatform
PaymentPlatform
IdentityPlatform
AnalyticsPlatform
ApplicationRelease
PlatformVersion
ServiceIncident
ConversionFailure
PaymentFailure
CustomerComplaint
MarketingCampaign
ProductExperiment
```

### Layer D — Local instances

Examples:

```text
GAME_UK_01
GAME_GR_03
GAME_AT_02
GAME_CZ_07
```

Local instances connect to canonical concepts.

---

## 4. Core Hierarchies

### Product hierarchy

```text
LotteryProduct
├── DrawGame
│   ├── NationalDrawGame
│   ├── MultinationalDrawGame
│   ├── FixedPrizeDrawGame
│   └── AnnuityDrawGame
├── HighFrequencyGame
├── InstantGame
│   ├── RetailInstantGame
│   └── DigitalInstantGame
└── AddOnGame
```

### Mechanic hierarchy

```text
GameMechanic
├── NumberSelection
├── QuickPick
├── BonusNumber
├── Jackpot
├── Rollover
├── Multiplier
├── InstantReveal
├── ProgressivePrize
├── FixedPrize
└── AddOnMechanic
```

### Channel hierarchy

```text
Channel
├── Retail
├── Web
├── MobileApp
└── OtherDigital
```

### Incident hierarchy

```text
Incident
├── ApplicationIncident
├── PaymentIncident
├── IdentityIncident
├── PlatformIncident
├── RetailIncident
└── DataIncident
```

### Customer behaviour hierarchy

```text
CustomerBehaviour
├── ProductAffinity
├── ProductMigration
├── ChurnSignal
├── CrossSellResponse
├── CampaignResponse
└── ChannelMigration
```

---

## 5. Canonical Relationships

Allowed ontology semantics include:

```text
INSTANCE_OF
IS_A
HAS_MECHANIC
HAS_PRIZE_TYPE
AVAILABLE_VIA
OPERATES_IN
RUNS_ON
DEPENDS_ON
PROMOTES
TARGETS
AFFECTS
CAUSES
CORRELATES_WITH
RELATED_TO
MAPS_TO
EQUIVALENT_TO
SUPPORTED_BY
MEASURED_BY
```

Relationship meanings must be documented.

Example:

### `RUNS_ON`

Domain:

```text
LotteryProduct or ChannelCapability
```

Range:

```text
Platform
```

Meaning:

> The product or capability depends operationally on the specified platform.

### `AFFECTS`

Domain:

```text
Incident / Campaign / Release
```

Range:

```text
Market / Game / Segment / Channel / Platform
```

Meaning:

> The source entity has a material observed or synthetic causal effect on the target entity.

---

## 6. Local-to-Canonical Mapping

Local terminology must map to common concepts.

Example:

```text
Local label: "mobile draw product"
      |
   MAPS_TO
      |
Canonical concept: DrawGame
```

All local product names remain synthetic.

---

## 7. Language Mapping

Local-language terms may map to canonical English concept IDs.

Example structure:

```text
Term
  language: el
  text: ...
       |
    MAPS_TO
       |
BusinessConcept: PaymentFailure
```

The English UI may therefore query concepts independent of document language.

---

## 8. Market Equivalence

Two products should not be marked equivalent simply because they are both lotteries.

The ontology should support:

```text
structural_similarity
mechanic_similarity
audience_similarity
channel_similarity
prize_similarity
```

Derived relationships may be represented as:

```text
(:Game)-[:SIMILAR_TO {
  method: "ontology",
  score: 0.87
}]->(:Game)
```

The method and score must be explicit.

---

## 9. Ontology Versioning

Every ontology release should have:

```text
ontology_version
created_at
change_summary
```

Concept IDs must remain stable.

Deprecated concepts should be marked rather than silently reused.

---

## 10. Reasoning Patterns

The ontology must support benchmark questions like:

### Structural product similarity

```text
Game A
-> INSTANCE_OF
-> NationalDrawGame

Game A
-> HAS_MECHANIC
-> NumberSelection
```

Find other games sharing those concepts.

### Cross-market incident transfer

```text
Incident
-> INSTANCE_OF
-> PaymentIncident
```

Find incidents in other markets of the same canonical type.

### Campaign transferability

```text
Campaign
-> TARGETS
-> SegmentConcept

Campaign
-> PROMOTES
-> GameConcept
```

Find products and segments in another market with equivalent canonical mappings.

---

## 11. Ontology-Aware Retrieval

The GraphRAG engine may expand a query through ontology concepts.

Example:

User asks:

```text
"Which products behave like the Greek high-frequency game?"
```

Possible expansion:

```text
Greek product
-> INSTANCE_OF HighFrequencyGame
-> HAS_MECHANIC NumberSelection
-> audience affinity concepts
-> candidate products in other markets
```

Ontology expansion must be bounded.

---

## 12. Evaluation

The benchmark must include questions where:

- graph relationships alone are enough
- ontology provides additional value
- local terminology differs
- documents are in different languages
- cross-market product equivalence must be inferred

This enables comparison of:

```text
A: RAG
B: Graph
C: Graph + Ontology
```

---

## 13. Human-Readable Documentation

Every canonical concept must document:

```text
concept_id
canonical_name
definition
parent
allowed relationships
examples
non-examples
```

This ontology is intended to be understandable by business and technical audiences.

---

## 14. HITL Gate

This specification is subject to **HITL-04**.

Before implementation provide:

- ontology tree
- canonical concept list
- relationship definitions
- three cross-market worked examples
- one multilingual worked example
- one example demonstrating value beyond plain graph relationships
