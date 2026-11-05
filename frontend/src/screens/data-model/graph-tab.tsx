/**
 * The Graph tab's "Kinds of link" table, for its "About this" drawer (D-113,
 * D-115): what each kind of link joins, where it is made from and how many
 * there are, grouped by which approaches may follow it, with a filter for the
 * links Graph follows, those Graph + Ontology follows, or all of them.
 */

import { useState, type ReactNode } from 'react'

import type { Schemas } from '../../api/client'
import { MISSING } from '../../app/score-words'
import { ScrollBox } from '../../components/scroll-box'
import { pipeline } from '../../design/pipelines'
import { RELATIONSHIP_SOURCES } from '../../design/relationships'
import {
  count,
  FOLLOWED_BY,
  relationshipRows,
  type AllowList,
  type RelationshipRow,
} from './model'

const MODES: { id: AllowList; label: string }[] = [
  { id: 'B', label: pipeline('B').label },
  { id: 'C', label: pipeline('C').label },
  { id: 'full', label: 'All links' },
]

/** Links to documents, which every approach reaches by text search instead. */
const DOCUMENT_LINKS = new Set(['HAS_CHUNK', 'REFERENCES'])

/** The groups of the table: who may walk a kind of link, and why when not both. */
const LINK_GROUPS: readonly {
  id: string
  title: string
  why?: string
  holds: (row: RelationshipRow) => boolean
}[] = [
  {
    id: 'both',
    title: FOLLOWED_BY.both,
    holds: (row) => row.follower === 'both',
  },
  {
    id: 'b',
    title: FOLLOWED_BY.B,
    holds: (row) => row.follower === 'B',
  },
  {
    id: 'c',
    title: FOLLOWED_BY.C,
    why: 'These come from the ontology.',
    holds: (row) => row.follower === 'C',
  },
  {
    id: 'documents',
    title: FOLLOWED_BY.neither,
    why: 'Documents are found by text search, in all three approaches.',
    holds: (row) => row.follower === 'neither' && DOCUMENT_LINKS.has(row.type),
  },
  {
    id: 'focus',
    title: FOLLOWED_BY.neither,
    why: 'Left out to keep the search focused: these are many, or lead to many records.',
    holds: (row) => row.follower === 'neither' && !DOCUMENT_LINKS.has(row.type),
  },
]

function RelationshipTable({
  rows,
  filter,
}: {
  rows: RelationshipRow[]
  filter: ReactNode
}) {
  return (
    <section aria-labelledby="links-title" className="space-y-3">
      <h4
        id="links-title"
        className="text-base font-semibold text-text-primary"
      >
        Kinds of link
      </h4>
      <p className="max-w-prose text-sm text-text-secondary">
        A link joins two records, such as an incident and the game it affects.
        Each row says what a kind of link joins, where it is made from, and how
        many there are. Graph and Graph + Ontology search by moving along links;
        some kinds are left out on purpose, and each group says why.
      </p>
      {filter}
      <ScrollBox label="Kinds of link">
        <table className="w-full max-w-6xl border-collapse text-sm text-text-primary">
          <thead>
            <tr className="border-b border-hairline text-left text-text-secondary">
              <th scope="col" className="py-2 pr-4 font-semibold">
                What it links
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold">
                Made from
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-semibold">
                How many
              </th>
            </tr>
          </thead>
          {LINK_GROUPS.map((group) => {
            const members = rows.filter(group.holds)
            if (members.length === 0) return null
            return (
              <tbody key={group.id}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="pb-1 pt-4 text-left font-normal"
                  >
                    <span className="font-semibold">{group.title}</span>
                    {group.why && (
                      <span className="text-text-secondary">{` - ${group.why}`}</span>
                    )}
                  </th>
                </tr>
                {members.map((row) => (
                  <tr key={row.type} className="border-b border-hairline">
                    <th
                      scope="row"
                      className="py-1.5 pr-4 text-left font-normal"
                    >
                      {row.sentences.join('; ')}
                    </th>
                    <td className="py-1.5 pr-4 text-text-secondary">
                      {RELATIONSHIP_SOURCES[row.type] ?? MISSING}
                    </td>
                    <td className="tabular py-1.5 pl-3 text-right">
                      {row.total === null ? MISSING : count(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </ScrollBox>
    </section>
  )
}

/** The table of every kind of link, narrowed to what one approach may follow when chosen. */
export function KindsOfLink({
  schema,
  stats,
}: {
  schema: Schemas['GraphSchema']
  stats: Schemas['GraphStats']
}) {
  const [mode, setMode] = useState<AllowList>('full')
  const followed = mode === 'full' ? null : new Set(schema.allow_list[mode])
  const rows = relationshipRows(schema, stats).filter(
    (row) => followed === null || followed.has(row.type),
  )
  return (
    <RelationshipTable
      rows={rows}
      filter={
        <div
          role="radiogroup"
          aria-labelledby="links-shown"
          className="flex flex-wrap items-center gap-2"
        >
          <span id="links-shown" className="text-sm text-text-secondary">
            Show the links followed by
          </span>
          {MODES.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2 rounded-chip border border-border px-3 py-1 text-sm text-text-primary has-[:checked]:bg-surface-raised has-[:checked]:font-semibold has-[:focus-visible]:outline-2"
            >
              <input
                type="radio"
                name="allow-list"
                checked={mode === option.id}
                onChange={() => setMode(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
      }
    />
  )
}
