/**
 * Data Dictionary (in-app documentation): what every table, graph node
 * label, relationship type and ontology concept in this POC represents.
 *
 * Everything here is generated from committed sources: the world manifest
 * and _data_dictionary.json (demo world), backend/app/graph/statements.py
 * (node labels and relationship allow-list) and
 * backend/app/datasets/master_data.py (concept catalogue).
 *
 * 2026-10-18 SaaS redesign: interactive Sample Data Explorer at the top
 * showing real rows from the demo world (incidents, games, documents,
 * players, tickets), and a 4-tab view switcher (Sample Data, Warehouse
 * Tables, Graph Schema, Ontology) so only one focused layer is visible at
 * a time instead of an endless vertical scroll.
 */

import { useState } from 'react'

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

type DictionaryTab = 'samples' | 'warehouse' | 'graph' | 'ontology'

const SAMPLE_TABLES = [
  {
    id: 'incidents',
    name: 'incidents.parquet',
    rows: '25 rows',
    what: 'An incident is a recorded failure or degradation of a sales platform: a broken checkout after a platform update, an app that crashes on launch, a delayed draw. Each row records the affected market, the platform version involved, a severity (LOW, MEDIUM, HIGH), the start and resolution times, a plain-text summary and a root-cause code.',
    takeaway:
      'Notice how INC_S007_GR and INC_S007_AT occur in different countries (Greece vs Austria) and have different severities, yet share platform_version_id = PLV_PAYMENTS_3 and root_cause_code = RC_77. Conventional RAG reads one country’s text report; the graph traverses PLV_PAYMENTS_3 and CONCEPT_PLATFORM_INCIDENT across markets.',
    head: [
      'incident_id',
      'market_id',
      'platform_version_id',
      'incident_type',
      'severity',
      'root_cause_code',
      'started_at',
      'summary',
    ],
    records: [
      [
        'INC_S007_GR',
        'MKT_GR',
        'PLV_PAYMENTS_3',
        'INC_PAYMENTS',
        'HIGH',
        'RC_77',
        '2025-05-21 09:00',
        'Payment checkout failures on platform version PLV_PAYMENTS_3…',
      ],
      [
        'INC_S007_AT',
        'MKT_AT',
        'PLV_PAYMENTS_3',
        'INC_PAYMENTS',
        'MEDIUM',
        'RC_77',
        '2025-05-22 09:00',
        'Payment checkout failures on platform version PLV_PAYMENTS_3…',
      ],
      [
        'INC_001',
        'MKT_UK',
        'PLV_APP_IOS_1',
        'INC_APP_STABILITY',
        'LOW',
        'none',
        '2025-01-17 21:24',
        'Application crashes reported on launch.',
      ],
    ],
  },
  {
    id: 'games',
    name: 'games.parquet',
    rows: '20 rows',
    what: 'A game is a sellable lottery product: its name, product family, ticket price in local currency, draw frequency and market availability. GAME_UK_01 (Albion Millions) is the national draw game used in the pricing conflict demo.',
    takeaway:
      'Authoritative product catalogue. Look at GAME_UK_01 (Albion Millions): its authoritative ticket_price is GBP 2.50, whereas an older rules leaflet in documents.parquet still quotes GBP 1.50 (Scenario SCN-015).',
    head: [
      'game_id',
      'market_id',
      'game_name',
      'game_family_id',
      'ticket_price',
      'currency_code',
      'draw_frequency_code',
      'status',
    ],
    records: [
      [
        'GAME_UK_01',
        'MKT_UK',
        'Albion Millions',
        'FAM_NATIONAL_DRAW',
        '2.50',
        'GBP',
        'TWICE_WEEKLY',
        'ACTIVE',
      ],
      [
        'GAME_UK_02',
        'MKT_UK',
        'Kingsport Draw',
        'FAM_ANNUITY',
        '3.00',
        'GBP',
        'WEEKLY',
        'ACTIVE',
      ],
      [
        'GAME_UK_03',
        'MKT_UK',
        'Thames Cash',
        'FAM_HIGH_FREQUENCY',
        '1.00',
        'GBP',
        'DAILY',
        'ACTIVE',
      ],
    ],
  },
  {
    id: 'documents',
    name: 'documents.parquet',
    rows: '2,000 rows (6,996 chunks in Qdrant)',
    what: 'A document is a piece of operational knowledge written about the business: incident reports, platform release notes and game rules, in English, Greek, German and Czech. Each is only valid inside a date window (valid_from to valid_to), which is how an outdated rules leaflet can disagree with the authoritative price.',
    takeaway:
      'Unstructured knowledge base with validity windows (valid_from → valid_to) and multilingual text (en, el, de, cs). Notice DOC_S015_UK expired on 2025-08-09 and quotes the superseded GBP 1.50 price.',
    head: [
      'document_id',
      'document_type',
      'market_id',
      'lang',
      'title',
      'valid_to',
      'body (excerpt)',
    ],
    records: [
      [
        'DOC_S007_GR',
        'INCIDENT_REPORT',
        'MKT_GR',
        'el',
        'Incident Report: INC_S007_GR',
        'active',
        'Incident INC_S007_GR was raised for payment checkout failures on PLV_PAYMENTS_3…',
      ],
      [
        'DOC_S007_UK',
        'RELEASE_NOTE',
        'MKT_UK',
        'en',
        'Release Note: APPV_UK_530 (Deferred Update)',
        'active',
        'Release APPV_UK_530 defers the PLV_PAYMENTS_3 update for the UK. UK checkout is unaffected.',
      ],
      [
        'DOC_S015_UK',
        'GAME_RULES',
        'MKT_UK',
        'en',
        'Game Rules: GAME_UK_01 (Legacy Pricing)',
        '2025-08-09',
        'Game rules for GAME_UK_01 (Albion Millions). Each ticket costs GBP 1.50 per line…',
      ],
    ],
  },
  {
    id: 'players',
    name: 'players.parquet',
    rows: '100,000 rows',
    what: 'A player is a synthetic registered customer: age band, region, acquisition channel and behavioural segments. The data is deliberately free of personal information; realistic patterns are planted, never real people.',
    takeaway:
      'Synthetic player profiles with zero personal data. Combined with player_payment_method.parquet, the graph derives (:Player)-[:USES_PAYMENT]->(:PaymentMethod) edges to surface shared-instrument rings.',
    head: [
      'player_id',
      'market_id',
      'synthetic_age_band',
      'synthetic_region_id',
      'acquisition_channel',
      'value_segment',
      'engagement_segment',
    ],
    records: [
      [
        'PLAYER_UK_000001',
        'MKT_UK',
        'AGE_25_34',
        'REG_UK_LONDON',
        'ORGANIC',
        'SEG_VALUE_MAINSTREAM',
        'SEG_ENG_DORMANT',
      ],
      [
        'PLAYER_UK_001283',
        'MKT_UK',
        'AGE_35_44',
        'REG_UK_MIDLANDS',
        'PAID_SOCIAL',
        'SEG_VALUE_MAINSTREAM',
        'SEG_ENG_CASUAL',
      ],
      [
        'PLAYER_UK_011283',
        'MKT_UK',
        'AGE_45_54',
        'REG_UK_LONDON',
        'RETAIL_CROSSSELL',
        'SEG_VALUE_BUDGET',
        'SEG_ENG_CASUAL',
      ],
    ],
  },
  {
    id: 'tickets',
    name: 'tickets.parquet',
    rows: '5,000,000 rows',
    what: 'A ticket is one purchased lottery entry: which player bought it, for which game, through which channel (retail shop, app or web), at what time, and the stake paid. Five million of them form the transactional backbone of the world.',
    takeaway:
      'High-volume transactional fact table. Individual tickets stay in DuckDB/Parquet for fast quantitative aggregation; Neo4j stores only the aggregated (:Player)-[:PLAYS {ticket_count}]->(:Game) relationship.',
    head: [
      'ticket_id',
      'player_id',
      'game_id',
      'market_id',
      'channel_code',
      'purchase_timestamp',
      'stake_amount',
      'currency_code',
      'ticket_status',
    ],
    records: [
      [
        'TKT_00929004',
        'PLAYER_UK_018270',
        'GAME_UK_04',
        'MKT_UK',
        'RETAIL',
        '2025-01-01 00:00:02',
        '1.50',
        'GBP',
        'SETTLED',
      ],
      [
        'TKT_00655756',
        'PLAYER_UK_008975',
        'GAME_UK_05',
        'MKT_UK',
        'RETAIL',
        '2025-01-01 00:00:03',
        '2.00',
        'GBP',
        'SETTLED',
      ],
      [
        'TKT_01000923',
        'PLAYER_UK_000335',
        'GAME_UK_05',
        'MKT_UK',
        'RETAIL',
        '2025-01-01 00:00:04',
        '2.00',
        'GBP',
        'SETTLED',
      ],
    ],
  },
] as const

const STORES = [
  {
    title: '1. Structured warehouse',
    tech: 'DuckDB over 36 Parquet tables',
    body: 'Authoritative for numbers and facts: 5M tickets, 100k players, 20 games, 25 incidents. The graph never replaces it.',
  },
  {
    title: '2. Knowledge graph overlay',
    tech: 'Neo4j · 26 node labels · 26 edge types',
    body: 'Connects entities across markets and systems (Incident → PlatformVersion → Market) and retains source_record_id pointers.',
  },
  {
    title: '3. Document vector index',
    tech: 'Qdrant · 6,996 chunks',
    body: 'Shared semantic index over 2,000 incident reports, release notes and game rule documents.',
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
            <p className="font-mono text-xs font-medium text-text-primary">
              {id}
            </p>
            <p className="text-xs text-text-muted">{note}</p>
          </li>
        ))}
      </ul>
      <span aria-hidden className="text-lg text-text-muted">
        →
      </span>
      <div className="rounded-card border border-graph/60 bg-surface p-4">
        <p className="font-mono text-sm font-semibold text-text-primary">
          CONCEPT_PLATFORM_INCIDENT
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          One BusinessConcept of type BusinessEvent. A question mentioning any
          one of the three incidents discovers the other two through this shared
          node; that traversal is pipeline C only.
        </p>
      </div>
    </div>
  )
}

export function DataDictionary() {
  const [activeTab, setActiveTab] = useState<DictionaryTab>('samples')
  const [sampleTableId, setSampleTableId] = useState<string>('incidents')
  const activeSample =
    SAMPLE_TABLES.find((entry) => entry.id === sampleTableId) ??
    SAMPLE_TABLES[0]

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Data Dictionary"
        title="Inspect the synthetic enterprise data, graph and ontology"
        lead="Browse real example rows from the demo dataset (seed 2026) first, or switch tabs below to inspect the 36 warehouse tables, 26 Neo4j node labels, 26 relationship types and 10 ontology concepts."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {STORES.map((store) => (
            <Card
              key={store.title}
              title={store.title}
              footer={
                <p className="font-mono text-xs text-text-muted">
                  {store.tech}
                </p>
              }
            >
              <p>{store.body}</p>
            </Card>
          ))}
        </div>
      </PageHero>

      <div
        role="tablist"
        aria-label="Dictionary views"
        className="flex flex-wrap gap-1 border-b border-border pb-2"
      >
        {(
          [
            ['samples', '1 · Sample Database Rows'],
            ['warehouse', '2 · Warehouse Schema (36 tables)'],
            ['graph', '3 · Graph Overlay (26 labels · 26 edges)'],
            ['ontology', '4 · Enterprise Ontology (10 concepts)'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`rounded-chip px-3.5 py-1.5 text-sm font-medium transition-colors duration-micro ${
              activeTab === key
                ? 'border border-graph/60 bg-surface-raised text-text-primary'
                : 'border border-transparent text-text-secondary hover:bg-surface-raised hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'samples' && (
        <div className="space-y-6">
          <Section
            id="what-is-this"
            title="What this database describes"
            lead="One complete synthetic lottery operator, generated with world seed 2026 and covering the full year 2025 in four national markets: United Kingdom, Greece, Austria and Czech Republic. Every table is one part of that business; nothing here is real customer data."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  title: 'What we sell',
                  body: '20 games with prices and families, their 2,292 scheduled draws and 1.75M per-ticket prize outcomes.',
                },
                {
                  title: 'Who plays',
                  body: '100,000 synthetic players with accounts, devices and tokenised payment instruments; no personal data.',
                },
                {
                  title: 'Where and how',
                  body: '5,000 retailers, 16 regions and three sales channels (retail, app, web) running on 8 platforms and their releases.',
                },
                {
                  title: 'Commercial activity',
                  body: '12 campaigns with 3M per-player exposures, 6 pricing experiments and daily market KPIs (19,784 rows).',
                },
                {
                  title: 'What goes wrong',
                  body: '25 platform incidents with severity and root cause, 50,000 support cases from affected customers.',
                },
                {
                  title: 'What we know',
                  body: '2,000 documents (incident reports, release notes, game rules) in four languages, indexed as 6,996 vector chunks.',
                },
              ].map((entry) => (
                <div
                  key={entry.title}
                  className="rounded-card border border-border bg-surface p-3.5"
                >
                  <p className="text-sm font-semibold text-text-primary">
                    {entry.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                    {entry.body}
                  </p>
                </div>
              ))}
            </div>
            <Callout title="What is an incident?">
              An incident is the operations team&rsquo;s record that something
              went wrong on a sales platform: the checkout step failing after
              release <span className="font-mono">PLV_PAYMENTS_3</span>{' '}
              (incident <span className="font-mono">INC_S007_GR</span>), an app
              crashing on launch, a delayed draw. The row says which market and
              platform version were involved, how severe it was (LOW, MEDIUM,
              HIGH), when it started and was resolved, and its root-cause code.
              Incidents connect to the games and market they affected and to the
              incident-report documents written about them; that chain is what a
              question like &ldquo;why did conversion fall in Greece?&rdquo;
              retrieves.
            </Callout>
          </Section>

          <Section
            id="samples"
            title="Real sample rows from the demo warehouse"
            lead="Click any table below to see actual records from data/generated/demo-seed2026 and how a single record transforms from a warehouse row into a Neo4j node and an ontology concept."
          >
            <div className="rounded-card border border-border bg-surface p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                How one incident is represented across all 3 layers
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-card border border-border bg-surface-raised p-3">
                  <p className="text-xs font-semibold text-text-secondary">
                    1. Parquet Warehouse Row
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                    incidents.parquet
                  </p>
                  <dl className="mt-2 space-y-1 font-mono text-xs">
                    <div className="flex justify-between">
                      <dt className="text-text-muted">incident_id:</dt>
                      <dd className="text-text-primary">INC_S007_GR</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-muted">market_id:</dt>
                      <dd className="text-text-secondary">MKT_GR</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-muted">platform_version:</dt>
                      <dd className="text-graph">PLV_PAYMENTS_3</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-text-muted">root_cause_code:</dt>
                      <dd className="text-text-secondary">RC_77</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-card border border-graph/50 bg-surface-raised p-3">
                  <p className="text-xs font-semibold text-graph">
                    2. Neo4j Graph Node & Edges
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                    (:Incident &#123;entity_id: &quot;INC_S007_GR&quot;&#125;)
                  </p>
                  <ul className="mt-2 space-y-1 font-mono text-xs text-text-secondary">
                    <li>-[:AFFECTS_MARKET]-&gt; (MKT_GR)</li>
                    <li className="text-graph">
                      -[:RELATED_TO_VERSION]-&gt; (PLV_PAYMENTS_3)
                    </li>
                    <li>-[:RELATED_TO]-&gt; (PLT_PAYMENTS)</li>
                    <li className="text-text-muted">
                      source_record_id: &quot;INC_S007_GR&quot;
                    </li>
                  </ul>
                </div>

                <div className="rounded-card border border-ontology/50 bg-surface-raised p-3">
                  <p className="text-xs font-semibold text-ontology">
                    3. Enterprise Ontology Concept
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                    (:BusinessConcept)
                  </p>
                  <p className="mt-2 font-mono text-xs text-text-primary">
                    CONCEPT_PLATFORM_INCIDENT
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Binds <span className="font-mono">INC_S007_GR</span>,{' '}
                    <span className="font-mono">INC_S007_AT</span> and{' '}
                    <span className="font-mono">INC_S007_CZ</span> via{' '}
                    <span className="font-mono text-ontology">[:MAPS_TO]</span>{' '}
                    so cross-market incidents are discovered together.
                  </p>
                </div>
              </div>
            </div>

            <div
              role="group"
              aria-label="Sample tables"
              className="flex flex-wrap gap-1.5"
            >
              {SAMPLE_TABLES.map((tbl) => (
                <button
                  key={tbl.id}
                  type="button"
                  aria-pressed={sampleTableId === tbl.id}
                  onClick={() => setSampleTableId(tbl.id)}
                  className={`rounded-chip border px-3 py-1.5 text-xs font-mono transition-colors duration-micro ${
                    sampleTableId === tbl.id
                      ? 'border-graph bg-graph/15 font-medium text-text-primary'
                      : 'border-border bg-surface-raised text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tbl.name}{' '}
                  <span className="ml-1 font-sans text-text-muted">
                    ({tbl.rows})
                  </span>
                </button>
              ))}
            </div>

            <div className="rounded-card border border-border bg-surface-raised p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                What a row in {activeSample.name} means
              </p>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                {activeSample.what}
              </p>
            </div>

            <Callout title={`What to notice in ${activeSample.name}`}>
              {activeSample.takeaway}
            </Callout>

            <Table head={[...activeSample.head]} rows={activeSample.records} />

            <Disclosure
              summary="What every core table means in plain English"
              note="16 tables · business meaning, not schema"
            >
              <Table
                head={['Table', 'What it holds in business terms']}
                rows={[
                  [
                    'incidents',
                    'Platform failures and degradations: what broke, where, how badly and why',
                  ],
                  ['incident_game_map', 'Which games each incident affected'],
                  [
                    'support_cases',
                    'Customer support contacts, often linked to an incident or a game',
                  ],
                  [
                    'games, game_families, game_categories, game_mechanics',
                    'The product catalogue and its taxonomy: what is sold and how it plays',
                  ],
                  [
                    'draws',
                    'The scheduled draw events per game across the year',
                  ],
                  ['prizes', 'Per-ticket prize outcomes for every draw'],
                  [
                    'tickets',
                    'Every purchased entry: player, game, channel, timestamp, stake',
                  ],
                  [
                    'sessions',
                    'Digital player sessions in the app and web channels',
                  ],
                  [
                    'players, accounts, devices, player_device',
                    'Who plays and with what; the identity substrate for fraud analysis',
                  ],
                  [
                    'payment_methods, player_payment_method',
                    'Tokenised payment instruments and who uses them (no card numbers)',
                  ],
                  [
                    'retailers, regions, markets',
                    'Where the business operates: the shop estate and geography',
                  ],
                  [
                    'campaigns, campaign_game_map, campaign_exposures',
                    'Marketing activity: what was promoted and which players saw it',
                  ],
                  [
                    'experiments',
                    'Controlled pricing and experience experiments',
                  ],
                  [
                    'kpi_daily',
                    'Daily market-level performance indicators such as conversion',
                  ],
                  [
                    'platforms, platform_versions, app_versions',
                    'The software estate: platforms, their releases and app deployments',
                  ],
                  [
                    'documents, document_chunks',
                    'Written knowledge with validity windows, chunked for retrieval',
                  ],
                ]}
              />
            </Disclosure>
          </Section>

          <Section
            id="chains"
            title="How the tables connect into chains"
            lead="Four entity chains cover most questions; high-volume fact tables stay in the warehouse."
          >
            <div className="grid gap-3 md:grid-cols-2">
              {CHAINS.map((chain) => (
                <div
                  key={chain.what}
                  className="rounded-card border border-border bg-surface p-3.5"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {chain.what}
                  </p>
                  <Rail items={chain.rail} />
                </div>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              Every graph node carries <Chip>source_system</Chip> and{' '}
              <Chip>source_record_id</Chip>, so any claim in an answer traces
              back to an authoritative warehouse row above.
            </p>
          </Section>
        </div>
      )}

      {activeTab === 'warehouse' && (
        <Section
          id="tables"
          title="Warehouse tables & fields"
          lead="36 tables across five domains. Expand any domain to inspect its keys, purpose and row counts."
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
      )}

      {activeTab === 'graph' && (
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
      )}

      {activeTab === 'ontology' && (
        <Section
          id="ontology"
          title="The ontology"
          lead="Ten canonical BusinessConcept nodes (version 1.0.0) in backend/app/graph/mapping.py; traversed only by pipeline C."
        >
          <OntologyBinding />
          <Table
            head={['concept_id', 'Type', 'Meaning']}
            rows={[
              [
                'CONCEPT_NATIONAL_DRAW',
                'Game',
                'National draw lottery product',
              ],
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
              [
                'CONCEPT_ADD_ON_PRODUCT',
                'Game',
                'Supplementary add-on product',
              ],
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
            <p className="text-xs text-text-secondary">
              Want to click through how warehouse tables, documents and
              telemetry bind to these concepts step by step?
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
      )}
    </div>
  )
}
