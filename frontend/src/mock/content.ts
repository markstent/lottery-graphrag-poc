/**
 * Static mock content for the Phase 7 prototype: experiment metadata,
 * the scenario catalogue (mirrors backend/app/scenarios/catalogue.py),
 * benchmark results and semantic-layer structures.
 *
 * Production screens will replace this module with API access in Phase 9+.
 */

export interface ExperimentMeta {
  name: string
  experimentId: string
  dataset: string
  markets: string[]
  model: string
  provider: string
  embedding: string
}

export const EXPERIMENT: ExperimentMeta = {
  name: 'Semantic Context Lab',
  experimentId: 'exp-demo-2026-10',
  dataset: 'dev · world seed 2026 · scenario seed 2026',
  markets: ['United Kingdom', 'Greece', 'Austria', 'Czech Republic'],
  model: 'gpt-oss-20b',
  provider: 'local (ollama)',
  embedding: 'bge-m3 · 1024d',
}

export interface DemoQuestion {
  id: string
  text: string
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    id: 'dq-1',
    text: 'Why did digital conversion fall in Greece, and have we seen the same issue elsewhere?',
  },
  { id: 'dq-2', text: 'Which accounts share payment instruments abnormally?' },
  {
    id: 'dq-3',
    text: 'What is the current ticket price for the game, and why does the rules document disagree?',
  },
]

export interface ScenarioCard {
  id: string
  type: string
  description: string
  strength: number
  enabled: boolean
}

/** Mirrors the real catalogue; enabled flags match backend ENABLED. */
export const SCENARIO_CATALOGUE: ScenarioCard[] = [
  {
    id: 'SCN-001',
    type: 'app_release_conversion_failure',
    description:
      'A new app release introduces a checkout problem for a device/OS cohort.',
    strength: 0.8,
    enabled: false,
  },
  {
    id: 'SCN-002',
    type: 'shared_device_cluster',
    description:
      'A group of accounts is unusually connected through shared devices.',
    strength: 0.8,
    enabled: true,
  },
  {
    id: 'SCN-003',
    type: 'shared_payment_cluster',
    description:
      'Multiple accounts share a small number of payment instruments.',
    strength: 0.8,
    enabled: true,
  },
  {
    id: 'SCN-004',
    type: 'promotion_driven_product_migration',
    description:
      'A campaign causes a cohort to migrate from one product family to another.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-005',
    type: 'product_cannibalisation',
    description:
      'A new product grows while a structurally similar existing product shrinks.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-006',
    type: 'jackpot_halo_effect',
    description: 'A large jackpot increases activity in related products.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-007',
    type: 'cross_market_platform_incident',
    description:
      'A shared platform version causes similar symptoms across several markets.',
    strength: 0.8,
    enabled: true,
  },
  {
    id: 'SCN-008',
    type: 'campaign_audience_mismatch',
    description:
      'A campaign performs poorly because its audience has low mechanic affinity.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-009',
    type: 'payment_provider_degradation',
    description:
      'One payment provider degrades intermittently across products.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-010',
    type: 'game_mechanic_affinity',
    description:
      'A segment performs strongly on products sharing a mechanic across markets.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-011',
    type: 'transferable_campaign',
    description:
      'A successful campaign has a structurally similar transfer target elsewhere.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-012',
    type: 'support_complaint_precursor',
    description:
      'Support complaints rise before KPI reporting shows degradation.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-013',
    type: 'retailer_regional_anomaly',
    description: 'A set of retailers in one region shows unusual performance.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-014',
    type: 'digital_adoption_shift',
    description:
      'A cohort migrates from retail to digital over several months.',
    strength: 0.5,
    enabled: false,
  },
  {
    id: 'SCN-015',
    type: 'document_structured_conflict',
    description:
      'A document carries outdated guidance while structured records are current.',
    strength: 0.8,
    enabled: true,
  },
]

export interface ComplexityRow {
  level: string
  label: string
  baseline: number
  graphRelationships: number
  graphOntology: number
}

export interface MarketRow {
  market: string
  baseline: number
  graphRelationships: number
  graphOntology: number
}

export interface FailureRow {
  questionId: string
  complexity: string
  pipeline: 'A' | 'B' | 'C'
  note: string
}

export interface BenchmarkResults {
  benchmarkRunId: string
  questions: number
  overview: {
    correctness: [number, number, number]
    evidenceRecall: [number, number, number]
    grounding: [number, number, number]
  }
  byComplexity: ComplexityRow[]
  byMarket: MarketRow[]
  efficiency: {
    latencyMs: [number, number, number]
    contextTokens: [number, number, number]
  }
  failures: FailureRow[]
}

/**
 * Deterministic illustrative benchmark results (mock). Configurations:
 * A = conventional RAG, B = + graph relationships, C = + ontology.
 */
export const BENCHMARK_RESULTS: BenchmarkResults = {
  benchmarkRunId: 'BMK-2026-10-07-01',
  questions: 30,
  overview: {
    correctness: [0.52, 0.68, 0.81],
    evidenceRecall: [0.44, 0.71, 0.83],
    grounding: [0.74, 0.86, 0.92],
  },
  byComplexity: [
    {
      level: 'L1',
      label: 'single fact',
      baseline: 0.86,
      graphRelationships: 0.88,
      graphOntology: 0.9,
    },
    {
      level: 'L2',
      label: 'filtered aggregate',
      baseline: 0.72,
      graphRelationships: 0.78,
      graphOntology: 0.82,
    },
    {
      level: 'L3',
      label: 'multi-hop',
      baseline: 0.41,
      graphRelationships: 0.66,
      graphOntology: 0.79,
    },
    {
      level: 'L4',
      label: 'cross-market',
      baseline: 0.22,
      graphRelationships: 0.58,
      graphOntology: 0.77,
    },
    {
      level: 'L5',
      label: 'temporal',
      baseline: 0.35,
      graphRelationships: 0.52,
      graphOntology: 0.63,
    },
    {
      level: 'L6',
      label: 'conflicting evidence',
      baseline: 0.3,
      graphRelationships: 0.44,
      graphOntology: 0.71,
    },
  ],
  byMarket: [
    {
      market: 'United Kingdom',
      baseline: 0.55,
      graphRelationships: 0.68,
      graphOntology: 0.8,
    },
    {
      market: 'Greece',
      baseline: 0.49,
      graphRelationships: 0.67,
      graphOntology: 0.81,
    },
    {
      market: 'Austria',
      baseline: 0.53,
      graphRelationships: 0.69,
      graphOntology: 0.8,
    },
    {
      market: 'Czech Republic',
      baseline: 0.51,
      graphRelationships: 0.66,
      graphOntology: 0.79,
    },
  ],
  efficiency: {
    latencyMs: [4100, 5300, 5600],
    contextTokens: [1830, 2260, 2380],
  },
  failures: [
    {
      questionId: 'Q-014',
      complexity: 'L5',
      pipeline: 'B',
      note: 'temporal window missed: incident date outside retrieved chunk range',
    },
    {
      questionId: 'Q-021',
      complexity: 'L6',
      pipeline: 'A',
      note: 'superseded document outranked the authoritative record',
    },
    {
      questionId: 'Q-027',
      complexity: 'L4',
      pipeline: 'A',
      note: 'no cross-market path; only Greek context retrieved',
    },
  ],
}

export interface SemanticSource {
  id: string
  label: string
  detail: string
}

export interface SemanticConcept {
  id: string
  label: string
  entities: string[]
}

/** Structure for the Semantic Layer explainer (docs/06 section 14). */
export const SEMANTIC_SOURCES: SemanticSource[] = [
  {
    id: 'warehouse',
    label: 'Warehouse',
    detail: 'Parquet/DuckDB aggregates: tickets, KPIs, incidents, payments',
  },
  {
    id: 'documents',
    label: 'Documents',
    detail: 'Reports, release notes, rules documents with validity windows',
  },
  { id: 'telemetry', label: 'Telemetry', detail: 'Session and device events' },
  { id: 'support', label: 'Support', detail: 'Cases and complaint topics' },
]

export const SEMANTIC_CONCEPTS: SemanticConcept[] = [
  {
    id: 'CONCEPT_PLATFORM_INCIDENT',
    label: 'Platform Incident',
    entities: ['INC_S007_GR', 'INC_S007_AT', 'PLV_PAYMENTS_3'],
  },
  {
    id: 'CONCEPT_SHARED_INSTRUMENT',
    label: 'Shared Instrument',
    entities: ['ACC cluster via PAY instruments'],
  },
  {
    id: 'CONCEPT_SUPERSEDED_DOC',
    label: 'Superseded Document',
    entities: ['DOC_S007_UK validity window'],
  },
]
