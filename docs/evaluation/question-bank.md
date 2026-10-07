# Initial 30-Question Logical Benchmark

## Q01 — FACT
**Scope:** UK

**Question:** What is the configured ticket price of the synthetic UK flagship draw game?

**Binding key:** `game_price`

## Q02 — FACT
**Scope:** GR

**Question:** Which channels offer the selected Greek high-frequency game?

**Binding key:** `game_channels`

## Q03 — FACT
**Scope:** AT

**Question:** What platform version was active for the selected Austrian digital game on the target date?

**Binding key:** `platform_version`

## Q04 — FACT
**Scope:** CZ

**Question:** How many synthetic support cases were recorded for the selected Czech game in the target week?

**Binding key:** `support_count`

## Q05 — SEMANTIC
**Scope:** UK

**Question:** Summarise the mechanics of the synthetic UK annuity-style game.

**Binding key:** `product_mechanics`

## Q06 — SEMANTIC
**Scope:** GR

**Question:** Which support documents are most relevant to checkout problems for the selected Greek game?

**Binding key:** `support_retrieval`

## Q07 — SEMANTIC
**Scope:** AT

**Question:** Which release note best explains changes to the selected Austrian mobile flow?

**Binding key:** `release_retrieval`

## Q08 — SEMANTIC
**Scope:** CZ

**Question:** Which synthetic experiment report is most relevant to the selected Czech product?

**Binding key:** `experiment_retrieval`

## Q09 — RELATIONSHIP
**Scope:** UK

**Question:** Which player segment has the strongest affinity with the selected game mechanic?

**Binding key:** `segment_mechanic`

## Q10 — RELATIONSHIP
**Scope:** GR

**Question:** Which platform supports the selected Greek digital game?

**Binding key:** `game_platform`

## Q11 — RELATIONSHIP
**Scope:** AT

**Question:** Which campaign promoted the selected Austrian game during the target period?

**Binding key:** `campaign_game`

## Q12 — RELATIONSHIP
**Scope:** CZ

**Question:** Which incidents are directly connected to the selected Czech platform?

**Binding key:** `platform_incident`

## Q13 — TWO_HOP
**Scope:** UK

**Question:** Which games run on the platform associated with the selected UK incident?

**Binding key:** `incident_platform_games`

## Q14 — TWO_HOP
**Scope:** GR

**Question:** Which player segments were affected by the incident linked to the selected Greek app version?

**Binding key:** `version_incident_segment`

## Q15 — TWO_HOP
**Scope:** AT

**Question:** Which game mechanics are shared by games targeted by the selected Austrian campaign?

**Binding key:** `campaign_games_mechanics`

## Q16 — TWO_HOP
**Scope:** CZ

**Question:** Which support cases relate to incidents affecting the selected Czech game?

**Binding key:** `game_incident_support`

## Q17 — MULTI_HOP
**Scope:** GR

**Question:** Why did digital conversion fall for the selected Greek game after the target release?

**Binding key:** `app_release_conversion_failure`

## Q18 — MULTI_HOP
**Scope:** AT

**Question:** Which other products may have been affected by the same underlying platform issue as the selected Austrian game?

**Binding key:** `shared_platform_issue`

## Q19 — MULTI_HOP
**Scope:** UK

**Question:** Did the selected campaign cause players to migrate between product families?

**Binding key:** `promotion_product_migration`

## Q20 — MULTI_HOP
**Scope:** CZ

**Question:** Is the selected product launch cannibalising another structurally similar Czech game?

**Binding key:** `product_cannibalisation`

## Q21 — CROSS_DOMAIN
**Scope:** GR

**Question:** Did support complaints provide an earlier signal of the selected Greek incident than KPI reporting?

**Binding key:** `support_precursor`

## Q22 — CROSS_DOMAIN
**Scope:** UK

**Question:** Did a large jackpot create measurable halo activity in related synthetic UK products?

**Binding key:** `jackpot_halo`

## Q23 — CROSS_DOMAIN
**Scope:** AT

**Question:** Why did the selected Austrian campaign underperform despite high exposure?

**Binding key:** `campaign_mismatch`

## Q24 — CROSS_DOMAIN
**Scope:** CZ

**Question:** What best explains the selected regional retailer anomaly?

**Binding key:** `retailer_anomaly`

## Q25 — CROSS_MARKET
**Scope:** GR,AT,CZ,UK

**Question:** Have we seen the selected Greek platform problem in another market?

**Binding key:** `cross_market_platform_incident`

## Q26 — ONTOLOGY
**Scope:** UK,AT

**Question:** Which Austrian product is structurally most similar to the synthetic UK flagship draw game, and why?

**Binding key:** `cross_market_product_similarity`

## Q27 — ONTOLOGY
**Scope:** GR,CZ

**Question:** Which Czech product is most comparable to the selected Greek high-frequency game based on canonical mechanics?

**Binding key:** `ontology_equivalence`

## Q28 — PATTERN
**Scope:** ALL

**Question:** Are there unusual account clusters connected through shared devices or payment instruments?

**Binding key:** `shared_identity_cluster`

## Q29 — CROSS_MARKET
**Scope:** AT,CZ

**Question:** Which successful Austrian campaign appears most transferable to a Czech product and segment?

**Binding key:** `campaign_transferability`

## Q30 — TEMPORAL_ONTOLOGY
**Scope:** ALL

**Question:** Where do current structured facts conflict with older documentation, and which source should be treated as authoritative?

**Binding key:** `document_structured_conflict`
