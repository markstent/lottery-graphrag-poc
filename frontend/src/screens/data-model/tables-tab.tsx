/**
 * The Tables tab (D-115): the synthetic company's tables on the explorer
 * layout. Choose a table on the left, see its rows in the middle, and the
 * chosen row as a record on the right, with the graph links it becomes. The
 * table and row are in the address (`tab=tables&table=<table>&row=<id>`), so
 * every step is a link. With no table in the address it opens on the example
 * incident the Overview follows, or the incidents table with no row chosen
 * when there is none or the example cannot be read (the Overview shows that
 * error; here it would only block the tables).
 */

import {
  getDataModelExample,
  getDictionary,
  getGraphSchema,
  listDatasets,
  type Schemas,
} from '../../api/client'
import { hrefFor } from '../../app/router'
import { plainName } from '../../app/plain-words'
import { useLoad } from '../../app/use-load'
import { plural } from '../../charts/scale'
import { Panel } from '../../components/panel'
import { WAREHOUSE_ABOUT } from './about-copy'
import { AboutContent } from './about'
import { INCIDENTS } from './example'
import { Explorer, PickList, type PickGroup } from './explorer'
import { count, groupBySystem, systemName } from './model'
import { RecordDetail } from './record-detail'
import { RowsGrid } from './rows-grid'

const STEPS = ['Choose a table', 'Its rows', 'The record'] as const

const show = (params: Record<string, string>) => {
  window.location.hash = hrefFor('data-model', { tab: 'tables', ...params })
}

async function loadWorld(signal: AbortSignal) {
  const worlds = await listDatasets(signal)
  const world = worlds.find((w) => w.active) ?? worlds[0]
  if (!world) return null
  const [dictionary, schema] = await Promise.all([
    getDictionary(world.dataset_id, signal),
    // Without the graph's schema a record's links still read, naming "records".
    getGraphSchema(signal).catch(() => null),
  ])
  return dictionary.length > 0 ? { world, dictionary, schema } : null
}

function TableRows({
  datasetId,
  table,
  rowCount,
  rowId,
}: {
  datasetId: string
  table: Schemas['TableSchemaOut']
  rowCount: number | undefined
  rowId: string | undefined
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-base font-semibold text-text-primary">
          {plainName(table.table)}
        </p>
        <p className="text-sm text-text-primary">{table.description}</p>
        <p className="mt-1 text-sm text-text-secondary">
          {`From ${systemName(table.source_system)}`}
          {rowCount !== undefined && `, ${plural(rowCount, 'row')}`}
          {`, ${plural(table.columns.length, 'column')}`}
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Choose a row to see its record. An underlined value goes to the row it
          names.
        </p>
      </div>
      <RowsGrid
        key={table.table}
        datasetId={datasetId}
        schema={table}
        chosen={rowId}
        onOpenRow={(row) => show({ table: table.table, row })}
      />
    </div>
  )
}

export function TablesTab({ params }: { params: URLSearchParams }) {
  const named = params.get('table')
  const world = useLoad(loadWorld, 'tables')
  // The example is only asked for when the address names no table.
  const example = useLoad(
    (signal) =>
      named === null
        ? getDataModelExample(signal).then((e) => e.incident_id ?? null)
        : Promise.resolve(null),
    `tables-example/${named === null}`,
  )

  if (world.status !== 'ready' || world.data === null)
    return (
      <Panel
        title="Tables"
        state={world.status === 'ready' ? 'empty' : world.status}
        message="No data has been generated yet."
        error={world.status === 'error' ? world.error : undefined}
        onRetry={world.retry}
      />
    )
  if (named === null && example.status === 'loading')
    return <Panel title="Tables" state="loading" />

  const { world: dataset, dictionary, schema } = world.data
  const tableName = named ?? INCIDENTS
  const rowId =
    named === null
      ? ((example.status === 'ready' ? example.data : null) ?? undefined)
      : (params.get('row') ?? undefined)
  const table = dictionary.find((t) => t.table === tableName)
  const groups: PickGroup[] = groupBySystem(dictionary).map(
    ({ system, tables }) => ({
      name: systemName(system),
      items: tables.map((t) => ({
        id: t.table,
        title: plainName(t.table),
        note: t.description,
        detail:
          dataset.row_counts[t.table] === undefined
            ? undefined
            : count(dataset.row_counts[t.table]),
      })),
    }),
  )

  return (
    <Explorer
      steps={STEPS}
      about={<AboutContent copy={WAREHOUSE_ABOUT} />}
      list={
        <div className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-1">
          <PickList
            label="Search tables"
            groups={groups}
            chosen={table?.table}
            onChoose={(id) => show({ table: id })}
          />
        </div>
      }
      main={
        table ? (
          <TableRows
            datasetId={dataset.dataset_id}
            table={table}
            rowCount={dataset.row_counts[table.table]}
            rowId={rowId}
          />
        ) : (
          <p className="text-sm text-text-secondary">{`There is no table called ${tableName}.`}</p>
        )
      }
      detail={
        table ? (
          <RecordDetail
            datasetId={dataset.dataset_id}
            table={table.table}
            rowId={rowId}
            schema={schema}
          />
        ) : (
          <p className="text-sm text-text-secondary">
            Choose a table to see its rows.
          </p>
        )
      }
    />
  )
}
