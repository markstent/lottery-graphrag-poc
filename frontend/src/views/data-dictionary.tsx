/**
 * Data Dictionary (in-app documentation): what every table, graph node
 * label, relationship type and ontology concept in this POC represents.
 *
 * Everything here is generated from committed sources: the world manifest
 * and _data_dictionary.json (demo world), backend/app/graph/statements.py
 * (node labels and relationship allow-list) and
 * backend/app/datasets/master_data.py (concept catalogue). The diagrams are
 * inline SVG styled with the design tokens; the tables beside them are the
 * textual alternative (docs/ux/accessibility.md).
 */

import { Code, Section, Table } from '../components/doc'

const svgProps = {
  role: 'img' as const,
}

function Box({
  x,
  y,
  w,
  h,
  title,
  lines,
  accent,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  lines: string[]
  accent?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill="var(--color-surface-raised)"
        stroke={accent ? 'var(--color-graph)' : 'var(--color-border)'}
        strokeWidth={accent ? 1.5 : 1}
      />
      <text
        x={x + w / 2}
        y={y + 20}
        textAnchor="middle"
        fill="var(--color-text-primary)"
        fontSize={12}
        fontWeight={600}
      >
        {title}
      </text>
      {lines.map((line, index) => (
        <text
          key={line}
          x={x + w / 2}
          y={y + 38 + index * 14}
          textAnchor="middle"
          fill="var(--color-text-secondary)"
          fontSize={10}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  label,
  dashed,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
  dashed?: boolean
}) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-text-muted)"
        strokeWidth={1}
        strokeDasharray={dashed ? '4 3' : undefined}
        markerEnd="url(#dd-arrow)"
      />
      {label && (
        <text
          x={mx}
          y={my - 4}
          textAnchor="middle"
          fill="var(--color-text-muted)"
          fontSize={9}
        >
          {label}
        </text>
      )}
    </g>
  )
}

function Diagram({
  title,
  description,
  children,
  height,
}: {
  title: string
  description: string
  children: React.ReactNode
  height: number
}) {
  return (
    <figure className="rounded-card border border-border bg-surface p-3">
      <svg
        {...svgProps}
        viewBox={`0 0 760 ${height}`}
        style={{ maxWidth: 760, width: '100%', height: 'auto' }}
      >
        <title>{title}</title>
        <desc>{description}</desc>
        <defs>
          <marker
            id="dd-arrow"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-muted)" />
          </marker>
        </defs>
        {children}
      </svg>
      <figcaption className="mt-2 text-xs text-muted">{description}</figcaption>
    </figure>
  )
}

export function DataDictionary() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Data Dictionary</h1>
        <p className="mt-1 text-sm text-muted">
          What every table, graph node label, relationship type and ontology
          concept in this POC represents. Figures quote the demo world (seed
          2026); the schema is identical across profiles.
        </p>
      </header>

      <Section id="layers" title="One world, three representations">
        <p>
          The same synthetic enterprise exists in three coordinated stores. The
          structured layer is authoritative for facts and amounts; the graph
          never replaces it, it indexes meaning; the vector index serves
          document retrieval. Every graph node and every citation carries
          provenance back to a source system and record.
        </p>
        <Diagram
          title="Layer architecture: structured layer, graph overlay, vector index"
          description="Flow diagram. The DuckDB/Parquet warehouse holds authoritative facts. The Neo4j graph overlay holds entities, relationships and ontology mappings, each node pointing back to its source record (provenance arrows). The Qdrant index holds document chunks. Pipelines A/B/C read the vector index, and B/C additionally read the graph; every pipeline answers through the same model gateway."
          height={300}
        >
          <Box
            x={20}
            y={30}
            w={200}
            h={110}
            title="Structured layer"
            lines={[
              'DuckDB over Parquet',
              '36 tables · authoritative facts',
              'tickets, prizes, sessions…',
            ]}
          />
          <Box
            x={280}
            y={30}
            w={200}
            h={110}
            title="Graph overlay (Neo4j)"
            lines={[
              '26 node labels',
              '26 relationship types',
              'entities + ontology + provenance',
            ]}
            accent
          />
          <Box
            x={540}
            y={30}
            w={200}
            h={110}
            title="Vector index (Qdrant)"
            lines={[
              'one shared collection',
              '6,996 document chunks',
              'same embedder for A/B/C',
            ]}
          />
          <Box
            x={280}
            y={210}
            w={200}
            h={60}
            title="Pipelines A / B / C"
            lines={['A: vector · B: + graph · C: + ontology']}
          />
          <Arrow x1={222} y1={85} x2={278} y2={85} label="provenance" dashed />
          <Arrow
            x1={538}
            y1={85}
            x2={482}
            y2={85}
            label="source records"
            dashed
          />
          <Arrow x1={340} y1={140} x2={340} y2={208} label="guides" />
          <Arrow x1={420} y1={140} x2={420} y2={208} label="chunks" />
          <Arrow
            x1={122}
            y1={140}
            x2={330}
            y2={244}
            label="authoritative facts"
          />
        </Diagram>
      </Section>

      <Section id="tables" title="Structured layer: table inventory">
        <p>
          36 tables across six domains. Keys shown are the synthetic record
          identifiers; every table also has provenance (source system) recorded
          in the generation manifest. Field-level types and per-field rules:
          <Code>_data_dictionary.json</Code> in the dataset directory and
          <Code> docs/01-synthetic-data-spec.md</Code> sections 6–7.
        </p>
        <h3 className="text-sm font-semibold text-primary">
          Reference and master data
        </h3>
        <Table
          head={['Table', 'Key', 'Represents', 'Demo rows']}
          rows={[
            [
              'markets',
              'market_id',
              'The four operating markets (UK, GR, AT, CZ) and their regulator, timezone, currency',
              '4',
            ],
            [
              'regions',
              'region_id',
              'Sub-national regions within each market',
              '16',
            ],
            ['languages', 'language_code', 'Supported content languages', '4'],
            [
              'currencies',
              'currency_code',
              'Settlement currencies (GBP, EUR, CZK)',
              '3',
            ],
            [
              'channels',
              'channel_code',
              'Sales channels (retail, app, web)',
              '3',
            ],
            ['suppliers', 'supplier_id', 'Platform and service suppliers', '6'],
            [
              'retailers',
              'retailer_id',
              'Retail estates selling tickets',
              '5,000',
            ],
          ]}
        />
        <h3 className="text-sm font-semibold text-primary">
          Product catalogue
        </h3>
        <Table
          head={['Table', 'Key', 'Represents', 'Demo rows']}
          rows={[
            [
              'games',
              'game_id',
              'Sellable games with prices, jackpot model and market validity',
              '20',
            ],
            [
              'game_families',
              'family_id',
              'Product families (national draw, instant win…)',
              '8',
            ],
            ['game_categories', 'category_code', 'Product categories', '4'],
            [
              'game_mechanics',
              'mechanic_id',
              'Play mechanics (number match, progressive jackpot…)',
              '6',
            ],
            [
              'game_mechanic_map',
              'game_id',
              'Game-to-mechanic assignments',
              '23',
            ],
            [
              'draws',
              'draw_id',
              'Draw schedule per game (canonical master data)',
              '2,292',
            ],
            [
              'prizes',
              'prize_id',
              'Per-ticket prize outcomes (fact table, never graphed)',
              '1,750,899',
            ],
          ]}
        />
        <h3 className="text-sm font-semibold text-primary">
          Players, money and identity
        </h3>
        <Table
          head={['Table', 'Key', 'Represents', 'Demo rows']}
          rows={[
            [
              'players',
              'player_id',
              'Registered players with synthetic demographics and value/engagement segments',
              '100,000',
            ],
            [
              'accounts',
              'account_id',
              'Web accounts per player with verification state',
              '100,000',
            ],
            [
              'devices',
              'device_id',
              'Known devices with fingerprint and family',
              '120,000',
            ],
            [
              'player_device',
              'player_id + device_id',
              'Which player used which device, when (fraud scenario substrate)',
              '108,047',
            ],
            [
              'payment_methods',
              'payment_method_id',
              'Tokenised payment instruments (synthetic tokens, no PAN)',
              '95,909',
            ],
            [
              'player_payment_method',
              'player_id + payment_method_id',
              'Who used which instrument, usage weight (fraud scenario substrate)',
              '100,000',
            ],
          ]}
        />
        <h3 className="text-sm font-semibold text-primary">
          Commercial and marketing
        </h3>
        <Table
          head={['Table', 'Key', 'Represents', 'Demo rows']}
          rows={[
            [
              'campaigns',
              'campaign_id',
              'Marketing campaigns with budgets and dates',
              '12',
            ],
            [
              'campaign_game_map',
              'campaign_id + game_id',
              'Which games a campaign promotes',
              '23',
            ],
            [
              'campaign_exposures',
              'exposure_id',
              'Per-player campaign impressions and engagement (fact table)',
              '3,000,000',
            ],
            [
              'experiments',
              'experiment_id',
              'Controlled pricing/experience experiments',
              '6',
            ],
            [
              'kpi_daily',
              'date',
              'Daily market KPIs (fact table, never graphed)',
              '19,784',
            ],
          ]}
        />
        <h3 className="text-sm font-semibold text-primary">Operations</h3>
        <Table
          head={['Table', 'Key', 'Represents', 'Demo rows']}
          rows={[
            [
              'platforms',
              'platform_id',
              'Sales platforms and their suppliers',
              '8',
            ],
            [
              'platform_versions',
              'platform_version_id',
              'Platform release versions',
              '24',
            ],
            [
              'app_versions',
              'app_version_id',
              'Customer app releases deployed per market',
              '16',
            ],
            [
              'incidents',
              'incident_id',
              'Operational incidents with severity and root cause',
              '25',
            ],
            [
              'incident_game_map',
              'incident_id + game_id',
              'Games affected by an incident',
              '46',
            ],
            [
              'support_cases',
              'support_case_id',
              'Customer support cases',
              '50,000',
            ],
          ]}
        />
        <h3 className="text-sm font-semibold text-primary">
          Documents and activity
        </h3>
        <Table
          head={['Table', 'Key', 'Represents', 'Demo rows']}
          rows={[
            [
              'documents',
              'document_id',
              'Knowledge documents (rules, incident summaries, experiment reports…) with validity windows',
              '2,000',
            ],
            [
              'document_chunks',
              'chunk_id',
              'Retrieval-ready chunks of documents (indexed in Qdrant)',
              '6,996',
            ],
            [
              'sessions',
              'session_id',
              'Player sessions (fact table, never graphed)',
              '2,000,000',
            ],
            [
              'tickets',
              'ticket_id',
              'Ticket purchases (fact table, never graphed)',
              '5,000,000',
            ],
          ]}
        />
      </Section>

      <Section id="fields" title="Core tables, field by field">
        <p>
          The fields of the tables most questions touch. All identifiers are
          synthetic; no PII exists anywhere in the world (coarse age bands, no
          names, tokenised payments).
        </p>
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
      </Section>

      <Section id="graph" title="Graph overlay: node labels and relationships">
        <p>
          Ingestion maps source rows into 26 node labels connected by 26
          relationship types (the exhaustive allow-list in{' '}
          <Code>backend/app/graph/statements.py</Code>; the live database is
          verified to contain exactly these after every ingestion). Every node
          carries <Code>id</Code>, <Code>source_system</Code>,{' '}
          <Code>source_record_id</Code>, <Code>ingestion_version</Code> and{' '}
          <Code>label_version</Code> as provenance.
        </p>
        <Diagram
          title="Graph schema by domain cluster"
          description="Domain-cluster diagram of the graph schema. Reference cluster: Market, Region, Language, Currency, Channel, Supplier. Product cluster: Game, GameFamily, GameCategory, GameMechanic, Draw, PrizeType. Platform cluster: Platform, PlatformVersion, AppVersion. Player cluster: Player, PlayerSegment, Device, PaymentMethod. Operations cluster: Campaign, Experiment, Incident, SupportCase. Knowledge cluster: Document, DocumentChunk, BusinessConcept. Cross-cluster arrows: Game RUNS_ON Platform and AVAILABLE_IN Market; Incident AFFECTS Game and AFFECTS_MARKET Market and RELATED_TO Platform; Document REFERENCES Incident and HAS_CHUNK DocumentChunk; Player USES Device and USES_PAYMENT PaymentMethod and PLAYS Game and EXPOSED_TO Campaign; entities MAPS_TO BusinessConcept."
          height={360}
        >
          <Box
            x={20}
            y={20}
            w={165}
            h={118}
            title="Reference"
            lines={[
              'Market',
              'Region · Language · Currency',
              'Channel · Supplier',
            ]}
          />
          <Box
            x={20}
            y={190}
            w={165}
            h={118}
            title="Player"
            lines={['Player · PlayerSegment', 'Device · PaymentMethod']}
          />
          <Box
            x={215}
            y={20}
            w={165}
            h={118}
            title="Product"
            lines={[
              'Game · GameFamily',
              'GameCategory · GameMechanic',
              'Draw · PrizeType',
            ]}
          />
          <Box
            x={215}
            y={190}
            w={165}
            h={118}
            title="Commercial / Ops"
            lines={['Campaign · Experiment', 'Incident · SupportCase']}
          />
          <Box
            x={410}
            y={20}
            w={165}
            h={118}
            title="Platform"
            lines={['Platform', 'PlatformVersion · AppVersion']}
          />
          <Box
            x={410}
            y={190}
            w={165}
            h={118}
            title="Knowledge"
            lines={['Document · DocumentChunk', 'BusinessConcept']}
            accent
          />
          <Box
            x={605}
            y={100}
            w={135}
            h={110}
            title="Vector index"
            lines={['Qdrant collection', 'chunk text + provenance']}
          />
          <Arrow x1={185} y1={70} x2={213} y2={70} label="AVAILABLE_IN" />
          <Arrow
            x1={298}
            y1={140}
            x2={298}
            y2={188}
            label="PROMOTES · AFFECTS"
          />
          <Arrow x1={380} y1={70} x2={408} y2={70} label="RUNS_ON" />
          <Arrow x1={492} y1={140} x2={492} y2={188} label="REFERENCES" />
          <Arrow x1={102} y1={140} x2={250} y2={224} label="PLAYS" dashed />
          <Arrow x1={185} y1={250} x2={213} y2={250} label="EXPOSED_TO" />
          <Arrow
            x1={575}
            y1={230}
            x2={603}
            y2={195}
            label="chunk text indexed"
            dashed
          />
          <Arrow
            x1={575}
            y1={100}
            x2={603}
            y2={140}
            label="node evidence"
            dashed
          />
        </Diagram>
        <p>
          High-volume facts are never copied into the graph. Ticket, prize,
          session, exposure and KPI rows stay in the structured layer and appear
          only as aggregated, clearly named derived relationships:
        </p>
        <Table
          head={['Derived relationship', 'Meaning', 'Carried properties']}
          rows={[
            [
              '(:Player)-[:PLAYS]->(:Game)',
              'The player has bought tickets for this game',
              'ticket_count, last_purchase_at, method',
            ],
            [
              '(:Player)-[:EXPOSED_TO]->(:Campaign)',
              'The player was exposed to this campaign',
              'exposure_count, engaged_count, method',
            ],
            [
              '(:Player)-[:USES_PAYMENT]->(:PaymentMethod)',
              'Instrument association derived from player_payment_method',
              'first_used_at, last_used_at, usage_weight',
            ],
          ]}
        />
        <h3 className="text-sm font-semibold text-primary">
          Every relationship type and what it means
        </h3>
        <Table
          head={['Relationship', 'From → To', 'Meaning']}
          rows={[
            ['AVAILABLE_IN', 'Game → Market', 'markets where the game is sold'],
            [
              'AVAILABLE_VIA',
              'Game → Channel',
              'channels the game is sold through',
            ],
            [
              'BELONGS_TO',
              'Game → GameFamily; Player → PlayerSegment',
              'product family; behavioural segment membership',
            ],
            ['HAS_MECHANIC', 'Game → GameMechanic', 'play mechanics of a game'],
            ['HAS_DRAW', 'Game → Draw', 'scheduled draws of a game'],
            ['RUNS_ON', 'Game → Platform', 'platform the game runs on'],
            ['SIMILAR_TO', 'Game → Game', 'derived product similarity'],
            ['VERSION_OF', 'PlatformVersion → Platform', 'release lineage'],
            [
              'DEPLOYED_TO',
              'AppVersion → Market',
              'where an app release is deployed',
            ],
            ['USES', 'Player → Device', 'derived from player_device usage'],
            [
              'USES_PAYMENT',
              'Player → PaymentMethod',
              'derived instrument association',
            ],
            [
              'PLAYS',
              'Player → Game',
              'derived purchase relationship (aggregated)',
            ],
            [
              'EXPOSED_TO',
              'Player → Campaign',
              'derived exposure relationship (aggregated)',
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
              'incident-platform link; case about an incident',
            ],
            [
              'RELATED_TO_VERSION',
              'Incident → PlatformVersion',
              'the exact faulty release',
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
            ['FROM_MARKET', 'SupportCase → Market', 'case origin market'],
            [
              'REFERENCES',
              'Document → Game / Incident / Campaign / AppVersion / Experiment',
              'document citations into the world',
            ],
            [
              'HAS_CHUNK',
              'Document → DocumentChunk',
              'retrieval chunks of a document',
            ],
            [
              'INSTANCE_OF',
              'Game / GameFamily / GameMechanic → BusinessConcept',
              'ontology binding',
            ],
            [
              'MAPS_TO',
              'GameMechanic / PlayerSegment / Channel / Incident → BusinessConcept',
              'ontology mapping from the mapping tables',
            ],
          ]}
        />
      </Section>

      <Section id="ontology" title="Ontology: business concepts and mappings">
        <p>
          The ontology layer (version 1.0.0) is ten canonical BusinessConcept
          nodes. Domain vocabulary maps onto them through explicit mapping
          tables in <Code>backend/app/graph/mapping.py</Code>; pipeline C is the
          only pipeline allowed to traverse those mappings, which is exactly the
          B-to-C difference the experiment measures.
        </p>
        <Diagram
          title="Ontology example: a cross-market concept binding incidents from three markets"
          description="Ontology binding diagram. Three incident nodes, INC_S007_GR (Greece), INC_S007_AT (Austria) and INC_S007_CZ (Czech Republic), each with MAPS_TO edges pointing to the single concept node CONCEPT_PLATFORM_INCIDENT (type BusinessEvent). On the product side, game families FAM_NATIONAL_DRAW and FAM_ANNUITY map to CONCEPT_NATIONAL_DRAW, and FAM_MULTINATIONAL_JACKPOT maps to CONCEPT_MULTINATIONAL_JACKPOT. Channels RETAIL, APP and WEB map to CONCEPT_RETAIL_CHANNEL and CONCEPT_DIGITAL_CHANNEL. A query mentioning any one bound incident can therefore discover the others through the shared concept."
          height={280}
        >
          <Box
            x={20}
            y={30}
            w={190}
            h={54}
            title="INC_S007_GR"
            lines={['Incident · Greece']}
          />
          <Box
            x={20}
            y={112}
            w={190}
            h={54}
            title="INC_S007_AT"
            lines={['Incident · Austria']}
          />
          <Box
            x={20}
            y={194}
            w={190}
            h={54}
            title="INC_S007_CZ"
            lines={['Incident · Czech Republic']}
          />
          <Box
            x={320}
            y={100}
            w={220}
            h={70}
            title="CONCEPT_PLATFORM_INCIDENT"
            lines={[
              'BusinessConcept · BusinessEvent',
              'canonical: Platform Incident',
            ]}
            accent
          />
          <Arrow x1={210} y1={57} x2={318} y2={122} label="MAPS_TO" />
          <Arrow x1={210} y1={139} x2={318} y2={139} label="MAPS_TO" />
          <Arrow x1={210} y1={221} x2={318} y2={156} label="MAPS_TO" />
          <Box
            x={590}
            y={30}
            w={150}
            h={54}
            title="FAM_NATIONAL_DRAW"
            lines={['GameFamily']}
          />
          <Box
            x={590}
            y={104}
            w={150}
            h={54}
            title="FAM_MULTINATIONAL…"
            lines={['GameFamily']}
          />
          <Box
            x={590}
            y={178}
            w={150}
            h={54}
            title="RETAIL / APP / WEB"
            lines={['Channel']}
          />
          <Arrow x1={540} y1={115} x2={588} y2={62} label="MAPS_TO" />
          <Arrow x1={540} y1={135} x2={588} y2={132} label="MAPS_TO" />
          <Arrow x1={540} y1={155} x2={588} y2={204} label="MAPS_TO" />
        </Diagram>
        <h3 className="text-sm font-semibold text-primary">
          Concept catalogue
        </h3>
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
            [
              'CONCEPT_RETAIL_CHANNEL',
              'Channel',
              'Physical retail sales channel',
            ],
            ['CONCEPT_DIGITAL_CHANNEL', 'Channel', 'App and web sales channel'],
            [
              'CONCEPT_PLATFORM_INCIDENT',
              'BusinessEvent',
              'Platform incident affecting products',
            ],
          ]}
        />
        <h3 className="text-sm font-semibold text-primary">Mapping sources</h3>
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
        <p>
          The ontology specification reserves further vocabulary (IS_A,
          EQUIVALENT_TO, CAUSES and others in docs/03 section 5) that this POC
          does not populate; only INSTANCE_OF and MAPS_TO bindings exist, and
          the tests pin pipeline C to exactly that.
        </p>
      </Section>

      <Section id="sources" title="Authoritative definitions">
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
            ['Ingestion pipeline', 'docs/data/graph-ingestion.md'],
            [
              'Planted scenarios',
              'docs/04-scenario-library (scenario engine), Scenario Lab screen',
            ],
          ]}
        />
      </Section>
    </div>
  )
}
