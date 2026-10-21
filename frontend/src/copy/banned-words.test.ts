/**
 * Product copy rules (spec 7.8). The scan reads each source file's syntax
 * tree and checks only text a person can read or hear: JSX text, accessible
 * names, and string values of label-like props. Identifiers, comments, object
 * keys, import paths and API field names are not copy and are never scanned.
 */

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { datasetName, plainName, plainValue } from '../app/plain-words'
import { EVIDENCE_STATES } from '../design/evidence-states'
import { NODE_LABELS, countedLabel, nodeLabel } from '../design/node-labels'
import { PIPELINES } from '../design/pipelines'
import {
  RELATIONSHIP_PHRASES,
  relationshipPhrase,
} from '../design/relationships'
import { GLOSSARY } from './glossary'

export const BANNED_WORDS = [
  'honest',
  'never',
  'real',
  'fake',
  'prototype',
  'telemetry',
  'seed',
  'chunk',
  'rerank',
  'MAPS_TO',
] as const

/** Whole words only, so "real" does not catch "realm". Common inflections count. */
const BANNED = new RegExp(
  `\\b(?:honest|never|real|fake|prototypes?|telemetry|seeds?|chunk(?:s|ed|ing)?|rerank(?:s|ed|er|ing)?|MAPS_TO)\\b`,
  'i',
)

/** The v1 pipeline names, banned when used as a name; "Graph + Ontology" is fine. */
const V1_PIPELINE_NAME = /^(?:[ABC] · )?(?:baseline|ontology)$/i

const COPY_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'title',
  'placeholder',
  'alt',
  'label',
  'description',
  'message',
  'text',
  'caption',
])

/**
 * Files that Phase 6 deletes or rewrites. They still carry v1 copy and are
 * skipped by the scan until then. A test fails if a listed file is gone, so
 * the list cannot outlive the files.
 */
export const PHASE6_REWRITES = [
  'views/live-lab.tsx',
  'views/results-dashboard.tsx',
  'views/data-dictionary.tsx',
  'views/help.tsx',
  'views/experiment-home.tsx',
  'views/v1-graph-pane.tsx',
  'views/v1-evidence-inspector.tsx',
  'components/rag-pane.tsx',
  'components/score-strip.tsx',
  'components/timeline.tsx',
  'components/doc.tsx',
  'components/answer-block.tsx',
  'mock/content.ts',
  'mock/evidence.ts',
  'mock/telemetry.ts',
  'api/backend-run.ts',
] as const

const isStringLike = (node: ts.Node): node is ts.StringLiteralLike =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

/** The literal text an expression can show: literals, branches, joins and templates. */
function textsOf(node: ts.Node | undefined): string[] {
  if (node === undefined) return []
  if (isStringLike(node)) return [node.text]
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.flatMap((span) => [
        ...textsOf(span.expression),
        span.literal.text,
      ]),
    ]
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
    return textsOf(node.expression)
  if (ts.isConditionalExpression(node))
    return [...textsOf(node.whenTrue), ...textsOf(node.whenFalse)]
  if (ts.isBinaryExpression(node))
    return [...textsOf(node.left), ...textsOf(node.right)]
  return []
}

/** Every piece of copy in `source`, with its 1-based line. */
export function copyIn(
  source: string,
  fileName = 'sample.tsx',
): { line: number; text: string }[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const found: { line: number; text: string }[] = []
  const add = (node: ts.Node, texts: string[]) => {
    const line =
      file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    for (const text of texts) if (text.trim() !== '') found.push({ line, text })
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, [node.text])
    else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent))
      add(node, textsOf(node.expression))
    else if (
      ts.isJsxAttribute(node) &&
      COPY_ATTRIBUTES.has(node.name.getText(file))
    ) {
      const init = node.initializer
      add(
        node,
        init && ts.isJsxExpression(init)
          ? textsOf(init.expression)
          : textsOf(init),
      )
    } else if (
      ts.isPropertyAssignment(node) &&
      COPY_ATTRIBUTES.has(node.name.getText(file))
    )
      add(node, textsOf(node.initializer))
    else if (
      ts.isNewExpression(node) &&
      node.expression.getText(file).endsWith('Error')
    )
      add(node, textsOf(node.arguments?.[0]))
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Why `text` breaks the copy rules, or undefined when it is fine. */
export function violation(text: string): string | undefined {
  const word = BANNED.exec(text)
  if (word) return `banned word "${word[0]}"`
  if (V1_PIPELINE_NAME.test(text.trim()))
    return `v1 pipeline name "${text.trim()}"`
  return undefined
}

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const relative = (path: string) => path.replace(/^\/src\//, '')
const isCopyFile = (path: string) =>
  !/\.test\.tsx?$/.test(path) &&
  !path.endsWith('schema.d.ts') &&
  !path.startsWith('/src/test/') &&
  !path.startsWith('/src/copy/')

describe('banned word list', () => {
  it('is exactly the list in spec 7.8', () => {
    expect([...BANNED_WORDS]).toEqual([
      'honest',
      'never',
      'real',
      'fake',
      'prototype',
      'telemetry',
      'seed',
      'chunk',
      'rerank',
      'MAPS_TO',
    ])
  })

  it('has a plain replacement for every term the glossary covers', () => {
    expect(GLOSSARY.seed).toBe('starting point')
    expect(GLOSSARY.chunk).toBe('passage')
    for (const plain of Object.values(GLOSSARY))
      expect(violation(plain)).toBeUndefined()
  })
})

describe('copy scan', () => {
  it('fails a planted banned string in JSX text, an aria-label and a label prop', () => {
    const planted = `export const A = () => (
      <div aria-label="Chunk viewer" title={ok ? 'fine' : 'a fake one'}>
        We picked the seed node
        <Pill label="Reranked list" />
      </div>
    )`
    const hits = copyIn(planted)
      .filter((copy) => violation(copy.text))
      .map((copy) => copy.text.trim())
    expect(hits).toEqual([
      'Chunk viewer',
      'a fake one',
      'We picked the seed node',
      'Reranked list',
    ])
  })

  it('catches seed and seeds but not seeded, and not real inside realm', () => {
    expect(violation('Seed')).toBeDefined()
    expect(violation('three seeds')).toBeDefined()
    expect(violation('a seeded draw')).toBeUndefined()
    expect(violation('the realm of games')).toBeUndefined()
    expect(violation('this is real')).toBeDefined()
    expect(violation('MAPS_TO')).toBeDefined()
  })

  it('passes identifiers, field names, comments, keys and import paths', () => {
    const quiet = `
      // the seed chunk telemetry is here
      import { seedNodes } from './telemetry'
      const chunkCount = reranked.length
      export const B = () => <div className="seed-chunk" data-testid="telemetry">{seedNodes.map((n) => n.chunk_id)}</div>
      const row = { seed: 1, rerank: 2, label: 'Starting point' }
    `
    expect(copyIn(quiet).filter((copy) => violation(copy.text))).toEqual([])
  })

  it('bans the v1 pipeline names as names but allows the ontology as a concept', () => {
    expect(violation('Baseline')).toBeDefined()
    expect(violation('Ontology')).toBeDefined()
    expect(violation('C · Ontology')).toBeDefined()
    expect(violation('A · Baseline')).toBeDefined()
    expect(violation('C · Graph + Ontology')).toBeUndefined()
    expect(violation('Ontology concept')).toBeUndefined()
    expect(violation('added by the ontology')).toBeUndefined()
  })

  it('has no banned copy outside the Phase 6 rewrites', () => {
    const skipped = new Set<string>(PHASE6_REWRITES)
    const hits = Object.entries(sources)
      .filter(([path]) => isCopyFile(path) && !skipped.has(relative(path)))
      .flatMap(([path, source]) =>
        copyIn(source, path).flatMap(({ line, text }) => {
          const why = violation(text)
          return why ? [`${relative(path)}:${line} ${why}: ${text.trim()}`] : []
        }),
      )
    expect(hits).toEqual([])
  })

  it('only excludes files that still exist', () => {
    const existing = new Set(Object.keys(sources).map(relative))
    expect(PHASE6_REWRITES.filter((file) => !existing.has(file))).toEqual([])
  })
})

describe('generated copy', () => {
  const outputs: string[] = [
    ...Object.keys(RELATIONSHIP_PHRASES).flatMap((type) => [
      RELATIONSHIP_PHRASES[type],
      relationshipPhrase(type),
    ]),
    ...Object.keys(NODE_LABELS).flatMap((label) => [
      nodeLabel(label),
      countedLabel(1, label),
      countedLabel(3, label),
    ]),
    ...Object.values(EVIDENCE_STATES).map((state) => state.label),
    ...PIPELINES.flatMap((pipeline) => [pipeline.name, pipeline.label]),
    ...['dev-seed2026', 'dev-seed2027', 'dev-seed2028'].map(datasetName),
    plainName('affected_systems'),
    plainValue({ affectedSystems: ['a', null], note: 'ok' }),
    // Relationship types in the graph schema that have no phrase of their own.
    ...[
      'ABOUT',
      'DEFINES',
      'DESCRIBES',
      'EQUIVALENT_TO',
      'HAS_RULE',
      'PREFERS',
    ].map(relationshipPhrase),
  ]

  it('has no banned word in anything the helpers and label maps say', () => {
    expect(outputs.length).toBeGreaterThan(100)
    expect(outputs.flatMap((text) => (violation(text) ? [text] : []))).toEqual(
      [],
    )
  })

  it('names the pipelines A, B and C as the spec requires', () => {
    expect(PIPELINES.map((pipeline) => pipeline.label)).toEqual([
      'A · Text search',
      'B · Graph',
      'C · Graph + Ontology',
    ])
  })
})
