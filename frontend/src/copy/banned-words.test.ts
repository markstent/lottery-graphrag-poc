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
import { MODEL_LABELS, REACHABLE } from '../app/settings-labels'
import { PIPELINES } from '../design/pipelines'
import { APPROACH_LINES } from '../screens/help/approach-lines'
import { CHAPTER_COPY } from '../screens/help/copy'
import type { Block, ChapterCopy } from '../screens/help/chapters'
import { STRATUM_NAMES } from '../screens/help/bank'
import { KIND_WORDS } from '../app/run-kinds'
import {
  COMPARISON_LABELS,
  GROUP_LABELS,
  JUDGE_LABELS,
  STRATUM_LABELS,
} from '../results/strata'
import {
  RELATIONSHIP_PHRASES,
  relationshipPhrase,
} from '../design/relationships'
import { OUTSIDE_HELP_WORD_CAP, wordsIn } from './budget'
import { GLOSSARY, GLOSSARY_TERMS } from './glossary'

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
 * Spec 7.6 names the Data Model tab "Ontology", which is the one place that
 * word stands alone as a name. It is the concept, not the v1 pipeline.
 */
const NAMED_EXCEPTIONS = [
  { file: 'screens/data-model/data-model.tsx', text: 'Ontology' },
] as const

/** Attributes read out or kept as a fallback, never drawn: they do not count toward the budget. */
const NOT_SHOWN = /^(?:aria-.*|alt)$/

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
  if (ts.isBinaryExpression(node)) {
    // `a === 'ready'` compares and shows nothing; `cond && 'text'` shows its right side.
    // Any other operator, and the left of `&&`, is not counted: no source draws text from one.
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return textsOf(node.right)
      case ts.SyntaxKind.BarBarToken:
      case ts.SyntaxKind.QuestionQuestionToken:
      case ts.SyntaxKind.PlusToken:
        return [...textsOf(node.left), ...textsOf(node.right)]
      default:
        return []
    }
  }
  return []
}

/** A .ts file is not JSX: `<T>` in it is a type argument, not an element. */
const scriptKind = (fileName: string) =>
  fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS

/** Every piece of copy in `source`, with its 1-based line. */
export function copyIn(
  source: string,
  fileName = 'sample.tsx',
): { line: number; text: string; visible: boolean }[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  const found: { line: number; text: string; visible: boolean }[] = []
  const add = (node: ts.Node, texts: string[], visible = true) => {
    const line =
      file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    for (const text of texts)
      if (text.trim() !== '') found.push({ line, text, visible })
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
        !NOT_SHOWN.test(node.name.getText(file)),
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
    // Matches Settings' "Re-ordering model"; "judge" is for the scoring judge only.
    expect(GLOSSARY.rerank).toBe('re-ordering')
    expect(GLOSSARY.reranked).toBe('re-ordered')
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

  it('has no banned copy anywhere', () => {
    const hits = Object.entries(sources)
      .filter(([path]) => isCopyFile(path))
      .flatMap(([path, source]) =>
        copyIn(source, path).flatMap(({ line, text }) => {
          const why = violation(text)
          const allowed = NAMED_EXCEPTIONS.some(
            (e) => e.file === relative(path) && e.text === text.trim(),
          )
          return why && !allowed
            ? [`${relative(path)}:${line} ${why}: ${text.trim()}`]
            : []
        }),
      )
    expect(hits).toEqual([])
  })

  it('only allows named exceptions that are still in their file', () => {
    const stale = NAMED_EXCEPTIONS.filter(
      (e) =>
        !copyIn(sources[`/src/${e.file}`] ?? '', e.file).some(
          (copy) => copy.text.trim() === e.text,
        ),
    )
    expect(stale).toEqual([])
  })
})

/** Product copy outside Help: every source a screen renders, without tests, fixtures or text from the API. */
const isProductCopy = (path: string) =>
  isCopyFile(path) &&
  /^\/src\/(?:screens|app|components|charts|graph|design|results)\//.test(
    path,
  ) &&
  !path.startsWith('/src/screens/help/') &&
  !path.endsWith('.fixtures.ts')

/**
 * Every piece of drawn product copy in a file: what the scan reads, minus the
 * accessible names that are never drawn, plus sentence-like
 * literals held in tables and constants (they start with a capital and hold a
 * space, which class names and identifiers never do). Each text counts once.
 */
function budgetCopyIn(source: string, fileName: string): string[] {
  const found = copyIn(source, fileName)
  const texts = found.filter(({ visible }) => visible).map(({ text }) => text)
  const counted = new Map<string, number>()
  for (const { text } of found) counted.set(text, (counted.get(text) ?? 0) + 1)
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (
      isStringLike(node) &&
      /^[A-Z][^\n]* /.test(node.text) &&
      /[a-z]{2}/.test(node.text)
    ) {
      const left = counted.get(node.text) ?? 0
      if (left > 0) counted.set(node.text, left - 1)
      else texts.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return texts
}

describe('copy budget outside Help', () => {
  const perFile = Object.entries(sources)
    .filter(([path]) => isProductCopy(path))
    .map(([path, source]) => ({
      file: relative(path),
      words: budgetCopyIn(source, path).reduce(
        (total, text) => total + wordsIn(text),
        0,
      ),
    }))
  const total = perFile.reduce((sum, { words }) => sum + words, 0)

  it(`stays within ${OUTSIDE_HELP_WORD_CAP} words`, () => {
    const biggest = [...perFile]
      .sort((a, b) => b.words - a.words)
      .slice(0, 8)
      .map(({ file, words }) => `${file} ${words}`)
    expect(
      total,
      `${total} words; biggest: ${biggest.join(', ')}`,
    ).toBeLessThanOrEqual(OUTSIDE_HELP_WORD_CAP)
  })

  it('counts something, so a broken scan cannot pass', () => {
    expect(total).toBeGreaterThan(600)
  })

  it('counts table and constant copy once, and leaves out accessible names', () => {
    const sample = `const TABLE = { a: 'Two words', b: 'one', c: 'M0,0 L10,5 z' }
      export const X = () => <p aria-label="Not drawn here" title="Two words">Hello there</p>`
    expect(budgetCopyIn(sample, 'x.tsx')).toEqual([
      'Two words',
      'Hello there',
      'Two words',
    ])
  })
})

describe('copy in expressions', () => {
  it('counts what a condition shows, not what it compares', () => {
    const sample = `export const X = () => <p>{ready && 'Shown text'}{status === 'ready' ? 'Yes now' : 'No'}{a || 'Fallback words'}</p>`
    expect(copyIn(sample).map(({ text }) => text)).toEqual([
      'Shown text',
      'Yes now',
      'No',
      'Fallback words',
    ])
  })
})

/** The sentences of the Plain blocks of a chapter: paragraphs and list items. Technical blocks are not read. */
const plainTexts = ({ plain }: ChapterCopy): string[] =>
  plain.flatMap((block: Block) =>
    typeof block === 'string' ? [block] : 'kind' in block ? [] : [...block],
  )

describe('Help chapters', () => {
  it('reads the Plain blocks and skips the Technical blocks', () => {
    const sample: ChapterCopy = {
      plain: [
        'A seed node',
        ['a fake one', 'fine'],
        { kind: 'diagram', name: 'flow' },
      ],
      technical: ['The seed is chosen', ['a chunk']],
    }
    expect(plainTexts(sample).filter((text) => violation(text))).toEqual([
      'A seed node',
      'a fake one',
    ])
  })

  it('has no banned word in the Plain blocks of any chapter', () => {
    const texts = Object.values(CHAPTER_COPY).flatMap(plainTexts)
    expect(texts.length).toBeGreaterThan(5)
    expect(texts.filter((text) => violation(text))).toEqual([])
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
    ...Object.values(MODEL_LABELS),
    // Display maps in screens: a bare "Ontology" as a value is caught here.
    ...Object.values(STRATUM_NAMES),
    ...Object.values(APPROACH_LINES),
    ...Object.values(KIND_WORDS),
    ...Object.values(STRATUM_LABELS),
    ...Object.values(COMPARISON_LABELS),
    ...Object.values(GROUP_LABELS),
    ...Object.values(JUDGE_LABELS),
    ...GLOSSARY_TERMS.flatMap(({ term, meaning }) => [term, meaning]),
    ...Object.values(REACHABLE),
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
