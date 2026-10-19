# Synthetic Data Specification

## As built (v2, 2026-10-19)

This section describes what the generator does now (`generator_version 0.2.0`).
Where it conflicts with an earlier section, this section wins.
Superseded: section 5 (shared reference data), section 7 (master data list) and the section 3 profile volumes.

**Market-owned reference data.**
Each market owns its reference data and codes, with display names in the market language.
Game families, game categories, game mechanics, incident types, support categories and player segments exist once per market.
Example: the national draw family is `FAM_UK_NATIONAL_DRAW` in the UK and `FAM_GR_ARITHMOLACHEIO` in Greece.
Channel codes are the one exception and stay shared across markets (D-013).
Nothing in the source layer links equivalent codes across markets; only the ontology does.
Market-local codes live in `app/datasets/taxonomies.py`.

**Tables added in v2.**
`game_families`, `game_categories`, `game_mechanics`, `incident_types`, `support_categories` and `player_segments` (all with `market_id` and `language_code`), plus `payment_providers`.
`payment_methods` now reference a provider, `players` reference `player_segments`, and `incidents` and `support_cases` reference their local type and category tables.
The table list, column types, foreign keys and id formats are defined in `app/datasets/schema.py`, which is authoritative.

**`business_concepts` removed.**
Concepts belong to the ontology (`schemas/ontology/ontology.yaml`), not to the source layer.
Section 7 no longer applies to business concepts.

**Profiles.**

| Profile | Players | Tickets | Incidents | Campaigns per market | Experiments |
|---|---|---|---|---|---|
| tiny | 200 | 2,000 | 25 | 3 | 6 |
| dev | 10,000 | 250,000 | 40 | 4 | 8 |
| demo | 100,000 | 5,000,000 | 120 | 6 | 12 |
| stress | 1,000,000 | 50,000,000 | 400 | 8 | 16 |

The remaining volumes (sessions, exposures, retailers, devices, support cases, documents) are in `app/datasets/config.py`.
The catalogue stays at 20 games for every profile.

**Distribution constants.**
Shared distribution shapes are named and documented in `app/datasets/distributions.py` (market splits, segment weights, Pareto activity, win and claim shares, severity weights and chunking).
Shape numbers specific to one table or one scenario may stay in their module when they are named and commented (D-020).

**App sessions.**
Each market releases four app versions, on days 10, 90, 170 and 250 of the window.
An APP session only runs an app version its market had released by the session start.
Among the released versions the second release is the dominant deployed version once it exists, and the first release is dominant before that.
A session that would be APP before the market's first release falls back to the `WEB` channel with no device.
Validation reports any session whose app version was released after the session started.

**Documents.**
Baseline documents take every shape a planted document takes, so no planted document is structurally unique.
With probability `REVIEW_SUBJECTLESS_SHARE` (0.4) a monthly market review covers the reporting period of its market instead of one game: its title ends in "Reporting Period" and its `source_record_id` is empty.
Cross-market incidents join every market's incident pool; an incident report or post-incident review about one is a corporate English document with no market.
An incident summary names its platform version label and id whenever the incident has a platform version.

**KPIs.**
`conversion_rate` is the share of engaged campaign exposures that converted, computed per market and day.

**Chunking.**
Documents are split on sentence boundaries into windows of at most 160 words, with the last sentence repeated at the start of the next window.
Decimals, version labels and ids survive intact.
`CHUNK_MAX_WORDS` and `CHUNK_OVERLAP_SENTENCES` set the rule.

**Determinism.**
`generator_version`, `world_seed`, `scenario_seed` and the configuration are recorded in the manifest.
Golden hashes in the test suite pin the world and the truth ledger across processes.

---

## 1. Purpose

Create a deterministic synthetic enterprise dataset representing a multinational lottery operator across:

- United Kingdom
- Greece
- Austria
- Czech Republic

The data must be realistic enough to support:

- conventional RAG
- SQL/data-layer retrieval
- graph construction
- ontology mapping
- cross-market reasoning
- hidden pattern injection
- benchmark scoring
- visual demos

The dataset must be fully synthetic and must not copy proprietary records, internal naming, real customer data, or real operational documents.

---

## 2. Architectural Principle

The synthetic environment must model an **existing enterprise data layer** first.

Neo4j is added as a semantic overlay.

The source layer remains authoritative for operational facts such as:

- transactions
- sessions
- support records
- campaign exposures
- revenue metrics
- releases
- incidents
- draw results

The graph adds:

- typed entities
- relationships
- ontology mappings
- cross-market equivalence
- provenance
- contextual paths

---

## 3. Dataset Profiles

### Development

Fast generation for engineering iteration.

- Players: 10,000
- Games: 20
- Tickets/transactions: 250,000
- Sessions: 100,000
- Campaign exposures: 100,000
- Retailers: 500
- Devices: 12,000
- Support cases: 2,000
- Documents: 250

### Demo

Primary presentation and benchmark profile.

- Players: 100,000
- Games: 40
- Tickets/transactions: 5,000,000
- Sessions: 2,000,000
- Campaign exposures: 3,000,000
- Retailers: 5,000
- Devices: 120,000
- Support cases: 50,000
- Documents: 2,000

### Stress

Optional performance profile.

- Players: 1,000,000
- Games: 60
- Tickets/transactions: 50,000,000
- Sessions: 20,000,000
- Campaign exposures: 30,000,000
- Retailers: 20,000
- Devices: 1,000,000
- Support cases: 500,000
- Documents: 10,000

Every value must be configuration-driven.

---

## 4. Determinism

Every generated world must record:

```text
generator_version
world_seed
scenario_seed
profile
generation_timestamp
```

Identical:

```text
generator_version + world_seed + scenario_seed + configuration
```

must reproduce an equivalent dataset.

Synthetic IDs must be stable within a generated world.

---

## 5. Market Profiles

### United Kingdom

Synthetic characteristics:

- GBP
- English-first documents
- strong retail + digital presence
- flagship national draw products
- multinational jackpot-style game
- annuity/fixed-prize products
- digital instant-win catalogue
- high use of web/mobile account channels

### Greece

Synthetic characteristics:

- EUR
- Greek-first local operational documents with selected English corporate documents
- extensive physical agency network
- numerical lottery products
- high-frequency numbers products
- instant products
- strong retail-to-digital interaction opportunities

### Austria

Synthetic characteristics:

- EUR
- German-first documents
- traditional draw products
- supplementary/add-on products
- multinational products
- web/app/retail channels
- explicit base-game/add-on relationships

### Czech Republic

Synthetic characteristics:

- CZK
- Czech-first documents
- national draw products
- multinational products
- high-frequency games
- rapid draw products
- retail and digital channels

These profiles guide synthetic distributions only. They must not reproduce proprietary structures.

---

## 6. Core Source Tables

### 6.1 markets

```text
market_id             string PK
market_code           enum: UK, GR, AT, CZ
market_name           string
currency_code         GBP/EUR/CZK
primary_language      en/el/de/cs
timezone              string
digital_maturity      float 0..1
retail_intensity      float 0..1
active_from           date
```

### 6.2 games

```text
game_id               string PK
market_id             FK
game_name             fictional string
game_family_id        FK
game_category_code    string
launch_date           date
retirement_date       nullable date
status                 ACTIVE/RETIRED/TEST
ticket_price          decimal
currency_code         string
draw_frequency_code   string
jackpot_type_code     string
prize_model_code      string
digital_enabled       bool
retail_enabled        bool
```

### 6.3 game_mechanics

```text
mechanic_id           string PK
mechanic_code         string
mechanic_name         string
description           string
```

### 6.4 game_mechanic_map

```text
game_id               FK
mechanic_id           FK
importance_weight     float
valid_from            date
valid_to              nullable date
```

### 6.5 players

Use synthetic identities only.

```text
player_id             string PK
market_id             FK
synthetic_age_band    enum
synthetic_region_id   FK
registration_date     date
acquisition_channel   string
account_status        string
value_segment         string
engagement_segment    string
digital_affinity      float 0..1
retail_affinity       float 0..1
```

Do not generate unnecessary PII.

No real names, addresses, phone numbers, emails, or exact dates of birth are required for the POC.

### 6.6 accounts

```text
account_id            string PK
player_id             FK
created_at            timestamp
status                string
verification_state    string
preferred_channel     string
```

### 6.7 devices

```text
device_id             string PK
device_fingerprint    synthetic token
device_family         IOS/ANDROID/WEB/OTHER
os_version_bucket     string
app_capable           bool
first_seen_at         timestamp
```

### 6.8 player_device

```text
player_id             FK
device_id             FK
first_seen_at         timestamp
last_seen_at          timestamp
usage_weight          float
```

### 6.9 payment_methods

```text
payment_method_id     string PK
provider_id           FK
payment_type          CARD/WALLET/BANK/OTHER
synthetic_token       string
created_at            timestamp
```

### 6.10 player_payment_method

```text
player_id
payment_method_id
first_used_at
last_used_at
usage_weight
```

### 6.11 sessions

```text
session_id            string PK
player_id             FK
market_id             FK
device_id             FK nullable
channel_code          APP/WEB/RETAIL
started_at            timestamp
ended_at              timestamp
app_version_id        nullable FK
session_outcome       string
```

### 6.12 tickets

```text
ticket_id             string PK
player_id             nullable FK
game_id               FK
market_id             FK
draw_id               nullable FK
retailer_id           nullable FK
channel_code          string
purchase_timestamp    timestamp
stake_amount          decimal
currency_code         string
ticket_status         string
```

### 6.13 prizes

```text
prize_id              string PK
ticket_id             FK
prize_tier            string
prize_amount          decimal
currency_code         string
claimed               bool
```

### 6.14 draws

```text
draw_id               string PK
game_id               FK
draw_timestamp        timestamp
jackpot_amount        decimal
currency_code         string
result_payload        JSON
rollover_count        int
```

### 6.15 retailers

```text
retailer_id           string PK
market_id             FK
region_id             FK
retailer_type         string
active_from           date
active_to             nullable date
synthetic_cluster     string
```

### 6.16 campaigns

```text
campaign_id           string PK
market_id             FK
campaign_name         fictional
campaign_type         string
start_at              timestamp
end_at                timestamp
budget_amount         decimal
currency_code         string
objective_code        string
```

### 6.17 campaign_game_map

```text
campaign_id
game_id
promotion_weight
```

### 6.18 campaign_exposures

```text
exposure_id           string PK
campaign_id           FK
player_id             FK
channel_code          string
exposed_at            timestamp
engaged               bool
converted_game_id     nullable FK
converted_at          nullable timestamp
```

### 6.19 platforms

```text
platform_id           string PK
platform_name         fictional
platform_type         APP/WEB/PAYMENTS/IDENTITY/DRAW/ANALYTICS
supplier_id           nullable FK
```

### 6.20 platform_versions

```text
platform_version_id   string PK
platform_id           FK
version_label         synthetic
released_at           timestamp
retired_at            nullable timestamp
```

### 6.21 app_versions

```text
app_version_id        string PK
market_id             FK
version_label         string
released_at           timestamp
min_os_bucket         string
```

### 6.22 incidents

```text
incident_id           string PK
market_id             nullable FK
platform_id           nullable FK
platform_version_id   nullable FK
app_version_id        nullable FK
incident_type         string
severity              LOW/MEDIUM/HIGH/CRITICAL
started_at            timestamp
resolved_at           nullable timestamp
summary               synthetic text
root_cause_code       nullable string
```

### 6.23 incident_game_map

```text
incident_id
game_id
impact_weight
```

### 6.24 support_cases

```text
support_case_id       string PK
market_id             FK
player_id             nullable FK
game_id               nullable FK
incident_id           nullable FK
opened_at             timestamp
closed_at             nullable timestamp
category_code         string
sentiment_score       float
summary_text          synthetic text
```

### 6.25 kpi_daily

```text
date
market_id
game_id               nullable
channel_code          nullable
metric_code
metric_value
currency_code         nullable
```

Examples:

```text
active_players
ticket_sales
gross_sales
conversion_rate
session_completion
payment_failure_rate
support_contact_rate
```

### 6.26 experiments

```text
experiment_id
market_id
experiment_name
hypothesis
start_at
end_at
target_segment
primary_metric
result_summary
```

### 6.27 documents

```text
document_id
document_type
market_id             nullable
language_code
title
created_at
valid_from
valid_to               nullable
source_system_code
source_record_id       nullable
body
```

### 6.28 document_chunks

```text
chunk_id
document_id
chunk_index
text
token_count
embedding_version
```

---

## 7. Additional Synthetic Master Data

Generate:

- regions
- player segments
- suppliers
- channels
- currencies
- languages
- game families
- game categories
- prize types
- campaign objectives
- incident categories
- support categories
- business concepts

---

## 8. Distribution Rules

Generation should be distribution-driven, not uniformly random.

Examples:

- player activity follows long-tail frequency
- a minority of players generates a disproportionate share of transactions
- digital affinity varies by market and age band
- game preference varies by segment
- jackpot size influences activity for relevant draw products
- campaign conversion is correlated with segment/game affinity
- support contacts increase around genuine planted incidents
- device usage is mostly one-to-one but with realistic shared-device exceptions
- payment methods are mostly unique but selected synthetic clusters can share them
- retailer activity follows heavy-tail patterns
- session outcomes vary by platform version and scenario state

All distributions must be documented and seeded.

---

## 9. Synthetic Documents

Documents should reference source entities using stable IDs internally.

Document types:

```text
PRODUCT_SPEC
GAME_RULES
RELEASE_NOTE
INCIDENT_REPORT
POST_INCIDENT_REVIEW
MARKETING_BRIEF
CAMPAIGN_EVALUATION
SUPPORT_SUMMARY
MONTHLY_MARKET_REVIEW
EXPERIMENT_REPORT
MEETING_NOTE
PLATFORM_DOCUMENTATION
POLICY
TECHNICAL_INTEGRATION_NOTE
```

Some documents should be generated in local languages.

Important facts must sometimes be split across documents so retrieval systems must combine evidence.

---

## 10. Provenance

Every graphable entity created from source data must retain:

```text
source_system
source_table
source_record_id
source_timestamp
ingestion_version
```

For document-derived concepts also retain:

```text
document_id
chunk_id
extraction_method
confidence
```

---

## 11. Validation

Generation must validate:

- referential integrity
- market/currency consistency
- time-order consistency
- no impossible pre-launch transactions
- no incident resolution before incident start
- no invalid relationship references
- truth-ledger isolation
- deterministic regeneration
- expected scenario signal strength

---

## 12. Acceptance Examples

The demo dataset must support questions such as:

- Which games share mechanics across markets?
- Which player segments moved from one product family to another after a campaign?
- Did an app release correlate with reduced conversion?
- Has a similar platform incident appeared in another market?
- Which support cases are connected to the same underlying platform issue?
- Which products in another market are most structurally similar to a given game?
- Which campaigns could transfer across markets based on shared mechanics and audience characteristics?

---

## 13. HITL Gate

This specification is subject to **HITL-03 Synthetic Data Model Approval**.

Before implementation of large-scale generation, present:

- final table list
- representative sample rows
- market-specific differences
- distribution assumptions
- provenance approach
- dataset profile estimates

Do not proceed beyond HITL-03 without explicit approval.
