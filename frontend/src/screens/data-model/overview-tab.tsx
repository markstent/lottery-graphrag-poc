/**
 * The Overview tab, where every reader lands (D-115): the three layers the
 * approaches search, each with its live size and the same example record seen
 * at that layer; the example followed through the layers; short notes on how
 * each layer is built; the core of the graph; and a line to the stories. Each
 * part loads on its own, so one failure shows its own error and retry.
 */

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import {
  getDictionary,
  getGraphSchema,
  getGraphStats,
  getOntology,
  getScenarios,
  listDatasets,
  type Schemas,
} from '../../api/client'
import { marketsInWords, plainName } from '../../app/plain-words'
import { hrefFor } from '../../app/router'
import { useLoad, type Load } from '../../app/use-load'
import { plural } from '../../charts/scale'
import { ErrorNote } from '../../components/error-note'
import { Panel, SkeletonBar } from '../../components/panel'
import { relationshipPhrase } from '../../design/relationships'
import { LAYER_NOTES } from './about-copy'
import { loadExample, type ExampleLink, type LayeredExample } from './example'
import { NEXT_STEP } from './explorer'
import { CoreMap } from './core-map'
import { count, groupBySystem, LANGUAGES, listed } from './model'

type Concept = Schemas['ConceptOut']

/**
 * The link the graph card shows: the example is chosen for its platform
 * version, which an incident in another market shares.
 */
const FEATURED_LINK = 'RELATED_TO_VERSION'

const kindCount = (n: number) => `${count(n)} ${n === 1 ? 'kind' : 'kinds'}`
const kinds = (n: number, of: string) => `${kindCount(n)} of ${of}`

const tab = (id: string) => hrefFor('data-model', { tab: id })

async function loadTables(signal: AbortSignal) {
  const worlds = await listDatasets(signal)
  const world = worlds.find((w) => w.active) ?? worlds[0]
  if (!world) return null
  return { world, dictionary: await getDictionary(world.dataset_id, signal) }
}

const loadGraph = (signal: AbortSignal) =>
  Promise.all([getGraphSchema(signal), getGraphStats(signal)])

/** An id as the data writes it. */
const Id = ({ children }: { children: string }) => (
  <span className="font-mono font-semibold break-all text-text-primary">
    {children}
  </span>
)

function LayerCard<T>({
  step,
  layer,
  title,
  load,
  size,
  explore,
  href,
  example,
}: {
  step: number
  layer: string
  title: string
  load: Load<T>
  size: (data: T) => string
  explore: string
  href: string
  example: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      aria-busy={load.status === 'loading' ? true : undefined}
      className="flex min-w-0 flex-col rounded-card border border-hairline bg-surface p-5"
    >
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-raised text-sm text-text-primary tabular-nums">
          {step}
        </span>
        {layer}
      </p>
      <h2 id={id} className="mt-3 text-lg font-semibold text-text-primary">
        {title}
      </h2>
      <div className="mt-1 min-h-5 text-sm text-text-secondary tabular-nums">
        {load.status === 'loading' && (
          <div role="status">
            <span className="sr-only">Loading {title}</span>
            <SkeletonBar className="w-2/3" />
          </div>
        )}
        {load.status === 'error' && (
          <ErrorNote error={load.error} retry={load.retry} />
        )}
        {load.status === 'ready' && <p>{size(load.data)}</p>}
      </div>
      <div className="mt-4 flex-1">{example}</div>
      <a href={href} className={`${NEXT_STEP} mt-5 self-start`}>
        {explore}
        <ArrowRight aria-hidden size={16} />
      </a>
    </section>
  )
}

/** The example as one card shows it; nothing while there is none. */
function CardExample({
  load,
  children,
}: {
  load: Load<LayeredExample | null>
  children: (example: LayeredExample) => ReactNode
}) {
  if (load.status === 'loading')
    return (
      <div className="space-y-2 rounded-chip bg-background p-3">
        <SkeletonBar className="w-1/2" />
        <SkeletonBar />
      </div>
    )
  if (load.status !== 'ready' || load.data === null) return null
  return (
    <div className="space-y-1.5 rounded-chip bg-background p-3 text-sm text-text-secondary">
      {children(load.data)}
    </div>
  )
}

const totalLinks = (links: ExampleLink[]) =>
  links.reduce((sum, link) => sum + link.count, 0)

const featured = (links: ExampleLink[]) =>
  links.find((l) => l.type === FEATURED_LINK && l.sample) ??
  links.find((l) => l.direction === 'out' && l.sample)

/** "MKT_UK, MKT_AT and MKT_CZ": the other markets with codes for the concept. */
function otherMarkets(concept: Concept | undefined, market: unknown) {
  const codes = Object.keys(concept?.binding_counts ?? {}).filter(
    (code) => code !== 'shared' && code !== market,
  )
  return codes.length === 0 ? null : listed(codes)
}

/** One link of the example in words: "is related to version PLV_3", "SUP_9 is related to it". */
function LinkLine({ link }: { link: ExampleLink }) {
  const phrase = relationshipPhrase(link.type)
  const more = link.count > 1 ? `, and ${count(link.count - 1)} more` : ''
  const Arrow = link.direction === 'out' ? ArrowRight : ArrowLeft
  return (
    <li className="flex items-start gap-2">
      <Arrow aria-hidden size={14} className="mt-1 shrink-0 text-text-muted" />
      <span className="min-w-0">
        {link.sample === undefined ? (
          `${phrase}${link.direction === 'in' ? ' it' : ''}: ${plural(link.count, 'record')}`
        ) : link.direction === 'out' ? (
          <>
            {`${phrase} `}
            <Id>{link.sample}</Id>
            {more}
          </>
        ) : (
          <>
            <Id>{link.sample}</Id>
            {` ${phrase} it${more}`}
          </>
        )}
      </span>
    </li>
  )
}

function Step({
  step,
  heading,
  caption,
  children,
}: {
  step: number
  heading: string
  /** Under the box; null leaves the row empty, so the three boxes stay aligned. */
  caption: string | null
  children: ReactNode
}) {
  return (
    <li className="flex min-w-0 flex-col lg:row-span-3 lg:row-start-1 lg:grid lg:grid-rows-subgrid">
      <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">
        {`${step} · ${heading}`}
      </h3>
      <div className="mt-2 flex-1 rounded-card border lg:mt-0 border-border bg-surface p-4 text-sm text-text-secondary">
        {children}
      </div>
      <p className="mt-2 text-sm text-text-secondary lg:mt-0">{caption}</p>
    </li>
  )
}

const StepArrow = () => (
  <li
    aria-hidden
    className="flex items-center justify-center text-text-muted lg:row-span-3 lg:row-start-1"
  >
    <ArrowRight size={20} className="rotate-90 lg:rotate-0" />
  </li>
)

/** The example's table row, its graph links and its concept, side by side. */
function Flow({
  example,
  concept,
}: {
  example: LayeredExample
  concept: Concept | undefined
}) {
  const reached = new Set(
    example.links.filter((l) => l.direction === 'out').map((l) => l.sample),
  )
  const columns = Object.entries(example.row).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && reached.has(entry[1]),
  )
  const links = [
    ...example.links.filter((l) => l.direction === 'out'),
    ...example.links.filter((l) => l.direction === 'in'),
  ]
  const code = example.row.incident_type
  return (
    <ol className="grid gap-3 lg:grid-rows-[auto_1fr_auto] lg:gap-y-2 lg:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.3fr)_auto_minmax(0,0.9fr)]">
      <Step
        step={1}
        heading="Table row"
        caption="A row of the incidents table. Some of its columns name other records."
      >
        <p>
          <Id>{example.incidentId}</Id>
          {' · incidents'}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          {columns.map(([column, value]) => (
            <div key={column} className="contents">
              <dt>{plainName(column)}</dt>
              <dd>
                <Id>{value}</Id>
              </dd>
            </div>
          ))}
        </dl>
      </Step>
      <StepArrow />
      <Step
        step={2}
        heading="Graph record"
        caption="A program turns those columns into links. Rows of other tables that name it link in."
      >
        <p>
          <Id>{example.incidentId}</Id>
          {` · ${plural(totalLinks(example.links), 'link')}`}
        </p>
        <ul className="mt-3 space-y-1.5">
          {links.map((link) => (
            <LinkLine key={`${link.type}:${link.direction}`} link={link} />
          ))}
        </ul>
      </Step>
      <StepArrow />
      <Step
        step={3}
        heading="Shared concept"
        caption={
          example.concept === null
            ? null
            : typeof code === 'string'
              ? `Its type, ${code}, is matched to this concept, and so are the other countries' codes for it.`
              : 'Its type is matched to this concept.'
        }
      >
        {example.concept === null ? (
          <p>Its type is matched to no concept.</p>
        ) : (
          <>
            <p className="text-base font-semibold text-text-primary">
              {example.concept.name}
            </p>
            <p className="mt-1">
              <Id>{example.concept.id}</Id>
            </p>
            {concept && (
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                {LANGUAGES.filter(
                  (l) => l.id !== 'en' && concept.labels[l.id],
                ).map((language) => (
                  <div key={language.id} className="contents">
                    <dt>{language.name}</dt>
                    <dd lang={language.id} className="text-text-primary">
                      {concept.labels[language.id]}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </Step>
    </ol>
  )
}

function CoreOfGraph({
  load,
  scale,
}: {
  load: Load<[Schemas['GraphSchema'], Schemas['GraphStats']]>
  scale: number
}) {
  const link = (
    <a href={tab('graph')} className={NEXT_STEP}>
      See every kind of record
      <ArrowRight aria-hidden size={16} />
    </a>
  )
  if (load.status !== 'ready')
    return (
      <Panel
        title="The core of the graph"
        state={load.status}
        error={load.status === 'error' ? load.error : undefined}
        action={{ label: 'Retry', onClick: load.retry }}
        headerAction={link}
      />
    )
  const [schema, stats] = load.data
  return (
    <Panel
      title="The core of the graph"
      purpose="The main kinds of record and the links between them. Point at a kind to see its links."
      state="ready"
      headerAction={link}
    >
      <CoreMap schema={schema} stats={stats} scale={scale} />
    </Panel>
  )
}

function LayerNotes() {
  const id = useId()
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold text-text-primary">
        How each layer is built
      </h2>
      <div className="grid gap-6 lg:grid-cols-3">
        {LAYER_NOTES.map((note) => (
          <div key={note.layer}>
            <h3 className="text-sm font-semibold text-text-primary">
              {note.layer}
            </h3>
            <p className="mt-1 text-sm text-text-secondary">{note.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function StoriesLine({ load }: { load: Load<Schemas['ScenarioOut'][]> }) {
  if (load.status === 'loading') return null
  if (load.status === 'error')
    return <ErrorNote error={load.error} retry={load.retry} />
  const planted = load.data.filter((s) => s.planted).length
  return (
    <p className="text-sm">
      <a
        href={tab('stories')}
        className="inline-flex items-center gap-1.5 text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
      >
        {planted === 1
          ? '1 story is planted in this data for the test.'
          : `${count(planted)} stories are planted in this data for the test.`}
        <ArrowRight aria-hidden size={16} />
      </a>
    </p>
  )
}

export function OverviewTab({ scale }: { scale: number }) {
  const example = useLoad(loadExample, 'overview-example')
  const tables = useLoad(loadTables, 'overview-tables')
  const graph = useLoad(loadGraph, 'overview-graph')
  const ontology = useLoad(getOntology, 'overview-ontology')
  const stories = useLoad(getScenarios, 'overview-stories')

  const conceptOf = (data: LayeredExample) =>
    ontology.status === 'ready'
      ? ontology.data.concepts.find((c) => c.concept_id === data.concept?.id)
      : undefined

  return (
    <div className="space-y-6">
      <p className="text-base text-text-secondary">
        The data the three approaches search, in three layers. Each is built
        from the one before.
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <LayerCard
          step={1}
          layer="Tables"
          title="The company's data"
          load={tables}
          size={(data) =>
            data === null
              ? 'No data has been generated yet.'
              : [
                  plural(groupBySystem(data.dictionary).length, 'system'),
                  plural(data.dictionary.length, 'table'),
                  plural(
                    Object.values(data.world.row_counts).reduce(
                      (sum, n) => sum + n,
                      0,
                    ),
                    'row',
                  ),
                ].join(' · ')
          }
          explore="Explore tables"
          href={tab('tables')}
          example={
            <CardExample load={example}>
              {(data) => (
                <>
                  <p>
                    <Id>{data.incidentId}</Id>
                    {', a row of the incidents table'}
                  </p>
                  {typeof data.row.summary === 'string' && (
                    <p className="line-clamp-2">{data.row.summary}</p>
                  )}
                </>
              )}
            </CardExample>
          }
        />
        <LayerCard
          step={2}
          layer="Graph"
          title="The links between records"
          load={graph}
          size={([schema]) =>
            `${kinds(schema.labels.length, 'record')} · ${kinds(
              new Set(schema.relationship_types.map((r) => r.type)).size,
              'link',
            )}`
          }
          explore="Explore the graph"
          href={tab('graph')}
          example={
            <CardExample load={example}>
              {(data) => {
                const link = featured(data.links)
                return (
                  <>
                    <p>
                      <Id>{data.incidentId}</Id>
                      {` has ${plural(totalLinks(data.links), 'link')} of ${kindCount(
                        new Set(data.links.map((l) => l.type)).size,
                      )}.`}
                    </p>
                    {link?.sample && (
                      <p>
                        {`It ${relationshipPhrase(link.type)} `}
                        <Id>{link.sample}</Id>
                        {link.type === FEATURED_LINK &&
                          ', which an incident in another market shares.'}
                      </p>
                    )}
                  </>
                )
              }}
            </CardExample>
          }
        />
        <LayerCard
          step={3}
          layer="Concepts"
          title="One dictionary for four countries"
          load={ontology}
          size={(data) =>
            `${plural(data.concepts.length, 'concept')} · ${plural(
              data.concepts.reduce(
                (sum, c) =>
                  sum +
                  Object.values(c.binding_counts).reduce((a, b) => a + b, 0),
                0,
              ),
              'country code',
            )}`
          }
          explore="Explore concepts"
          href={tab('concepts')}
          example={
            <CardExample load={example}>
              {(data) => {
                const others = otherMarkets(conceptOf(data), data.row.market_id)
                return data.concept === null ? (
                  <p>
                    <Id>{data.incidentId}</Id>
                    {"'s type is matched to no concept."}
                  </p>
                ) : (
                  <>
                    <p>
                      {'The type of '}
                      <Id>{data.incidentId}</Id>
                      {' is matched to '}
                      <span className="font-semibold text-text-primary">
                        {data.concept.name}
                      </span>
                      .
                    </p>
                    {others && (
                      <p>
                        {marketsInWords(
                          `So are the codes for it in ${others}.`,
                        )}
                      </p>
                    )}
                  </>
                )
              }}
            </CardExample>
          }
        />
      </div>
      <Panel
        title="How they fit together"
        purpose={
          example.status === 'ready' && example.data !== null
            ? 'One record followed through the three layers.'
            : undefined
        }
        state={
          example.status === 'ready'
            ? example.data === null
              ? 'empty'
              : 'ready'
            : example.status
        }
        message="No example record in this world."
        error={example.status === 'error' ? example.error : undefined}
        action={{ label: 'Retry', onClick: example.retry }}
      >
        {example.status === 'ready' && example.data !== null && (
          <Flow example={example.data} concept={conceptOf(example.data)} />
        )}
      </Panel>
      <LayerNotes />
      <CoreOfGraph load={graph} scale={scale} />
      <StoriesLine load={stories} />
    </div>
  )
}
