/**
 * The foundation gallery, at `#/__gallery`: every primitive in every state,
 * drawn from the committed fixtures, so each can be looked at and baselined
 * (e2e/visual.spec.ts). `?section=<id>` shows one section, which keeps the
 * graph canvases from all laying out at once. Left out of the production build.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { ApiError } from '../api/http'
import { SettingsDrawer } from '../app/settings-drawer'
import { useSettings } from '../app/use-settings'
import { DataTable } from '../charts/data-table'
import { GroupedBars } from '../charts/grouped-bars'
import { IntervalPlot } from '../charts/interval-plot'
import { Legend } from '../charts/legend'
import { StatTile } from '../charts/stat-tile'
import { Drawer } from '../components/drawer'
import { EvidenceDrawer } from '../components/evidence-drawer'
import { Panel, SkeletonBar, type PanelState } from '../components/panel'
import { EVIDENCE_STATES, type EvidenceState } from '../design/evidence-states'
import { PIPELINES } from '../design/pipelines'
import { TOKENS, type TokenName } from '../design/tokens'
import { EvidencePathList } from '../graph/evidence-path-list'
import { GraphLegend } from '../graph/graph-legend'
import { GraphSummary } from '../graph/graph-summary'
import { Outline } from '../graph/node'
import {
  BAR_DELTA,
  BAR_GROUPS,
  BAR_GROUPS_NEGATIVE,
  BAR_GROUPS_WITH_GAPS,
  BAR_INTERVALS,
  INTERVAL_ROWS,
  INTERVAL_ROWS_NEGATIVE,
  INTERVAL_ROWS_WITH_GAPS,
} from './gallery-data'
import { fixtureView } from './fixture-view'
import GraphHarness from './graph-harness'

/** One state of one primitive: the unit a baseline is taken of. */
function Block({
  id,
  title,
  width = 'w-[68rem]',
  sample = false,
  children,
}: {
  id: string
  title: string
  width?: string
  /** True for a chart: its numbers are for looking at, not results. */
  sample?: boolean
  children: ReactNode
}) {
  return (
    <div data-gallery={id} className={`${width} bg-background p-4`}>
      <h3 className="mb-2 flex items-baseline gap-3 text-sm font-medium text-text-muted">
        {title}
        {sample ? (
          <span className="rounded-chip border border-border px-2 py-0.5 text-xs font-semibold text-text-primary">
            Sample values, not results
          </span>
        ) : null}
      </h3>
      {children}
    </div>
  )
}

const Card = ({ children }: { children: ReactNode }) => (
  <div className="rounded-card border border-hairline bg-surface p-4">
    {children}
  </div>
)

function Swatch({ name }: { name: TokenName }) {
  return (
    <li className="flex w-40 flex-col gap-1 text-xs">
      <span
        className="h-12 rounded-chip border border-hairline"
        style={{ background: TOKENS[name] }}
      />
      <span className="font-medium text-text-primary">
        {name.replace('color-', '')}
      </span>
      <span className="tabular text-text-muted">{TOKENS[name]}</span>
    </li>
  )
}

function Swatches({ names }: { names: readonly TokenName[] }) {
  return (
    <ul className="flex flex-wrap gap-4">
      {names.map((name) => (
        <Swatch key={name} name={name} />
      ))}
    </ul>
  )
}

function Tokens() {
  return (
    <>
      <Block id="tokens-surfaces" title="Surfaces">
        <Swatches
          names={[
            'color-background',
            'color-surface',
            'color-surface-raised',
            'color-border',
            'color-hairline',
          ]}
        />
      </Block>
      <Block id="tokens-greys" title="Greys">
        <Swatches
          names={
            [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(
              (step) => `color-grey-${step}`,
            ) as TokenName[]
          }
        />
      </Block>
      <Block id="tokens-text" title="Text">
        <Card>
          <p className="text-2xl font-semibold text-text-primary">
            40 px · 2xl · primary 62.5
          </p>
          <p className="text-xl font-semibold text-text-primary">
            28 px · xl · primary 62.5
          </p>
          <p className="text-lg text-text-primary">20 px · lg · primary text</p>
          <p className="text-base text-text-primary">
            16 px · base · primary text
          </p>
          <p className="text-sm text-text-secondary">
            14 px · sm · secondary text
          </p>
          <p className="text-sm text-text-muted">14 px · sm · muted text</p>
          <p className="text-xs text-text-muted">12 px · xs · muted text</p>
          <p className="tabular text-sm text-text-primary">
            14 px · sm · tabular 111.1 / 888.8
          </p>
        </Card>
      </Block>
      <Block id="tokens-pipelines" title="Pipelines, with tint and strong">
        <ul className="flex flex-wrap gap-4">
          {PIPELINES.map((p) => (
            <li key={p.id} className="flex w-72 flex-col gap-2 text-sm">
              <span className="font-semibold" style={{ color: p.strong }}>
                {p.label}
              </span>
              <div className="flex gap-2">
                {(['hue', 'tint', 'strong'] as const).map((tone) => (
                  <span
                    key={tone}
                    className="flex flex-1 flex-col gap-1 text-xs text-text-muted"
                  >
                    <span
                      className="h-12 rounded-chip border border-hairline"
                      style={{ background: p[tone] }}
                    />
                    {tone} {p[tone]}
                  </span>
                ))}
              </div>
              <span
                className="rounded-chip px-3 py-2"
                style={{ background: p.tint, color: p.strong }}
              >
                Strong text on the tint
              </span>
            </li>
          ))}
        </ul>
      </Block>
      <Block id="tokens-status" title="Status and markets">
        <Swatches
          names={[
            'color-status-good',
            'color-status-warning',
            'color-status-serious',
            'color-status-critical',
            'color-success',
            'color-warning',
            'color-error',
            'color-market-uk',
            'color-market-gr',
            'color-market-at',
            'color-market-cz',
          ]}
        />
      </Block>
    </>
  )
}

const STATES = Object.keys(EVIDENCE_STATES) as EvidenceState[]

function EvidenceStates() {
  return (
    <>
      <Block id="evidence-states-table" title="The seven evidence states">
        <Card>
          <table className="w-full text-sm text-text-primary">
            <thead>
              <tr className="border-b border-hairline text-left text-text-secondary">
                <th className="py-2 pr-4 font-semibold">State</th>
                <th className="py-2 pr-4 font-semibold">Words</th>
                <th className="py-2 pr-4 font-semibold">Shape</th>
                <th className="py-2 pr-4 font-semibold">Icon</th>
                <th className="py-2 font-semibold">Fill and stroke</th>
              </tr>
            </thead>
            <tbody>
              {STATES.map((state) => {
                const design = EVIDENCE_STATES[state]
                const Icon = design.icon
                return (
                  <tr key={state} className="border-b border-hairline">
                    <td className="py-2 pr-4">{state}</td>
                    <td className="py-2 pr-4">{design.label}</td>
                    <td className="flex items-center gap-2 py-2 pr-4">
                      <svg aria-hidden="true" width={48} height={28}>
                        <Outline
                          shape={design.shape}
                          w={48}
                          h={28}
                          fill={design.fill}
                          stroke={design.stroke}
                          strokeWidth={2}
                          dashed={design.shape === 'dashed-circle'}
                        />
                      </svg>
                      {design.shape}
                    </td>
                    <td className="py-2 pr-4">
                      <Icon aria-hidden size={18} />
                    </td>
                    <td className="tabular py-2 text-text-muted">
                      {design.fill} {design.stroke}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </Block>
      <Block id="evidence-states-legend-b" title="Graph key, configuration B">
        <Card>
          <GraphLegend pipeline="B" />
        </Card>
      </Block>
      <Block
        id="evidence-states-legend-c"
        title="Graph key, configuration C, with what the ontology added"
      >
        <Card>
          <GraphLegend pipeline="C" ontologyAdded />
        </Card>
      </Block>
    </>
  )
}

const STATUSES = [
  ['normal', {}],
  ['loading', { status: 'loading' }],
  ['loading-empty', { status: 'loading', empty: true }],
  ['empty', { empty: true }],
  ['error', { status: 'error', error: 'The results could not be loaded.' }],
  ['disabled', { disabled: true }],
] as const

function Charts() {
  return (
    <>
      <Block
        sample
        id="chart-stat-tile"
        title="Stat tile: normal, interval and pairs"
      >
        <Card>
          <div className="flex gap-12">
            <StatTile
              label="Evidence found by C"
              value={68.5}
              unit="points"
              interval={[60, 77]}
              n={96}
              groups={24}
            />
            <StatTile
              label="Answers that were right"
              value={0.42}
              unit="share"
              decimals={2}
            />
            <StatTile
              label="Change from B"
              value={-3.5}
              unit="points"
              interval={[-9, 2]}
              n={36}
            />
            <StatTile
              label="Evidence found by A"
              value={null}
              unit="points"
              n={0}
            />
          </div>
        </Card>
      </Block>
      <Block
        sample
        id="chart-legend"
        title="Legend: three series, and with a row not tested"
      >
        <Card>
          <div className="flex flex-col gap-3">
            <Legend series={['A', 'B', 'C']} />
            <Legend series={['B', 'C']} notTested />
          </div>
        </Card>
      </Block>
      <Block sample id="chart-data-table" title="Data table">
        <Card>
          <DataTable
            caption="Evidence by question type"
            rowHeader="Question type"
            columns={['A · Text search', 'B · Graph', 'C · Graph + Ontology']}
            rows={BAR_GROUPS.map((g) => ({
              key: g.key,
              label: g.label,
              cells: (['A', 'B', 'C'] as const).map((id) =>
                String(g.values[id]),
              ),
            }))}
          />
        </Card>
      </Block>
      {STATUSES.map(([name, state]) => (
        <Block
          sample
          key={`bars-${name}`}
          id={`chart-grouped-bars-${name}`}
          title={`Grouped bars: ${name}`}
        >
          <Card>
            <GroupedBars
              title="Evidence found by question type"
              description="Mean evidence points, with the interval on each bar"
              unit="evidence points"
              domain={[0, 100]}
              groups={'empty' in state ? [] : BAR_GROUPS}
              intervals={BAR_INTERVALS}
              delta={BAR_DELTA}
              {...state}
            />
          </Card>
        </Block>
      ))}
      <Block
        sample
        id="chart-grouped-bars-table"
        title="Grouped bars: table twin"
      >
        <Card>
          <GroupedBars
            title="Evidence found by question type"
            unit="evidence points"
            domain={[0, 100]}
            groups={BAR_GROUPS}
            intervals={BAR_INTERVALS}
            delta={BAR_DELTA}
          />
        </Card>
      </Block>
      <Block
        sample
        id="chart-grouped-bars-nulls"
        title="Grouped bars: nulls are gaps"
      >
        <Card>
          <GroupedBars
            title="Evidence found by question type"
            unit="evidence points"
            domain={[0, 100]}
            groups={BAR_GROUPS_WITH_GAPS}
          />
        </Card>
      </Block>
      <Block
        sample
        id="chart-grouped-bars-negative"
        title="Grouped bars: negative values"
      >
        <Card>
          <GroupedBars
            title="Change in evidence found"
            unit="evidence points"
            domain={[-20, 20]}
            groups={BAR_GROUPS_NEGATIVE}
          />
        </Card>
      </Block>
      <Block
        sample
        id="chart-grouped-bars-tooltip"
        title="Grouped bars: tooltip on hover"
      >
        <Card>
          <GroupedBars
            title="Evidence found by question type"
            unit="evidence points"
            domain={[0, 100]}
            groups={BAR_GROUPS}
            intervals={BAR_INTERVALS}
          />
        </Card>
      </Block>
      {STATUSES.map(([name, state]) => (
        <Block
          sample
          key={`interval-${name}`}
          id={`chart-interval-plot-${name}`}
          title={`Interval plot: ${name}`}
        >
          <Card>
            <IntervalPlot
              title="What each layer adds"
              description="Mean difference in evidence points, with its interval"
              unit="evidence points (second minus first)"
              zero
              rows={'empty' in state ? [] : INTERVAL_ROWS}
              {...state}
            />
          </Card>
        </Block>
      ))}
      <Block
        sample
        id="chart-interval-plot-table"
        title="Interval plot: table twin"
      >
        <Card>
          <IntervalPlot
            title="What each layer adds"
            unit="evidence points (second minus first)"
            zero
            rows={INTERVAL_ROWS}
          />
        </Card>
      </Block>
      <Block
        sample
        id="chart-interval-plot-nulls"
        title="Interval plot: nulls are gaps"
      >
        <Card>
          <IntervalPlot
            title="What each layer adds"
            unit="evidence points (second minus first)"
            zero
            rows={INTERVAL_ROWS_WITH_GAPS}
          />
        </Card>
      </Block>
      <Block
        sample
        id="chart-interval-plot-negative"
        title="Interval plot: negative values"
      >
        <Card>
          <IntervalPlot
            title="What each layer adds"
            unit="evidence points (second minus first)"
            zero
            rows={INTERVAL_ROWS_NEGATIVE}
          />
        </Card>
      </Block>
      <Block
        sample
        id="chart-interval-plot-tooltip"
        title="Interval plot: tooltip on hover"
      >
        <Card>
          <IntervalPlot
            title="What each layer adds"
            unit="evidence points (second minus first)"
            zero
            rows={INTERVAL_ROWS}
          />
        </Card>
      </Block>
    </>
  )
}

const RETRYABLE = new ApiError(
  'RUN_ERROR',
  'The server took too long to answer.',
  true,
  503,
)
const PANEL_STATES: readonly [PanelState, string][] = [
  ['ready', 'Ready'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Error, with retry'],
  ['disabled', 'Disabled'],
]

function Panels() {
  return (
    <>
      {PANEL_STATES.map(([state, name]) => (
        <Block
          key={state}
          id={`panel-${state}`}
          title={`Panel: ${name}`}
          width="w-[40rem]"
        >
          <Panel
            state={state}
            title="Worlds in this dataset"
            purpose="One sentence on what the panel is for."
            message={
              state === 'empty'
                ? 'No run has been recorded for this question yet.'
                : 'Switch the dataset on to see this panel.'
            }
            error={state === 'error' ? RETRYABLE : undefined}
            onRetry={() => undefined}
          >
            <dl className="space-y-2 text-sm">
              <div className="grid grid-cols-[10rem_1fr] gap-x-4">
                <dt className="text-text-muted">World number</dt>
                <dd className="tabular text-text-primary">2026</dd>
              </div>
              <div className="grid grid-cols-[10rem_1fr] gap-x-4">
                <dt className="text-text-muted">Scenario number</dt>
                <dd className="tabular text-text-primary">7</dd>
              </div>
            </dl>
          </Panel>
        </Block>
      ))}
      <Block
        id="panel-loading-skeleton"
        title="Panel: loading with its own skeleton"
        width="w-[40rem]"
      >
        <Panel
          state="loading"
          title="Evidence paths"
          skeleton={
            <div className="space-y-2">
              <SkeletonBar className="w-1/3" />
              <SkeletonBar className="w-full" />
              <SkeletonBar className="w-1/2" />
              <SkeletonBar className="w-5/6" />
            </div>
          }
        />
      </Block>
      <Block
        id="panel-error-plain"
        title="Panel: error that cannot be retried"
        width="w-[40rem]"
      >
        <Panel
          state="error"
          title="Record"
          error={
            new ApiError(
              'NOT_FOUND',
              'That record is not in this dataset.',
              false,
              404,
            )
          }
          onRetry={() => undefined}
        />
      </Block>
    </>
  )
}

/** Each box is the graph page of the harness, with its own parameters. */
const GRAPHS = [
  ['b-12', 'Configuration B, 12 nodes', 'config=B&cap=12'],
  ['b-full', 'Configuration B, full', 'config=B'],
  ['c-12', 'Configuration C, 12 nodes', 'config=C&cap=12'],
  ['c-full', 'Configuration C, full, ontology additions marked', 'config=C'],
  ['c-200', 'Configuration C, the 200-node fixture', 'source=200'],
  ['c-focus', 'Configuration C, focus mode', 'config=C&focus=1'],
  [
    'c-presentation',
    'Configuration C, presentation mode',
    'config=C&present=1',
  ],
  [
    'c-replay',
    'Configuration C, replay part way through the run',
    'config=C&count=405',
  ],
] as const

function Graphs() {
  return (
    <>
      {GRAPHS.map(([id, title, query]) => (
        <Block
          key={id}
          id={`graph-${id}`}
          title={`Graph canvas: ${title}`}
          width="w-[112rem]"
        >
          <GraphHarness query={query} />
        </Block>
      ))}
    </>
  )
}

/** Shows the text a screen reader is given, which the summary itself hides. */
function SummaryText({ view }: { view: ReturnType<typeof fixtureView> }) {
  const host = useRef<HTMLDivElement>(null)
  const id = useId()
  const [text, setText] = useState('')
  useEffect(() => {
    setText(host.current?.innerText ?? '')
  }, [view])
  return (
    <>
      <div ref={host}>
        <GraphSummary id={id} view={view} />
      </div>
      <pre className="whitespace-pre-wrap font-sans text-sm text-text-primary">
        {text}
      </pre>
    </>
  )
}

function Paths() {
  return (
    <>
      {(['B', 'C'] as const).map((config) => {
        const view = fixtureView({ source: 'abc', config })
        return (
          <div key={config} className="contents">
            <Block
              id={`paths-${config.toLowerCase()}`}
              title={`Evidence path list, configuration ${config}`}
              width="w-[40rem]"
            >
              <Card>
                <EvidencePathList view={view} />
              </Card>
            </Block>
            <Block
              id={`summary-${config.toLowerCase()}`}
              title={`Canvas summary for screen readers, configuration ${config}`}
              width="w-[56rem]"
            >
              <Card>
                <SummaryText view={view} />
              </Card>
            </Block>
          </div>
        )
      })}
      <Block
        id="paths-c-presentation"
        title="Evidence path list, configuration C, presentation mode"
        width="w-[56rem]"
      >
        <div className="presentation">
          <Card>
            <EvidencePathList
              view={fixtureView({ source: 'abc', config: 'C' })}
            />
          </Card>
        </div>
      </Block>
      <Block
        id="summary-c-presentation"
        title="Canvas summary for screen readers, configuration C, presentation mode"
        width="w-[72rem]"
      >
        <div className="presentation">
          <Card>
            <SummaryText view={fixtureView({ source: 'abc', config: 'C' })} />
          </Card>
        </div>
      </Block>
      <Block
        id="paths-pending"
        title="Evidence path list: before the path event"
        width="w-[40rem]"
      >
        <Card>
          <EvidencePathList
            view={fixtureView({ source: 'abc', config: 'C', upTo: 5 })}
          />
        </Card>
      </Block>
      <Block
        id="paths-absent"
        title="Evidence path list: ended without a path"
        width="w-[40rem]"
      >
        <Card>
          <EvidencePathList
            view={fixtureView({ source: 'abc', config: 'C', upTo: 5 })}
            ended
          />
        </Card>
      </Block>
    </>
  )
}

/** Each button opens a drawer; the evidence node ids pick the answer the page's API mock gives. */
const EVIDENCE_OPENERS = [
  ['ready', 'node-ready'],
  ['loading', 'node-loading'],
  ['error', 'node-error'],
  ['without a source record', 'node-orphan'],
] as const

function Drawers() {
  const { setSettingsOpen } = useSettings()
  const [generic, setGeneric] = useState(false)
  const [evidence, setEvidence] = useState<string | null>(null)
  return (
    <Block id="drawers" title="Drawers: open each from its button">
      <Card>
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            className="rounded-chip border border-border px-3 py-1"
            onClick={() => setSettingsOpen(true)}
          >
            Open Settings
          </button>
          <button
            type="button"
            className="rounded-chip border border-border px-3 py-1"
            onClick={() => setGeneric(true)}
          >
            Open a plain drawer
          </button>
          {EVIDENCE_OPENERS.map(([name, nodeId]) => (
            <button
              key={nodeId}
              type="button"
              className="rounded-chip border border-border px-3 py-1"
              onClick={() => setEvidence(nodeId)}
            >
              Open evidence, {name}
            </button>
          ))}
        </div>
      </Card>
      <SettingsDrawer />
      <Drawer
        open={generic}
        title="A plain drawer"
        onClose={() => setGeneric(false)}
      >
        <Panel
          state="ready"
          title="Contents"
          purpose="Anything a drawer holds."
        >
          <p className="text-sm text-text-primary">Drawer text.</p>
        </Panel>
      </Drawer>
      <EvidenceDrawer
        source={evidence ? { kind: 'node', nodeId: evidence } : null}
        onClose={() => setEvidence(null)}
      />
    </Block>
  )
}

const SECTIONS = [
  ['tokens', 'Tokens', Tokens],
  ['evidence-states', 'Evidence states', EvidenceStates],
  ['charts', 'Charts', Charts],
  ['panel', 'Panel', Panels],
  ['graph', 'Graph canvas', Graphs],
  ['paths', 'Evidence paths and summary', Paths],
  ['drawers', 'Drawers', Drawers],
] as const

export default function Gallery() {
  const only = new URLSearchParams(
    window.location.hash.split('?')[1] ?? '',
  ).get('section')
  const shown = SECTIONS.filter(([id]) => only === null || id === only)
  return (
    <main className="min-h-screen bg-background p-6">
      <h1 className="text-xl font-semibold">Foundation gallery</h1>
      <nav aria-label="Sections" className="my-3 flex gap-4 text-sm">
        {SECTIONS.map(([id, name]) => (
          <a key={id} href={`#/__gallery?section=${id}`} className="underline">
            {name}
          </a>
        ))}
        <a href="#/__gallery" className="underline">
          All
        </a>
        <a href="#/__graph" className="underline">
          Graph harness
        </a>
      </nav>
      {shown.map(([id, name, Section]) => (
        <section
          key={id}
          data-gallery-section={id}
          aria-label={name}
          className="mb-8 flex flex-col gap-4"
        >
          <h2 className="text-lg font-semibold">{name}</h2>
          <Section />
        </section>
      ))}
    </main>
  )
}
