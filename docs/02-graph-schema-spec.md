# Graph Schema Specification

## 1. Purpose

Define the Neo4j semantic overlay used to connect entities from the existing synthetic enterprise data layer.

Neo4j is not the authoritative store for all transactional facts.

The graph exists to provide:

- explicit relationships
- semantic context
- provenance
- cross-domain paths
- cross-market relationships
- ontology bindings
- agent navigation

---

## 2. Design Principles

1. Model business concepts explicitly.
2. Preserve source-record provenance.
3. Avoid copying high-volume facts unnecessarily.
4. Use graph relationships where traversal provides semantic value.
5. Keep numeric authority in source tables where practical.
6. Bound graph traversal.
7. Keep labels and relationship names stable and versioned.
8. Separate ontology concepts from business instances.

---

## 3. Node Labels

### Business / organisational

```text
Market
Region
Channel
Supplier
Platform
PlatformVersion
AppVersion
```

### Product

```text
Game
GameFamily
GameCategory
GameMechanic
Draw
PrizeType
Rule
```

### Customer / behaviour

```text
Player
PlayerSegment
Device
PaymentMethod
```

For privacy and scale, the graph may use a reduced player subset or segment-level graph depending on experiment profile.

### Commercial

```text
Campaign
Promotion
Experiment
KPI
```

### Operational

```text
Incident
SupportCase
```

### Knowledge

```text
Document
DocumentChunk
BusinessConcept
Language
Currency
```

---

## 4. Required Node Properties

Every graph node must contain:

```text
id
label_version
source_system
source_record_id
ingestion_version
```

Where applicable:

```text
market_id
name
valid_from
valid_to
```

Ontology concepts should use:

```text
concept_id
canonical_name
concept_type
ontology_version
description
```

---

## 5. Relationship Types

### Product semantics

```text
(:Game)-[:INSTANCE_OF]->(:GameCategory)
(:Game)-[:BELONGS_TO]->(:GameFamily)
(:Game)-[:HAS_MECHANIC]->(:GameMechanic)
(:Game)-[:AVAILABLE_IN]->(:Market)
(:Game)-[:AVAILABLE_VIA]->(:Channel)
(:Game)-[:HAS_RULE]->(:Rule)
```

### Product similarity

```text
(:Game)-[:SIMILAR_TO]->(:Game)
```

Properties:

```text
similarity_score
method
version
```

### Customer relationships

```text
(:Player)-[:BELONGS_TO]->(:PlayerSegment)
(:Player)-[:PLAYS]->(:Game)
(:Player)-[:USES]->(:Device)
(:Player)-[:USES_PAYMENT]->(:PaymentMethod)
```

For aggregate mode:

```text
(:PlayerSegment)-[:PREFERS]->(:GameMechanic)
(:PlayerSegment)-[:PLAYS]->(:Game)
```

### Campaigns

```text
(:Campaign)-[:PROMOTES]->(:Game)
(:Campaign)-[:TARGETS]->(:PlayerSegment)
(:Player)-[:EXPOSED_TO]->(:Campaign)
```

### Platforms and operations

```text
(:Game)-[:RUNS_ON]->(:Platform)
(:PlatformVersion)-[:VERSION_OF]->(:Platform)
(:AppVersion)-[:DEPLOYED_TO]->(:Market)
(:Incident)-[:RELATED_TO]->(:Platform)
(:Incident)-[:RELATED_TO_VERSION]->(:PlatformVersion)
(:Incident)-[:RELATED_TO_APP_VERSION]->(:AppVersion)
(:Incident)-[:AFFECTS]->(:Game)
(:Incident)-[:AFFECTS]->(:PlayerSegment)
(:Incident)-[:AFFECTS_MARKET]->(:Market)
```

### Support

```text
(:SupportCase)-[:CONCERNS]->(:Game)
(:SupportCase)-[:RELATED_TO]->(:Incident)
(:SupportCase)-[:FROM_MARKET]->(:Market)
```

### Documents

```text
(:Document)-[:DESCRIBES]->(:Game)
(:Document)-[:REFERENCES]->(:Incident)
(:Document)-[:REFERENCES]->(:Campaign)
(:Document)-[:DEFINES]->(:Rule)
(:Document)-[:ABOUT]->(:BusinessConcept)
(:Document)-[:HAS_CHUNK]->(:DocumentChunk)
```

### Ontology bindings

```text
(:Game)-[:INSTANCE_OF]->(:BusinessConcept)
(:GameMechanic)-[:MAPS_TO]->(:BusinessConcept)
(:PlayerSegment)-[:MAPS_TO]->(:BusinessConcept)
(:Incident)-[:MAPS_TO]->(:BusinessConcept)
(:BusinessConcept)-[:IS_A]->(:BusinessConcept)
(:BusinessConcept)-[:EQUIVALENT_TO]->(:BusinessConcept)
(:BusinessConcept)-[:RELATED_TO]->(:BusinessConcept)
```

---

## 6. Relationship Properties

Common optional relationship properties:

```text
source
confidence
weight
valid_from
valid_to
created_at
method
version
```

Example:

```text
(:PlayerSegment)-[:PREFERS {
    weight: 0.82,
    source: "derived",
    method: "behavioural_affinity_v1"
}]->(:GameMechanic)
```

---

## 7. Provenance Pattern

Graph entities must point back to source records.

Example:

```text
(Game {
  id: "GAME_GR_04",
  source_system: "synthetic_warehouse",
  source_record_id: "GAME_GR_04"
})
```

Derived relationships must identify their derivation method.

Example:

```text
SIMILAR_TO {
  method: "mechanic_embedding_plus_overlap",
  version: "v1",
  score: 0.89
}
```

---

## 8. High-Volume Data Strategy

Do not load every transactional event into Neo4j by default.

Preferred pattern:

```text
Neo4j
  stores semantic/relationship layer

Structured data layer
  stores high-volume events
```

Possible graph representations:

- aggregate player-to-game affinity
- segment-level behaviour
- important incident links
- campaign influence links
- shared-device relationships for selected scenarios
- references to transaction/queryable source IDs

High-volume transactional graph ingestion may be enabled only for a specific experiment.

---

## 9. Graph Traversal Classes

### Class 1 — direct lookup

Maximum hop depth: 1

Example:

```text
Game -> Mechanic
```

### Class 2 — local context

Maximum hop depth: 2

Example:

```text
Game -> Platform -> Incident
```

### Class 3 — cross-domain

Maximum hop depth: 3-4

Example:

```text
Game -> Platform -> Incident -> Market
```

### Class 4 — ontology-assisted

Maximum hop depth: configurable 4-5

Example:

```text
Game
-> INSTANCE_OF
-> CanonicalConcept
<- INSTANCE_OF
<- OtherMarketGame
```

Always apply:

- relationship whitelist
- node-type whitelist
- maximum candidate nodes
- timeout
- context budget

---

## 10. Indexes and Constraints

Create unique constraints on stable IDs.

Minimum:

```text
Market.market_id
Game.game_id
GameMechanic.mechanic_id
PlayerSegment.segment_id
Platform.platform_id
PlatformVersion.platform_version_id
Incident.incident_id
Campaign.campaign_id
Document.document_id
DocumentChunk.chunk_id
BusinessConcept.concept_id
```

Create indexes for common lookup properties:

```text
market_code
name
source_record_id
concept_type
```

Vector indexes may be added where required for graph-native retrieval.

---

## 11. Cypher Organisation

No raw Cypher scattered through unrelated modules.

Recommended:

```text
graph/cypher/
  game_context.cypher
  incident_context.cypher
  cross_market_similarity.cypher
  ontology_expansion.cypher
  evidence_paths.cypher
```

Queries should be parameterised.

Never interpolate raw user text into Cypher.

---

## 12. Graph Retrieval Telemetry

Every traversal operation should produce structured events such as:

```json
{
  "event": "graph.node.seeded",
  "run_id": "RUN-001",
  "payload": {
    "node_id": "GAME_GR_04",
    "node_type": "Game",
    "reason": "semantic_seed"
  }
}
```

```json
{
  "event": "graph.relationship.traversed",
  "run_id": "RUN-001",
  "payload": {
    "source_id": "GAME_GR_04",
    "relationship_type": "RUNS_ON",
    "target_id": "PLATFORM_MOBILE_02",
    "hop": 1
  }
}
```

---

## 13. Visualisation Constraints

The live graph view must not exceed a configurable visible-node limit.

Default:

```text
maximum_visible_nodes = 80
maximum_visible_edges = 120
```

The retrieval engine may inspect more candidates internally.

The UI should collapse or summarise hidden candidates.

---

## 14. Evidence Path

Every graph-supported claim should be able to return one or more evidence paths.

Example:

```text
GAME_GR_04
-> RUNS_ON
-> PLATFORM_MOBILE_02
<- RELATED_TO
<- INCIDENT_028
-> AFFECTS_MARKET
-> MARKET_AT
```

Evidence paths must retain source provenance.

---

## 15. Graph Augmentation Demonstration

The POC must include a visual architecture view showing:

```text
Existing source data
      |
Entity mapping
      |
Ontology
      |
Neo4j semantic overlay
      |
Agent retrieval
```

The architecture must make clear that underlying data systems remain authoritative.

---

## 16. HITL Gate

This specification is subject to **HITL-04 Ontology and Graph Model Approval**.

Before implementation, present:

- node labels
- relationships
- directionality
- provenance strategy
- constraints/indexes
- example traversals
- graph vs source-layer boundaries

Do not implement final GraphRAG before explicit approval.
