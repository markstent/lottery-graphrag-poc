/**
 * The Warehouse tab: the tables of the synthetic enterprise data, one group
 * per source system with live row counts and the links between tables; a
 * table opens its rows (`?table=`), and a row opens as a record that can be
 * followed into the graph.
 */

import { useState } from 'react'

import { getDictionary, listDatasets, type Schemas } from '../../api/client'
import { plainName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad } from '../../app/use-load'
import { EvidenceDrawer } from '../../components/evidence-drawer'
import { Panel } from '../../components/panel'
import { Diagram } from './meta-graph'
import {
  count,
  groupBySystem,
  systemName,
  type DiagramEdge,
  type DiagramNode,
} from './model'
import { RowsGrid } from './rows-grid'

type Table = Schemas['TableSchemaOut']

/** Width of a table box: its name plus room either side, at normal type. */
const widthOf = (name: string, scale: number) =>
  Math.round(Math.max(170, name.length * 11 + 40) * scale)

function SystemMap({
  system,
  tables,
  rowCounts,
  scale,
}: {
  system: string
  tables: Table[]
  rowCounts: Record<string, number>
  scale: number
}) {
  const here = new Set(tables.map((t) => t.table))
  const nodes: DiagramNode[] = tables.map((t) => ({
    id: t.table,
    title: plainName(t.table),
    detail:
      rowCounts[t.table] === undefined
        ? undefined
        : `${count(rowCounts[t.table])} ${rowCounts[t.table] === 1 ? 'row' : 'rows'}`,
    width: widthOf(plainName(t.table), scale),
  }))
  const edges: DiagramEdge[] = tables.flatMap((t) =>
    t.foreign_keys
      .filter((fk) => here.has(fk.table) && fk.table !== t.table)
      .map((fk) => ({
        id: `${t.table}.${fk.column}>${fk.table}`,
        source: t.table,
        target: fk.table,
      })),
  )
  const rows = tables.reduce((sum, t) => sum + (rowCounts[t.table] ?? 0), 0)
  return (
    <Panel
      title={systemName(system)}
      purpose={`${tables.length} ${tables.length === 1 ? 'table' : 'tables'}, ${count(rows)} rows`}
      state="ready"
    >
      <Diagram
        nodes={nodes}
        edges={edges}
        label={`${systemName(system)} tables`}
        scale={scale}
        onSelect={(table) => {
          window.location.hash = hrefFor('data-model', {
            tab: 'warehouse',
            table,
          })
        }}
      />
    </Panel>
  )
}

function TableView({
  datasetId,
  table,
  rowCount,
}: {
  datasetId: string
  table: Table
  rowCount: number | undefined
}) {
  const [open, setOpen] = useState<string | null>(null)
  const links = table.foreign_keys
  return (
    <div className="space-y-4">
      <div>
        <a
          href={hrefFor('data-model', { tab: 'warehouse' })}
          className="text-sm text-text-primary underline"
        >
          All tables
        </a>
        <h2 className="mt-2 text-lg font-semibold text-text-primary">
          {table.table}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {`Source: ${systemName(table.source_system)}`}
          {rowCount !== undefined && ` · ${count(rowCount)} rows`}
          {` · ${table.columns.length} columns`}
        </p>
        {links.length > 0 && (
          <p className="mt-1 text-sm text-text-secondary">
            Links to:{' '}
            {links.map((fk, index) => (
              <span key={`${fk.column}>${fk.table}`}>
                {index > 0 && ', '}
                <a
                  href={hrefFor('data-model', {
                    tab: 'warehouse',
                    table: fk.table,
                  })}
                  className="text-text-primary underline"
                >
                  {fk.table}
                </a>
                {` (by ${fk.column})`}
              </span>
            ))}
          </p>
        )}
      </div>
      <RowsGrid
        key={table.table}
        datasetId={datasetId}
        schema={table}
        onOpenRow={setOpen}
      />
      <EvidenceDrawer
        source={
          open === null
            ? null
            : { kind: 'record', datasetId, table: table.table, rowId: open }
        }
        onClose={() => setOpen(null)}
        followInto={(node) => hrefFor('data-model', { tab: 'graph', node })}
      />
    </div>
  )
}

export function Warehouse({
  params,
  scale,
}: {
  params: URLSearchParams
  scale: number
}) {
  const load = useLoad(async (signal) => {
    const worlds = await listDatasets(signal)
    const world = worlds.find((w) => w.active) ?? worlds[0]
    if (!world) return null
    const dictionary = await getDictionary(world.dataset_id, signal)
    return dictionary.length > 0 ? { world, dictionary } : null
  }, 'warehouse')

  if (load.status !== 'ready' || load.data === null)
    return (
      <Panel
        title="Tables"
        state={load.status === 'ready' ? 'empty' : load.status}
        message="No data has been generated yet."
        error={load.status === 'error' ? load.error : undefined}
        onRetry={load.retry}
      />
    )

  const { world, dictionary } = load.data
  const chosen = params.get('table')
  if (chosen !== null) {
    const table = dictionary.find((t) => t.table === chosen)
    return table ? (
      <TableView
        datasetId={world.dataset_id}
        table={table}
        rowCount={world.row_counts[table.table]}
      />
    ) : (
      <Panel
        title="Table"
        state="empty"
        message={`There is no table called ${chosen}.`}
      />
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Each box is a table with its row count. Select one to see its rows.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        {groupBySystem(dictionary).map(({ system, tables }) => (
          <SystemMap
            key={system}
            system={system}
            tables={tables}
            rowCounts={world.row_counts}
            scale={scale}
          />
        ))}
      </div>
    </div>
  )
}
