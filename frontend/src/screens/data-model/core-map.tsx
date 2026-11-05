/**
 * The core of the graph on the Overview (D-115): the eight main kinds of
 * record in fixed places, and the links the live schema has between them.
 * The places were chosen so the lines cross only once (the four kinds that
 * all meet one another, support case, incident, game and market, cannot be
 * drawn without one crossing). Lines carry no tags; the links are listed in
 * words beneath, which is also the text alternative. Pointing at or focusing
 * a kind brings its links forward and dims the rest; each kind opens the
 * Graph tab on a sample of that kind (`tab=graph&kind=<label>`).
 */

import { useState } from 'react'

import type { Schemas } from '../../api/client'
import { hrefFor } from '../../app/router'
import { plural } from '../../charts/scale'
import { nodeLabel } from '../../design/node-labels'
import { TOKENS } from '../../design/tokens'
import {
  CORE_KINDS,
  CORE_PLACES,
  coreLinks,
  linkSentence,
  type CoreLink,
} from './model'

/** Box size and the gaps between boxes, in px at normal type. */
const BOX_WIDTH = 200
const BOX_HEIGHT = 60
const COLUMN_GAP = 150
const ROW_GAP = 64
const TITLE_FONT = 16
const DETAIL_FONT = 14
/** Space between a line's end and the box it meets, so the arrow head shows. */
const LINE_GAP = 4
/** Drawn opacity of a line or box that is not part of the kind pointed at. */
const DIMMED = 0.2
/** A kind stays easier to read than a line when dimmed. */
const KIND_DIMMED = 0.45

const VIEW_WIDTH = 3 * BOX_WIDTH + 2 * COLUMN_GAP
const VIEW_HEIGHT = 3 * BOX_HEIGHT + 2 * ROW_GAP

interface Point {
  x: number
  y: number
}

const centre = (kind: string): Point => {
  const { col, row } = CORE_PLACES[kind]
  return {
    x: col * (BOX_WIDTH + COLUMN_GAP) + BOX_WIDTH / 2,
    y: row * (BOX_HEIGHT + ROW_GAP) + BOX_HEIGHT / 2,
  }
}

/** Where the line from `from` towards `to` leaves the box around `from`. */
function edgeOfBox(from: Point, to: Point, gap: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const reach = Math.min(
    dx === 0 ? Infinity : (BOX_WIDTH / 2 + gap) / Math.abs(dx),
    dy === 0 ? Infinity : (BOX_HEIGHT / 2 + gap) / Math.abs(dy),
  )
  return { x: from.x + dx * reach, y: from.y + dy * reach }
}

export function CoreMap({
  schema,
  stats,
  scale,
}: {
  schema: Schemas['GraphSchema']
  stats: Schemas['GraphStats']
  scale: number
}) {
  const [active, setActive] = useState<string | null>(null)
  const kinds = CORE_KINDS.filter((k) => schema.labels.includes(k))
  const links = coreLinks(schema)
  const touches = (link: CoreLink) =>
    active === null || link.from === active || link.to === active
  const near = new Set(
    active === null
      ? kinds
      : [active, ...links.filter(touches).flatMap((l) => [l.from, l.to])],
  )
  // The words read kind by kind, in the grid's order, so each kind's links sit together.
  const byKind = [...links].sort(
    (a, b) => CORE_KINDS.indexOf(a.from) - CORE_KINDS.indexOf(b.from),
  )
  // Two links between the same pair would draw one line; it is drawn once.
  const lines = [
    ...new Map(links.map((l) => [`${l.from}>${l.to}`, l])).values(),
  ]

  return (
    <div className="space-y-5">
      <svg
        role="group"
        aria-label="The main kinds of record"
        viewBox={`-8 -8 ${VIEW_WIDTH + 16} ${VIEW_HEIGHT + 16}`}
        className="mx-auto block h-auto max-w-full"
        style={{ width: (VIEW_WIDTH + 16) * scale }}
      >
        <defs>
          <marker
            id="core-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={TOKENS['color-grey-600']} />
          </marker>
        </defs>
        {lines.map((link) => {
          const a = centre(link.from)
          const b = centre(link.to)
          const start = edgeOfBox(a, b, 0)
          const end = edgeOfBox(b, a, LINE_GAP)
          return (
            <line
              key={link.id}
              data-link={link.id}
              data-dimmed={touches(link) ? undefined : true}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={TOKENS['color-grey-600']}
              strokeWidth={1.5}
              markerEnd="url(#core-arrow)"
              opacity={touches(link) ? 1 : DIMMED}
              className="motion-safe:transition-opacity"
            />
          )
        })}
        {kinds.map((kind) => {
          const { x, y } = centre(kind)
          const title = nodeLabel(kind)
          const detail = plural(stats.nodes_by_label[kind] ?? 0, 'record')
          return (
            <a
              key={kind}
              href={hrefFor('data-model', { tab: 'graph', kind })}
              aria-label={`${title}, ${detail}`}
              data-kind={kind}
              className="core-kind motion-safe:transition-opacity"
              style={{ opacity: near.has(kind) ? 1 : KIND_DIMMED }}
              onMouseEnter={() => setActive(kind)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(kind)}
              onBlur={() => setActive(null)}
            >
              <rect
                x={x - BOX_WIDTH / 2}
                y={y - BOX_HEIGHT / 2}
                width={BOX_WIDTH}
                height={BOX_HEIGHT}
                rx={8}
                fill={
                  active === kind
                    ? TOKENS['color-grey-100']
                    : TOKENS['color-surface']
                }
                stroke={
                  active === kind
                    ? TOKENS['color-grey-900']
                    : TOKENS['color-grey-600']
                }
                strokeWidth={active === kind ? 2.5 : 1.5}
              />
              <text
                x={x}
                y={y - 9}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={TITLE_FONT}
                fontWeight={600}
                fill={TOKENS['color-text-primary']}
              >
                {title}
              </text>
              <text
                x={x}
                y={y + 12}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={DETAIL_FONT}
                fill={TOKENS['color-text-secondary']}
              >
                {detail}
              </text>
            </a>
          )
        })}
      </svg>
      <ul
        aria-label="The main kinds of record, in words"
        className="mx-auto max-w-full gap-x-10 text-sm sm:columns-2"
        style={{ width: (VIEW_WIDTH + 16) * scale }}
      >
        {byKind.map((link) => (
          <li
            key={link.id}
            data-dimmed={touches(link) ? undefined : true}
            className="break-inside-avoid py-0.5 text-text-secondary data-dimmed:text-text-muted data-dimmed:opacity-60"
          >
            {linkSentence(link.type, link.from, link.to)}
          </li>
        ))}
      </ul>
    </div>
  )
}
