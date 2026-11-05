/**
 * The tech stack as one picture (D-109): the data platform at the bottom,
 * the graph and the ontology built from it and sitting on top, the backend
 * and the web app above, and scoring kept apart. Counts are the live ones;
 * the versions are those docker-compose.yml, package.json and
 * backend/pyproject.toml pin.
 */

import type { ReactNode } from 'react'

import type { StackCounts } from './counts'

const n = (value: number) => value.toLocaleString('en-GB')

const GREY = 'var(--color-grey-600)'
const BLUE = 'var(--color-pipeline-a)'

/** One line of text at (x, y); `tone` picks a class of the diagram's type scale. */
function T({
  x,
  y,
  tone = 'note',
  fill,
  anchor,
  children,
}: {
  x: number
  y: number
  tone?: 'band' | 'sub' | 'title' | 'tech' | 'note' | 'small' | 'arrow' | 'pill'
  fill?: string
  anchor?: 'middle'
  children: ReactNode
}) {
  // In the drawing's own units, as the charts size theirs, so the text
  // scales with the picture (and with presentation mode's wider screen).
  const [size, weight] = (
    {
      band: [15, 700],
      sub: [12, 400],
      title: [15, 700],
      tech: [13, 600],
      note: [12.5, 400],
      small: [12, 400],
      arrow: [12, 600],
      pill: [13, 700],
    } as const
  )[tone]
  const colour =
    fill ??
    (tone === 'sub' || tone === 'small'
      ? 'var(--color-text-muted)'
      : tone === 'note'
        ? 'var(--color-text-secondary)'
        : 'var(--color-text-primary)')
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={weight}
      fill={colour}
      textAnchor={anchor}
    >
      {children}
    </text>
  )
}

function Box({
  x,
  y,
  w,
  h,
  stroke,
  fill = 'var(--color-surface)',
  width = 1.5,
}: {
  x: number
  y: number
  w: number
  h: number
  stroke: string
  fill?: string
  width?: number
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={8}
      fill={fill}
      stroke={stroke}
      strokeWidth={width}
    />
  )
}

/** A built-ahead arrow (solid grey) or a question-time arrow (dashed blue). */
function Arrow({
  from,
  to,
  live = false,
}: {
  from: [number, number]
  to: [number, number]
  live?: boolean
}) {
  return (
    <line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      stroke={live ? BLUE : GREY}
      strokeWidth={2}
      strokeDasharray={live ? '6 4' : undefined}
      markerEnd={`url(#${live ? 'stack-live' : 'stack-built'})`}
    />
  )
}

function Pill({
  x,
  w,
  tint,
  stroke,
  text,
  label,
}: {
  x: number
  w: number
  tint: string
  stroke: string
  text: string
  label: string
}) {
  return (
    <>
      <rect
        x={x}
        y={185}
        width={w}
        height={34}
        rx={17}
        fill={tint}
        stroke={stroke}
      />
      <T x={x + w / 2} y={207} tone="pill" fill={text} anchor="middle">
        {label}
      </T>
    </>
  )
}

function Band({ y, h, fill }: { y: number; h: number; fill: string }) {
  return <rect x={10} y={y} width={1100} height={h} rx={10} fill={fill} />
}

export function StackDiagram({ counts }: { counts: StackCounts }) {
  return (
    <svg
      viewBox="0 0 1400 830"
      className="h-auto w-full"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {(
          [
            ['stack-built', GREY],
            ['stack-live', BLUE],
          ] as const
        ).map(([id, colour]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={colour} />
          </marker>
        ))}
      </defs>

      <Band y={20} h={90} fill="var(--color-grey-100)" />
      <Band y={125} h={160} fill="var(--color-pipeline-a-tint)" />
      <Band y={300} h={115} fill="var(--color-pipeline-c-tint)" />
      <Band y={430} h={130} fill="var(--color-pipeline-b-tint)" />
      <Band y={575} h={200} fill="var(--color-grey-200)" />

      <T x={28} y={58} tone="band">
        Screens
      </T>
      <T x={28} y={160} tone="band">
        Backend and AI
      </T>
      <T x={28} y={335} tone="band" fill="var(--color-pipeline-c-strong)">
        Ontology layer
      </T>
      <T x={28} y={353} tone="sub">
        added for C
      </T>
      <T x={28} y={465} tone="band" fill="var(--color-pipeline-b-strong)">
        Graph layer
      </T>
      <T x={28} y={483} tone="sub">
        added for B and C
      </T>
      <T x={28} y={610} tone="band">
        Data platform
      </T>
      <T x={28} y={628} tone="sub">
        left unchanged
      </T>
      <T x={28} y={646} tone="sub">
        (made-up company,
      </T>
      <T x={28} y={662} tone="sub">
        four countries)
      </T>

      {/* Screens */}
      <Box x={200} y={35} w={890} h={60} stroke="var(--color-grey-400)" />
      <T x={220} y={61} tone="title">
        Web app
      </T>
      <T x={220} y={82} tone="tech">
        React 19 · TypeScript · Vite · Tailwind
      </T>
      <T x={620} y={61}>
        Graph pictures drawn with React Flow and ELK
      </T>
      <T x={620} y={82}>
        Each run streams its steps live as they happen
      </T>
      <Arrow from={[645, 95]} to={[645, 143]} live />
      <T x={655} y={124} tone="arrow" fill={BLUE}>
        REST API + live events
      </T>

      {/* Backend */}
      <Box x={200} y={145} w={890} h={125} stroke={BLUE} />
      <T x={220} y={171} tone="title">
        Backend
      </T>
      <T x={300} y={171} tone="tech">
        Python 3.13 · FastAPI
      </T>
      <Pill
        x={220}
        w={190}
        tint="var(--color-pipeline-a-tint)"
        stroke={BLUE}
        text="var(--color-pipeline-a-strong)"
        label="A · Text search"
      />
      <Pill
        x={422}
        w={150}
        tint="var(--color-pipeline-b-tint)"
        stroke="var(--color-pipeline-b)"
        text="var(--color-pipeline-b-strong)"
        label="B · Graph"
      />
      <Pill
        x={584}
        w={230}
        tint="var(--color-pipeline-c-tint)"
        stroke="var(--color-pipeline-c)"
        text="var(--color-pipeline-c-strong)"
        label="C · Graph + Ontology"
      />
      <T x={830} y={200} tone="small">
        same question, same AI model,
      </T>
      <T x={830} y={216} tone="small">
        same amount of evidence
      </T>
      <T x={220} y={250}>
        Shared parts:
      </T>
      <T x={305} y={250} tone="tech">
        {`re-ordering model BAAI bge v2 m3 · LiteLLM model gateway → Ollama, answers by ${counts.answerModel}`}
      </T>
      <Arrow from={[560, 270]} to={[560, 313]} live />
      <T x={570} y={296} tone="arrow" fill={BLUE}>
        B and C follow links
      </T>
      <Arrow from={[1000, 270]} to={[1000, 623]} live />
      <rect
        x={928}
        y={340}
        width={144}
        height={40}
        rx={6}
        fill="var(--color-surface)"
        opacity={0.92}
      />
      <T x={1000} y={356} tone="arrow" fill={BLUE} anchor="middle">
        all three search
      </T>
      <T x={1000} y={372} tone="arrow" fill={BLUE} anchor="middle">
        the text
      </T>

      {/* Ontology source */}
      <Box x={200} y={322} w={225} h={72} stroke="var(--color-pipeline-c)" />
      <T x={216} y={347} tone="title">
        Business terms file
      </T>
      <T x={216} y={367} tone="tech">
        {`YAML, versioned (${counts.ontologyVersion})`}
      </T>
      <T x={216} y={385} tone="small">
        written by hand, in 4 languages
      </T>
      <Arrow from={[425, 358]} to={[478, 358]} />
      <T x={430} y={350} tone="arrow" fill={GREY}>
        loads
      </T>

      {/* Load job */}
      <Box x={200} y={452} w={225} h={88} stroke="var(--color-pipeline-b)" />
      <T x={216} y={477} tone="title">
        Graph load job
      </T>
      <T x={216} y={497} tone="tech">
        Python
      </T>
      <T x={216} y={516} tone="small">
        rebuilds the graph from the
      </T>
      <T x={216} y={531} tone="small">
        tables; checks every count
      </T>
      <Arrow from={[425, 496]} to={[478, 496]} />
      <T x={430} y={488} tone="arrow" fill={GREY}>
        builds
      </T>

      {/* Neo4j */}
      <Box
        x={480}
        y={315}
        w={420}
        h={232}
        stroke="var(--color-text-primary)"
        width={2}
      />
      <T x={690} y={420} tone="tech" anchor="middle">
        Neo4j 5.26 graph database
      </T>
      <Box
        x={496}
        y={328}
        w={388}
        h={72}
        stroke="var(--color-pipeline-c)"
        fill="var(--color-pipeline-c-tint)"
        width={1}
      />
      <T x={512} y={352} tone="title" fill="var(--color-pipeline-c-strong)">
        {`${n(counts.concepts)} business concepts`}
      </T>
      <T x={512} y={372}>
        e.g. &quot;Rubbellos&quot; (Austria) and &quot;Scratchcard&quot; (UK)
      </T>
      <T x={512} y={389}>
        both map to one concept: a retail instant game
      </T>
      <line
        x1={690}
        y1={400}
        x2={690}
        y2={408}
        stroke="var(--color-pipeline-c)"
        strokeWidth={2}
      />
      <line
        x1={690}
        y1={428}
        x2={690}
        y2={436}
        stroke="var(--color-pipeline-c)"
        strokeWidth={2}
      />
      <Box
        x={496}
        y={436}
        w={388}
        h={100}
        stroke="var(--color-pipeline-b)"
        fill="var(--color-pipeline-b-tint)"
        width={1}
      />
      <T x={512} y={460} tone="title" fill="var(--color-pipeline-b-strong)">
        {`${n(counts.graphRecords)} records · ${n(counts.graphLinks)} links`}
      </T>
      <T x={512} y={480}>
        {`${counts.graphKinds} kinds: players, games, incidents, platform versions…`}
      </T>
      <T x={512} y={498}>
        Each record keeps its source table and row id;
      </T>
      <T x={512} y={515}>
        answers quote the warehouse row, not the graph
      </T>
      <Arrow from={[560, 547]} to={[560, 623]} live />
      <T x={570} y={595} tone="arrow" fill={BLUE}>
        {"reads each fact's row"}
      </T>
      <Arrow from={[312, 625]} to={[312, 544]} />
      <T x={322} y={596} tone="arrow" fill={GREY}>
        reads only, writes nothing
      </T>

      {/* Warehouse */}
      <Box x={200} y={625} w={625} h={135} stroke="var(--color-grey-700)" />
      <T x={216} y={651} tone="title">
        Warehouse
      </T>
      <T x={216} y={672} tone="tech">
        {`${n(counts.tables)} tables · Parquet files · queried with DuckDB`}
      </T>
      <T x={216} y={696}>
        Players, tickets, games, draws, campaigns, incidents, support cases…
      </T>
      <T x={216} y={716}>
        The source of every number, amount and date in an answer
      </T>
      <T x={216} y={744} tone="small">
        Made by a Python generator: the same settings always give the same world
      </T>

      {/* Text index */}
      <Box x={845} y={625} w={245} h={135} stroke="var(--color-grey-700)" />
      <T x={861} y={651} tone="title">
        Text index
      </T>
      <T x={861} y={672} tone="tech">
        Qdrant 1.14
      </T>
      <T x={861} y={694}>
        {`${n(counts.documents)} documents and the`}
      </T>
      <T x={861} y={710}>
        {counts.passages === null
          ? 'table rows, not indexed yet'
          : `table rows, as ${n(counts.passages)} passages`}
      </T>
      <T x={861} y={732} tone="small">
        bge-m3 meaning search
      </T>
      <T x={861} y={748} tone="small">
        + BM25 keyword search
      </T>

      {/* Scoring */}
      <rect
        x={1130}
        y={125}
        width={260}
        height={650}
        rx={10}
        fill="var(--color-background)"
        stroke="var(--color-grey-300)"
        strokeDasharray="5 4"
      />
      <T x={1148} y={157} tone="band">
        Scoring, kept apart
      </T>
      <T x={1148} y={176} tone="sub">
        no approach can see it
      </T>
      <Box x={1148} y={196} w={224} h={78} stroke="var(--color-grey-400)" />
      <T x={1162} y={220} tone="title">
        Answer key
      </T>
      <T x={1162} y={240}>
        what each question needs,
      </T>
      <T x={1162} y={256}>
        read only by the scorer
      </T>
      <Box x={1148} y={288} w={224} h={98} stroke="var(--color-grey-400)" />
      <T x={1162} y={312} tone="title">
        Two AI judges
      </T>
      <T x={1162} y={332} tone="tech">
        gemma4 31B
      </T>
      <T x={1162} y={350} tone="tech">
        Muse Glimmer
      </T>
      <T x={1162} y={372} tone="small">
        on Ollama, via LiteLLM
      </T>
      <Box x={1148} y={400} w={224} h={78} stroke="var(--color-grey-400)" />
      <T x={1162} y={424} tone="title">
        Run store
      </T>
      <T x={1162} y={444} tone="tech">
        SQLite + JSON files
      </T>
      <T x={1162} y={462} tone="small">
        every step of every run, replayable
      </T>
      <Arrow from={[1090, 208]} to={[1145, 230]} />
      <T x={1094} y={196} tone="small">
        answers
      </T>

      {/* Legend */}
      <Arrow from={[200, 805]} to={[240, 805]} />
      <T x={250} y={809} tone="small">
        built ahead of time
      </T>
      <Arrow from={[400, 805]} to={[440, 805]} live />
      <T x={450} y={809} tone="small">
        when a question is asked
      </T>
      <T x={640} y={809} tone="small">
        Neo4j and Qdrant run in Docker; Ollama, the backend and the web app run
        on one Mac
      </T>
    </svg>
  )
}
