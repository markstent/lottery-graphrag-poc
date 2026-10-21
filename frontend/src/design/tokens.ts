/*
 * Typed copies of the @theme values in src/index.css, keyed by CSS variable name
 * without the leading dashes. tokens.test.ts fails if the two drift apart.
 */
export const TOKENS = {
  'font-sans': "'Inter Variable', ui-sans-serif, system-ui, sans-serif",

  'color-background': '#f6f7f9',
  'color-surface': '#ffffff',
  'color-surface-raised': '#eef0f3',
  'color-border': '#7f8692',
  'color-hairline': '#e3e6eb',

  'color-grey-50': '#f6f7f9',
  'color-grey-100': '#eef0f3',
  'color-grey-200': '#e3e6eb',
  'color-grey-300': '#cfd4db',
  'color-grey-400': '#aab1bc',
  'color-grey-500': '#7f8692',
  'color-grey-600': '#596170',
  'color-grey-700': '#454c58',
  'color-grey-800': '#2a303a',
  'color-grey-900': '#12151b',

  'color-text-primary': '#12151b',
  'color-text-secondary': '#454c58',
  'color-text-muted': '#596170',
  'color-focus': '#12151b',

  'color-pipeline-a': '#2a78d6',
  'color-pipeline-a-tint': '#e5effa',
  'color-pipeline-a-strong': '#1c5cab',
  'color-pipeline-b': '#a86e00',
  'color-pipeline-b-tint': '#f5eee0',
  'color-pipeline-b-strong': '#7a5000',
  'color-pipeline-c': '#c4358f',
  'color-pipeline-c-tint': '#f8e7f2',
  'color-pipeline-c-strong': '#a02574',

  'color-baseline': '#1c5cab',
  'color-graph': '#7a5000',
  'color-ontology': '#a02574',

  'color-status-good': '#0ca30c',
  'color-status-warning': '#fab219',
  'color-status-serious': '#ec835a',
  'color-status-critical': '#d03b3b',
  'color-success': '#006300',
  'color-warning': '#8a5a00',
  'color-error': '#b42323',

  'color-market-uk': '#90502a',
  'color-market-gr': '#14938d',
  'color-market-at': '#75528e',
  'color-market-cz': '#796006',

  'color-state-seed-fill': '#ffffff',
  'color-state-seed-stroke': '#12151b',
  'color-state-traversed-fill': '#e3e6eb',
  'color-state-traversed-stroke': '#454c58',
  'color-state-candidate-fill': '#ffffff',
  'color-state-candidate-stroke': '#7f8692',
  'color-state-selected-fill': '#12151b',
  'color-state-selected-stroke': '#12151b',
  'color-state-discarded-fill': '#f6f7f9',
  'color-state-discarded-stroke': '#7f8692',
  'color-state-concept-fill': '#f8e7f2',
  'color-state-concept-stroke': '#a02574',
  'color-state-source-record-fill': '#ffffff',
  'color-state-source-record-stroke': '#454c58',

  'text-xs': '0.75rem',
  'text-sm': '0.875rem',
  'text-base': '1rem',
  'text-lg': '1.25rem',
  'text-xl': '1.75rem',
  'text-2xl': '2.5rem',

  'radius-card': '0.5rem',
  'radius-chip': '0.25rem',

  'shadow-overlay': '0 8px 24px rgb(18 21 27 / 0.14)',

  'duration-micro': '140ms',
  'duration-panel': '200ms',
  'duration-node': '240ms',
  'duration-edge': '300ms',
  'duration-result': '260ms',
} as const

export type TokenName = keyof typeof TOKENS
