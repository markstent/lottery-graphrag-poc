/**
 * Data Dictionary (in-app documentation): what every table, graph node
 * label, relationship type and ontology concept in this POC represents.
 *
 * Everything here is generated from committed sources: the world manifest
 * and _data_dictionary.json (demo world), backend/app/graph/statements.py
 * (node labels and relationship allow-list) and
 * backend/app/datasets/master_data.py (concept catalogue).
 *
 * 2026-10-18 SaaS polish: visual overview (stores, entity chains, graph
 * clusters, ontology binding) stays immediately visible; exhaustive
 * reference catalogues (36 tables, field lists, 26 relationship types)
 * use collapsible disclosures so the page scans cleanly on load.
 */

import { hrefFor } from '../app/router'
import {
  Callout,
  Card,
  Chip,
  Disclosure,
  PageHero,
  Rail,
  Section,
  Table,
} from '../components/doc'

const STORES = [
  {
    title: 'Structured layer',
    tech: 'DuckDB over Parquet',
    body: '36 tables, authoritative for every fact and amount: tickets, prizes, sessions, KPIs. The graph never replaces it.',
  },
  {
    title: 'Graph overlay',
    tech: 'Neo4j',
    body: '26 node labels, 26 relationship types. Entities, relationships, ontology mappings and provenance. It guides queries; it does not state numbers.',
    accent: true,
  },
  {
    title: 'Vector index',
    tech: 'Qdrant',
    body: 'One shared collection of 6,996 document chunks, using the same embedder for pipelines A, B and C.',
  },
] as const

const CHAINS = [
  {
    what: 'Players play',
    rail: [
      { label: 'Player', note: '100,000' },
      { label: 'Ticket', note: '5,000,000' },
      { label: 'Game', note: '20' },
      { label: 'Draw', note: '2,292' },
    ],
  },
  {
    what: 'Platforms fail',
    rail: [
      { label: 'Incident', note: '25' },
      { label: 'Platform', note: '8' },
      { label: 'PlatformVersion', note: '24' },
      { label: 'AppVersion', note: '16' },
    ],
  },
  {
    what: 'Knowledge flows',
    rail: [
      { label: 'Document', note: '2,000' },
      { label: 'Chunk', note: '6,996' },
      { label: 'Vector index' },
    ],
  },
  {
    what: 'Money & identity',
    rail: [
      { label: 'Player' },
      { label: 'Account / Device / PaymentMethod' },
      { label: 'fraud substrates' },
    ],
  },
] as const

const CLUSTERS = [
  {
    name: 'Reference',
    labels: ['Market', 'Region', 'Language', 'Currency', 'Channel', 'Supplier'],
  },
  {
    name: 'Product',
    labels: [
      'Game',
      'GameFamily',
      'GameCategory',
      'GameMechanic',
      'Draw',
      'PrizeType',
    ],
  },
  {
    name: 'Platform',
    labels: ['Platform', 'PlatformVersion', 'AppVersion'],
  },
  {
    name: 'Player',
    labels: ['Player', 'PlayerSegment', 'Device', 'PaymentMethod'],
  },
  {
    name: 'Commercial & ops',
    labels: ['Campaign', 'Experiment', 'Incident', 'SupportCase'],
  },
  {
    name: 'Knowledge',
    labels: ['Document', 'DocumentChunk', 'BusinessConcept'],
    accent: true,
  },
] as const

const TABLE_DOMAINS = [
  {
    domain: 'Reference and master data',
    note: '7 tables · markets, regions, channels, 5,000 retailers',
    defaultOpen: true,
    rows: [
      [
        'markets',
        'market_id',
        'UK, GR, AT, CZ with regulator, timezone, currency',
        '4',
      ],
      ['regions', 'region_id', 'Sub-national regions', '16'],
      ['languages', 'language_code', 'Supported content languages', '4'],
      ['currencies', 'currency_code', 'GBP, EUR, CZK', '3'],
      ['channels', 'channel_code', 'retail, app, web', '3'],
      ['suppliers', 'supplier_id', 'Platform and service suppliers', '6'],
      ['retailers', 'retailer_id', 'Retail estates selling tickets', '5,000'],
    ],
  },
  {
    domain: 'Product catalogue',
    note: '7 tables · 20 games, 2,292 draws, 1.75M prizes',
    defaultOpen: false,
    rows: [
      [
        'games',
        'game_id',
        'Sellable games with prices, jackpot model, market validity',
        '20',
      ],
      [
        'game_families',
        'family_id',
        'Product families (national draw, instant win…)',
        '8',
      ],
      ['game_categories', 'category_code', 'Product categories', '4'],
      ['game_mechanics', 'mechanic_id', 'Play mechanics', '6'],
      ['game_mechanic_map', 'game_id', 'Game-to-mechanic assignments', '23'],
      ['draws', 'draw_id', 'Draw schedule per game', '2,292'],
      [
        'prizes',
        'prize_id',
        'Per-ticket prize outcomes (fact table)',
        '1,750,899',
      ],
    ],
  },
  {
    domain: 'Players, money and identity',
    note: '6 tables · 100k players, devices, tokenised payment instruments',
    defaultOpen: false,
    rows: [
      [
        'players',
        'player_id',
        'Synthetic demographics, value and engagement segments',
        '100,000',
      ],
      [
        'accounts',
        'account_id',
        'Web accounts with verification state',
        '100,000',
      ],
      ['devices', 'device_id', 'Known devices: fingerprint, family', '120,000'],
      [
        'player_device',
        'player_id + device_id',
        'Who used which device, when (fraud substrate)',
        '108,047',
      ],
      [
        'payment_methods',
        'payment_method_id',
        'Tokenised instruments (no PAN)',
        '95,909',
      ],
      [
        'player_payment_method',
        'player_id + payment_method_id',
        'Who used which instrument, usage weight (fraud substrate)',
        '100,000',
      ],
    ],
  },
  {
    domain: 'Commercial and operations',
    note: '11 tables · campaigns, platforms, 25 incidents, 50k support cases',
    defaultOpen: false,
    rows: [
      [
        'campaigns',
        'campaign_id',
        'Marketing campaigns with budgets and dates',
        '12',
      ],
      [
        'campaign_game_map',
        'campaign_id + game_id',
        'Games a campaign promotes',
        '23',
      ],
      [
        'campaign_exposures',
        'exposure_id',
        'Per-player impressions and engagement (fact table)',
        '3,000,000',
      ],
      [
        'experiments',
        'experiment_id',
        'Controlled pricing and experience experiments',
        '6',
      ],
      ['kpi_daily', 'date', 'Daily market KPIs (fact table)', '19,784'],
      ['platforms', 'platform_id', 'Sales platforms and suppliers', '8'],
      [
        'platform_versions',
        'platform_version_id',
        'Platform release versions',
        '24',
      ],
      [
        'app_versions',
        'app_version_id',
        'App releases deployed per market',
        '16',
      ],
      [
        'incidents',
        'incident_id',
        'Incidents with severity and root cause',
        '25',
      ],
      [
        'incident_game_map',
        'incident_id + game_id',
        'Games affected by an incident',
        '46',
      ],
      ['support_cases', 'support_case_id', 'Customer support cases', '50,000'],
    ],
  },
  {
    domain: 'Documents and activity',
    note: '4 tables · 2,000 documents, 6,996 chunks, 5M tickets',
    defaultOpen: false,
    rows: [
      [
        'documents',
        'document_id',
        'Knowledge documents with validity windows',
        '2,000',
      ],
      [
        'document_chunks',
        'chunk_id',
        'Retrieval chunks, indexed in Qdrant',
        '6,996',
      ],
      ['sessions', 'session_id', 'Player sessions (fact table)', '2,000,000'],
      ['tickets', 'ticket_id', 'Ticket purchases (fact table)', '5,000,000'],
    ],
  },
]

function OntologyBinding() {
  return (
    <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1.2fr]">
      <ul className="space-y-2 border-l-2 border-graph/40 pl-4">
        {[
          ['INC_S007_GR', 'Incident · Greece'],
          ['INC_S007_AT', 'Incident · Austria'],
          ['INC_S007_CZ', 'Incident · Czech Republic'],
        ].map(([id, note]) => (
          <li
            key={id}
            className="rounded-card border border-border bg-surface-raised px-3 py-2"
          >
            <p className="font-mono text-xs font-medium text-primary">{id}</p>
            <p className="text-xs text-muted">{note}</p>
          </li>
        ))}
      </ul>
      <span aria-hidden className="text-xl text-muted">
        →
      </span>
      <div className="rounded-card border border-graph/60 bg-surface p-4">
        <p className="font-mono text-sm font-semibold text-primary">
          CONCEPT_PLATFORM_INCIDENT
        </p>
        <p className="mt-1 text-xs text-secondary">
          One BusinessConcept of type BusinessEvent. A question mentioning any
          one of the three incidents discovers the other two through this shared
          node; that traversal is pipeline C only.
        </p>
      </div>
    </div>
  )
}

export function DataDictionary() {
  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Data Dictionary"
        title="What every table, node and relationship represents"
        lead="The synthetic enterprise behind this app spans 36 warehouse tables, 26 graph node labels, 26 relationship types and 10 canonical ontology concepts. Figures quote the demo world (seed 2026); the schema is identical across profiles."
      >
        <Callout title="How to read this page">
          Start with the three stores and four entity chains below for the
          mental model. Expand any domain drawer underneath when you need exact
          table keys, field types or edge definitions.
        </Callout>
      </PageHero>

      <Section
        id="stores"
        title="One world, three stores"
        lead="Each store has one job; provenance links them all."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {STORES.map((store) => (
            <Card
              key={store.title}
              title={store.title}
              footer={
                <p className="font-mono text-xs text-muted">{store.tech}</p>
              }
            >
              <p>{store.body}</p>
            </Card>
          ))}
        </div>
        <p>
          Every graph node carries <Chip>source_system</Chip> and{' '}
          <Chip>source_record_id</Chip>, so any claim in an answer traces back
          to an authoritative warehouse row.
        </p>
      </Section>

      <Section
        id="chains"
        title="How the data connects"
        lead="Four chains cover most questions; high-volume fact tables stay in the warehouse."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {CHAINS.map((chain) => (
            <div
              key={chain.what}
              className="rounded-card border border-border bg-surface p-3.5"
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {chain.what}
              </p>
              <Rail items={chain.rail} />
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="tables"
        title="Warehouse tables & fields"
        lead="36 tables across five domains. Expand a domain to inspect its keys and row counts."
      >
        <div className="space-y-2">
          {TABLE_DOMAINS.map((group) => (
            <Disclosure
              key={group.domain}
              summary={group.domain}
              note={group.note}
              defaultOpen={group.defaultOpen}
            >
              <Table
                head={['Table', 'Key', 'Represents', 'Rows']}
                rows={group.rows}
              />
            </Disclosure>
          ))}
          <Disclosure
            summary="Core tables, field by field"
            note="10 tables · exact column schemas · zero PII"
          >
            <Table
              head={['Table', 'Fields']}
              rows={[
                [
                  'tickets',
                  'ticket_id, player_id, game_id, market_id, draw_id, retailer_id, channel_code, purchase_timestamp, stake_amount DECIMAL(12,2), currency_code, ticket_status',
                ],
                [
                  'players',
                  'player_id, market_id, synthetic_age_band, synthetic_region_id, registration_date, acquisition_channel, account_status, value_segment, engagement_segment, digital_affinity, retail_affinity',
                ],
                [
                  'accounts',
                  'account_id, player_id, created_at, status, verification_state, preferred_channel',
                ],
                [
                  'devices',
                  'device_id, device_fingerprint, device_family, os_version_bucket, app_capable, first_seen_at',
                ],
                [
                  'player_device',
                  'player_id, device_id, first_seen_at, last_seen_at, usage_weight',
                ],
                [
                  'payment_methods',
                  'payment_method_id, provider_id, payment_type, synthetic_token, created_at',
                ],
                [
                  'player_payment_method',
                  'player_id, payment_method_id, first_used_at, last_used_at, usage_weight',
                ],
                [
                  'incidents',
                  'incident_id, market_id, platform_id, platform_version_id, app_version_id, incident_type, severity, started_at, resolved_at, summary, root_cause_code',
                ],
                [
                  'sessions',
                  'session_id, player_id, market_id, device_id, channel_code, started_at, ended_at, app_version_id, session_outcome',
                ],
                [
                  'documents',
                  'document_id, document_type, market_id, language_code, title, created_at, valid_from, valid_to, source_system_code, source_record_id, body',
                ],
              ]}
            />
          </Disclosure>
        </div>
      </Section>

      <Section
        id="graph"
        title="The graph overlay"
        lead="26 node labels in six clusters and 26 relationship types, verified against backend/app/graph/statements.py after every ingestion."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CLUSTERS.map((cluster) => (
            <Card key={cluster.name} title={cluster.name}>
              <div className="flex flex-wrap gap-1.5">
                {cluster.labels.map((label) => (
                  <Chip key={label}>{label}</Chip>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <Table
          head={['Derived relationship', 'Meaning', 'Carries']}
          rows={[
            [
              '(:Player)-[:PLAYS]->(:Game)',
              'player has bought tickets for this game',
              'ticket_count, last_purchase_at',
            ],
            [
              '(:Player)-[:EXPOSED_TO]->(:Campaign)',
              'player was exposed to this campaign',
              'exposure_count, engaged_count',
            ],
            [
              '(:Player)-[:USES_PAYMENT]->(:PaymentMethod)',
              'instrument association',
              'first_used_at, last_used_at, usage_weight',
            ],
          ]}
        />
        <Disclosure
          summary="All 26 relationship types and their endpoints"
          note="Product, player, operational, document and ontology edges"
          defaultOpen
        >
          <Table
            head={['Relationship', 'From → To', 'Meaning']}
            rows={[
              [
                'AVAILABLE_IN',
                'Game → Market',
                'markets where the game is sold',
              ],
              ['AVAILABLE_VIA', 'Game → Channel', 'sales channels'],
              [
                'BELONGS_TO',
                'Game → GameFamily; Player → PlayerSegment',
                'product family; segment membership',
              ],
              ['HAS_MECHANIC', 'Game → GameMechanic', 'play mechanics'],
              ['HAS_DRAW', 'Game → Draw', 'scheduled draws'],
              ['RUNS_ON', 'Game → Platform', 'hosting platform'],
              ['SIMILAR_TO', 'Game → Game', 'derived product similarity'],
              ['VERSION_OF', 'PlatformVersion → Platform', 'release lineage'],
              ['DEPLOYED_TO', 'AppVersion → Market', 'app release footprint'],
              ['USES', 'Player → Device', 'derived from player_device'],
              [
                'USES_PAYMENT',
                'Player → PaymentMethod',
                'derived instrument association',
              ],
              ['PLAYS', 'Player → Game', 'derived purchases (aggregated)'],
              [
                'EXPOSED_TO',
                'Player → Campaign',
                'derived exposures (aggregated)',
              ],
              ['PROMOTES', 'Campaign → Game', 'campaign promotes game'],
              [
                'TARGETS',
                'Campaign → PlayerSegment',
                'campaign targets a segment',
              ],
              [
                'RELATED_TO',
                'Incident → Platform; SupportCase → Incident',
                'incident platform; case about incident',
              ],
              [
                'RELATED_TO_VERSION',
                'Incident → PlatformVersion',
                'the faulty release',
              ],
              [
                'RELATED_TO_APP_VERSION',
                'Incident → AppVersion',
                'the app release involved',
              ],
              [
                'AFFECTS',
                'Incident → Game / PlayerSegment',
                'what the incident affected',
              ],
              ['AFFECTS_MARKET', 'Incident → Market', 'markets impacted'],
              ['CONCERNS', 'SupportCase → Game', 'case subject'],
              ['FROM_MARKET', 'SupportCase → Market', 'case origin'],
              [
                'REFERENCES',
                'Document → Game / Incident / Campaign / AppVersion / Experiment',
                'document citations into the world',
              ],
              ['HAS_CHUNK', 'Document → DocumentChunk', 'retrieval chunks'],
              [
                'INSTANCE_OF',
                'Game / GameFamily / GameMechanic → BusinessConcept',
                'ontology binding',
              ],
              [
                'MAPS_TO',
                'GameMechanic / PlayerSegment / Channel / Incident → BusinessConcept',
                'ontology mapping',
              ],
            ]}
          />
        </Disclosure>
      </Section>

      <Section
        id="ontology"
        title="The ontology"
        lead="Ten canonical BusinessConcept nodes (version 1.0.0) in backend/app/graph/mapping.py; traversed only by pipeline C."
      >
        <OntologyBinding />
        <Table
          head={['concept_id', 'Type', 'Meaning']}
          rows={[
            ['CONCEPT_NATIONAL_DRAW', 'Game', 'National draw lottery product'],
            [
              'CONCEPT_MULTINATIONAL_JACKPOT',
              'Game',
              'Multinational jackpot product',
            ],
            [
              'CONCEPT_HIGH_FREQUENCY_GAME',
              'Game',
              'High-frequency number product',
            ],
            ['CONCEPT_INSTANT_PRODUCT', 'Game', 'Instant-win product'],
            ['CONCEPT_ADD_ON_PRODUCT', 'Game', 'Supplementary add-on product'],
            [
              'CONCEPT_PROGRESSIVE_JACKPOT',
              'PrizeModel',
              'Progressive rolling jackpot',
            ],
            [
              'CONCEPT_PLAYER_SEGMENT',
              'PlayerSegment',
              'Behavioural player cohort',
            ],
            ['CONCEPT_RETAIL_CHANNEL', 'Channel', 'Physical retail channel'],
            ['CONCEPT_DIGITAL_CHANNEL', 'Channel', 'App and web channel'],
            [
              'CONCEPT_PLATFORM_INCIDENT',
              'BusinessEvent',
              'Platform incident affecting products',
            ],
          ]}
        />
        <Disclosure
          summary="Mapping sources & authoritative repo files"
          note="How domain rows bind to concepts · specification paths"
        >
          <div className="space-y-4">
            <Table
              head={['Source vocabulary', 'Maps to']}
              rows={[
                [
                  'Game families (8): national draw, annuity, fixed prize → one concept; multinational, high-frequency, instant…',
                  'Game concepts',
                ],
                [
                  'Mechanic MECH_PROGRESSIVE_JACKPOT',
                  'CONCEPT_PROGRESSIVE_JACKPOT',
                ],
                ['Player segments', 'CONCEPT_PLAYER_SEGMENT'],
                [
                  'Channels RETAIL / APP / WEB',
                  'retail vs digital channel concepts',
                ],
                [
                  'Incident types INC_PAYMENTS, INC_APP_STABILITY, INC_DRAW_DELAY, INC_LOGIN, INC_RETAIL_TERMINAL',
                  'CONCEPT_PLATFORM_INCIDENT',
                ],
              ]}
            />
            <Table
              head={['Artefact', 'Where']}
              rows={[
                [
                  'Field-level schema and generation rules',
                  '_data_dictionary.json next to each dataset; docs/01-synthetic-data-spec.md §6–7',
                ],
                [
                  'Provenance contract',
                  'docs/data/source-system-contracts.md, docs/data/provenance-model.md',
                ],
                [
                  'Graph schema',
                  'docs/02-graph-schema-spec.md; allow-list in backend/app/graph/statements.py',
                ],
                [
                  'Ontology spec and mappings',
                  'docs/03-ontology-spec.md; backend/app/graph/mapping.py',
                ],
              ]}
            />
          </div>
        </Disclosure>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-ontology/40 bg-surface-raised p-3">
          <p className="text-xs text-secondary">
            Want to click through how warehouse tables, documents and telemetry
            bind to these concepts step by step?
          </p>
          <a
            href={hrefFor('semantic')}
            className="rounded-chip border border-ontology/50 px-3 py-1 text-xs font-medium text-ontology transition-colors duration-micro hover:bg-ontology/15"
          >
            Open interactive Semantic Layer →
          </a>
        </div>
        <Callout title="Honest scope note">
          The ontology spec reserves further vocabulary (IS_A, EQUIVALENT_TO,
          CAUSES and others, docs/03 §5) that this POC does not populate. Only
          INSTANCE_OF and MAPS_TO bindings exist, and tests pin pipeline C to
          exactly that.
        </Callout>
      </Section>
    </div>
  )
}
