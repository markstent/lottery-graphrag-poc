/// <reference types="node" />
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { PIPELINES, pipeline } from './pipelines'
import { TOKENS, type TokenName } from './tokens'

function themeVars(source: string): Record<string, string> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(source)
  if (!block) throw new Error('no @theme block in index.css')
  const vars: Record<string, string> = {}
  for (const [, name, value] of block[1].matchAll(
    /--([a-z0-9-]+):\s*([^;]+);/g,
  )) {
    vars[name] = value.trim()
  }
  return vars
}

function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  )
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const SURFACES: TokenName[] = [
  'color-background',
  'color-surface',
  'color-surface-raised',
]

const TEXT_ON_SURFACE: [TokenName, TokenName][] = [
  ...(
    ['color-text-primary', 'color-text-secondary', 'color-text-muted'] as const
  ).flatMap((text) =>
    SURFACES.map((surface): [TokenName, TokenName] => [text, surface]),
  ),
  ...(['color-success', 'color-warning', 'color-error'] as const).flatMap(
    (text) =>
      SURFACES.map((surface): [TokenName, TokenName] => [text, surface]),
  ),
  ...(['a', 'b', 'c'] as const).flatMap((id) => [
    ...SURFACES.map((surface): [TokenName, TokenName] => [
      `color-pipeline-${id}-strong`,
      surface,
    ]),
    [`color-pipeline-${id}-strong`, `color-pipeline-${id}-tint`] as [
      TokenName,
      TokenName,
    ],
  ]),
  ['color-background', 'color-pipeline-a-strong'],
  ['color-background', 'color-pipeline-b-strong'],
  ['color-background', 'color-pipeline-c-strong'],
]

const TINTS: TokenName[] = [
  'color-pipeline-a-tint',
  'color-pipeline-b-tint',
  'color-pipeline-c-tint',
  'color-state-concept-fill',
  'color-state-traversed-fill',
  'color-state-discarded-fill',
]

TEXT_ON_SURFACE.push(
  ...(
    ['color-text-primary', 'color-text-secondary', 'color-text-muted'] as const
  ).flatMap((text) =>
    TINTS.map((fill): [TokenName, TokenName] => [text, fill]),
  ),
  // Text on a status fill: ink on the three light fills, white on critical.
  ['color-text-primary', 'color-status-good'],
  ['color-text-primary', 'color-status-warning'],
  ['color-text-primary', 'color-status-serious'],
  ['color-surface', 'color-status-critical'],
)

const BORDER_ON_SURFACE: [TokenName, TokenName][] = SURFACES.map((surface) => [
  'color-border',
  surface,
])

const css = readFileSync('src/index.css', 'utf8')

describe('tokens', () => {
  test('every text token meets 4.5:1 on every surface it is used on', () => {
    for (const [text, surface] of TEXT_ON_SURFACE) {
      expect(
        contrast(TOKENS[text], TOKENS[surface]),
        `${text} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('borders meet 3:1 on their surfaces', () => {
    for (const [border, surface] of BORDER_ON_SURFACE) {
      expect(
        contrast(TOKENS[border], TOKENS[surface]),
        `${border} on ${surface}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  test('pipeline marks meet 3:1 on white', () => {
    for (const id of ['a', 'b', 'c'] as const) {
      expect(
        contrast(TOKENS[`color-pipeline-${id}`], TOKENS['color-surface']),
      ).toBeGreaterThanOrEqual(3)
    }
  })

  test('tokens.ts equals the @theme values in index.css', () => {
    expect(themeVars(css)).toEqual(TOKENS)
  })

  test('type scale is exactly 12, 14, 16, 20, 28, 40', () => {
    const scale = Object.entries(TOKENS)
      .filter(([name]) => name.startsWith('text-'))
      .map(([, value]) => parseFloat(value) * 16)
    expect(scale).toEqual([12, 14, 16, 20, 28, 40])
  })

  test('the surfaces are white and near-white', () => {
    expect(TOKENS['color-surface']).toBe('#ffffff')
    for (const surface of SURFACES)
      expect(luminance(TOKENS[surface])).toBeGreaterThan(0.8)
  })

  test('pipeline labels carry their letter', () => {
    expect(PIPELINES.map((p) => p.label)).toEqual([
      'A · Text search',
      'B · Graph',
      'C · Graph + Ontology',
    ])
  })

  test('pipeline() returns the entry for its id and takes values from the tokens', () => {
    expect(pipeline('B').name).toBe('Graph')
    expect(pipeline('C').strong).toBe(TOKENS['color-pipeline-c-strong'])
    expect(pipeline('A').tint).toBe(TOKENS['color-pipeline-a-tint'])
    expect(pipeline('A').hue).toBe(TOKENS['color-pipeline-a'])
  })

  test('pipeline hues are distinct from the status colours and the market colours', () => {
    const reserved = Object.entries(TOKENS)
      .filter(
        ([name]) =>
          name.startsWith('color-status-') || name.startsWith('color-market-'),
      )
      .map(([, value]) => value)
    for (const p of PIPELINES) expect(reserved).not.toContain(p.hue)
  })
})

describe('token usage in src', () => {
  const modules = import.meta.glob<string>(
    ['../**/*.{ts,tsx}', '!../**/*.test.*', '!../design/**'],
    {
      query: '?raw',
      import: 'default',
      eager: true,
    },
  )
  const text = Object.values(modules).join('\n')

  test('market and status colours are marks and fills, never text', () => {
    expect(
      text.match(/(?<![\w-])(?:[a-z-]+:)*text-(?:market|status)-[a-z]+/g) ?? [],
    ).toEqual([])
    expect(
      text.match(/(?:^|[^-\w])color:\s*var\(--color-(?:market|status)-/g) ?? [],
    ).toEqual([])
    expect(
      text.match(/\bcolor:\s*['"]?TOKENS\[['"]color-(?:market|status)-/g) ?? [],
    ).toEqual([])
  })

  test('text sizes come from the scale and shadows from the overlay token', () => {
    expect(
      text.match(/(?<![\w-])text-\[[0-9.]+(?:px|rem|em)\]/g) ?? [],
    ).toEqual([])
    expect(
      text.match(/(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl|inner)(?![\w-])/g) ??
        [],
    ).toEqual([])
  })

  test('every var(--token) src uses is defined', () => {
    const defined = new Set(Object.keys(TOKENS))
    const used = [...text.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1])
    expect(used.filter((name) => !defined.has(name))).toEqual([])
  })

  test('every Tailwind token class src uses resolves to a token', () => {
    const colours = new Set(
      Object.keys(TOKENS)
        .filter((n) => n.startsWith('color-'))
        .map((n) => n.slice('color-'.length)),
    )
    const sizes = new Set(
      Object.keys(TOKENS)
        .filter((n) => n.startsWith('text-'))
        .map((n) => n.slice('text-'.length)),
    )
    const radii = new Set(
      Object.keys(TOKENS)
        .filter((n) => n.startsWith('radius-'))
        .map((n) => n.slice('radius-'.length)),
    )
    const shadows = new Set(
      Object.keys(TOKENS)
        .filter((n) => n.startsWith('shadow-'))
        .map((n) => n.slice('shadow-'.length)),
    )
    const utilities =
      '(?:bg|text|border|fill|stroke|ring|from|to|via|divide|outline|decoration|accent|shadow)'
    const classes = [
      ...text.matchAll(
        new RegExp(
          `(?<![\\w-])(?:[a-z-]+:)*${utilities}-([a-z0-9-]+)(?:/\\d+)?(?![\\w-])`,
          'g',
        ),
      ),
    ].map((m) => m[1])
    const builtIn =
      /^(?:white|black|transparent|current|inherit|none|left|right|center|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip|top|bottom|x|y|t|b|l|r|s|e|dashed|dotted|solid|l-\d|\d+|px|sm|md|lg|xl|2xl|3xl|xs|base)$/
    const unknown = classes.filter(
      (name) =>
        !colours.has(name) &&
        !sizes.has(name) &&
        !shadows.has(name) &&
        !builtIn.test(name) &&
        !name.startsWith('[') &&
        !['collapse', 'separate', 'spacing'].includes(name),
    )
    expect(unknown).toEqual([])
    expect(radii.has('card') && radii.has('chip')).toBe(true)
    const rounded = [...text.matchAll(/(?<![\w-])rounded-([a-z0-9]+)/g)].map(
      (m) => m[1],
    )
    expect(
      rounded.filter(
        (r) =>
          !radii.has(r) &&
          !['full', 'lg', 'md', 'sm', 'none', 'xl', '2xl'].includes(r),
      ),
    ).toEqual([])
    const textSizes = [
      ...text.matchAll(
        /(?<![\w-])text-(xs|sm|base|lg|xl|2xl|3xl|4xl)(?![\w-])/g,
      ),
    ].map((m) => m[1])
    expect(textSizes.filter((s) => !sizes.has(s))).toEqual([])
  })
})
