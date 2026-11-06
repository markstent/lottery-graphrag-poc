/**
 * The question bar: the saved questions and a box for your own, then a
 * secondary row with the market scope and where the run comes from. A saved
 * question carries its own market scope, which the API enforces, so the scope
 * is shown locked. A question you type can only run live.
 *
 * Once a run has been chosen (`collapsed`) the bar is one line: the question,
 * where it runs from, "Change question" to open the whole bar again, and the
 * run controls. Opening it moves focus to the first saved question. Running
 * from it closes it and keeps focus on Run; "Change question" or Escape closes
 * it and returns focus to "Change question".
 */

import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'

import type { Schemas } from '../../api/client'
import { useReadiness } from '../../app/use-readiness'
import type { Load } from '../../app/use-load'
import { RECORDED_INDEX } from '../../run/recorded'
import { liveUnavailableReason, PUBLIC_LIVE_OFF, type Source } from './source'
import type { RunRequest } from './use-live-run'

type Question = Schemas['DemoQuestion']

/** Market ids as the API takes them. */
const MARKETS = [
  { id: 'MKT_UK', name: 'United Kingdom' },
  { id: 'MKT_GR', name: 'Greece' },
  { id: 'MKT_AT', name: 'Austria' },
  { id: 'MKT_CZ', name: 'Czech Republic' },
] as const

const CONFIGURATIONS: ('A' | 'B' | 'C')[] = ['A', 'B', 'C']

const BUTTON =
  'rounded-chip border border-border px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50'
const PRESSED = 'bg-surface-raised font-semibold'

const hasRecording = (instanceId: string | null) =>
  RECORDED_INDEX.some((run) => run.instance_id === instanceId)

function Choice({
  pressed,
  disabled,
  describedBy,
  onClick,
  children,
}: {
  pressed: boolean
  disabled?: boolean
  /** The id of the line that says why the choice is greyed out. */
  describedBy?: string
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={onClick}
      className={`${BUTTON} ${pressed ? PRESSED : ''}`}
    >
      {children}
    </button>
  )
}

export function QuestionBar({
  questions,
  linkedId,
  collapsed,
  runStatus,
  busy,
  canCancel,
  cancelling,
  onRun,
  onCancel,
}: {
  questions: Load<Question[]>
  /** The question the link named, selected until another is chosen. */
  linkedId: string | null
  /** A run has been chosen: show the one-line form. */
  collapsed: boolean
  /** Where the run stands, shown in the bar once it is collapsed. */
  runStatus: string
  /** A run is starting or in progress. */
  busy: boolean
  canCancel: boolean
  cancelling: boolean
  onRun: (request: RunRequest) => void
  onCancel: () => void
}) {
  const { status, checks } = useReadiness()
  // The public read-only site (D-117): everything live is greyed out, said once under the box.
  const publicSite = status === 'public'
  const publicNote = useId()
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [chosenSource, setChosenSource] = useState<Source | null>(null)
  const [scope, setScope] = useState<string[]>([])
  const [opened, setOpened] = useState(false)
  // Text typed before readiness said this is the public site is cleared: it can never run.
  if (publicSite && (text !== '' || chosenSource === 'live')) {
    setText('')
    setChosenSource(null)
  }
  const saved = useRef<HTMLDivElement>(null)
  const runButton = useRef<HTMLButtonElement>(null)
  const toggleButton = useRef<HTMLButtonElement>(null)
  // Where focus goes once the opened bar is one line again.
  const refocus = useRef<RefObject<HTMLButtonElement | null> | null>(null)
  const full = !collapsed || opened
  useEffect(() => {
    if (opened) saved.current?.querySelector('button')?.focus()
  }, [opened])
  useEffect(() => {
    if (!full) refocus.current?.current?.focus()
    refocus.current = null
  }, [full])
  const close = (then: RefObject<HTMLButtonElement | null>) => {
    refocus.current = then
    setOpened(false)
  }

  const list = questions.status === 'ready' ? questions.data : []
  // Each saved question's easy-to-read wording, which runs as your own question would (D-108).
  const easy = list.flatMap((question) =>
    question.easy_text ? [question.easy_text] : [],
  )
  const adHoc = text.trim() !== ''
  // Nothing looks chosen until the link or the reader chooses a question.
  const selected = adHoc
    ? null
    : (list.find(
        (question) => question.instance_id === (chosenId ?? linkedId),
      ) ?? null)
  const recorded = hasRecording(selected?.instance_id ?? null)

  const liveOff = liveUnavailableReason(status, checks)
  // The public site replays only, so a linked question with no recording says so rather than asking for Live.
  const source: Source = publicSite
    ? 'recorded'
    : adHoc
      ? 'live'
      : (chosenSource ??
        // A linked question with no recording can only run live, so Live is shown even when it is off.
        (!hasRecording(linkedId) && (linkedId !== null || liveOff === null)
          ? 'live'
          : 'recorded'))
  const shownScope = selected ? selected.market_scope : scope

  const blocker =
    adHoc && liveOff !== null
      ? 'Your own question needs the live source.'
      : source === 'live' && liveOff !== null
        ? liveOff
        : selected === null && !adHoc
          ? 'Pick a question.'
          : source === 'recorded' && !recorded
            ? 'No recorded run for this question.'
            : null

  const run = () => {
    // Running from the full bar closes it again; Run is then in the one-line form.
    if (opened) close(runButton)
    if (source === 'recorded' && selected && recorded)
      return onRun({ source: 'recorded', instanceId: selected.instance_id })
    onRun({
      source: 'live',
      body: selected
        ? {
            benchmark_instance_id: selected.instance_id,
            configurations: CONFIGURATIONS,
            market_scope: selected.market_scope,
          }
        : {
            question: text.trim(),
            configurations: CONFIGURATIONS,
            market_scope: scope,
          },
    })
  }

  const controls = (
    <div className="ml-auto flex items-center gap-3">
      {blocker !== null && blocker !== liveOff && (
        <span className="text-sm text-text-muted">{blocker}</span>
      )}
      {canCancel && (
        <button
          type="button"
          disabled={cancelling}
          onClick={onCancel}
          className={BUTTON}
        >
          Cancel run
        </button>
      )}
      <button
        ref={runButton}
        type="button"
        disabled={busy || blocker !== null}
        aria-describedby={
          publicSite && full && blocker !== null && blocker === liveOff
            ? publicNote
            : undefined
        }
        onClick={run}
        className="rounded-chip bg-text-primary px-5 py-2 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        Run
      </button>
    </div>
  )

  // The disclosure button of the one-line form; the opened bar keeps it.
  const toggle = (
    <button
      ref={toggleButton}
      type="button"
      aria-expanded={opened}
      onClick={() => (opened ? close(toggleButton) : setOpened(true))}
      className={`${BUTTON} inline-flex items-center gap-1`}
    >
      Change question
      {opened ? (
        <ChevronUp aria-hidden size={16} />
      ) : (
        <ChevronDown aria-hidden size={16} />
      )}
    </button>
  )
  const question = adHoc
    ? text.trim()
    : (selected?.text ??
      RECORDED_INDEX.find((run) => run.instance_id === (chosenId ?? linkedId))
        ?.question ??
      'No question chosen')

  if (!full)
    return (
      <section
        aria-label="Question"
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-hairline bg-surface px-4 py-2"
      >
        {/* Cut off on screen when long; the whole of it is the text and the tooltip. */}
        <p
          title={question}
          className="min-w-0 truncate text-base font-medium text-text-primary"
        >
          {question}
        </p>
        {/* A floor on its width: when the question leaves less room, the status drops to its own row instead of being squeezed. */}
        <p
          role="status"
          className="min-w-64 max-w-full flex-1 text-sm text-text-secondary"
        >
          {runStatus}
        </p>
        <p className="text-sm text-text-secondary">
          {source === 'live' ? 'Live' : 'Recorded run'}
        </p>
        {toggle}
        {controls}
      </section>
    )

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !opened) return
    event.preventDefault()
    close(toggleButton)
  }

  return (
    <section
      aria-label="Question"
      className="space-y-3 rounded-card border border-hairline bg-surface p-4"
      onKeyDown={onKeyDown}
    >
      <div className="space-y-2">
        {questions.status === 'loading' && (
          <p role="status" className="text-sm text-text-secondary">
            Loading the saved questions.
          </p>
        )}
        {questions.status === 'error' && (
          <p role="alert" className="text-sm text-text-primary">
            The saved questions could not be loaded: {questions.error.message}{' '}
            <button
              type="button"
              onClick={questions.retry}
              className="underline"
            >
              Retry
            </button>
          </p>
        )}
        {list.length > 0 && (
          <p id="saved-questions" className="text-sm text-text-secondary">
            Tested questions
          </p>
        )}
        {list.length > 0 && (
          <div
            role="group"
            aria-labelledby="saved-questions"
            ref={saved}
            className="flex flex-wrap gap-2"
          >
            {list.map((question) => (
              <Choice
                key={question.instance_id}
                pressed={selected?.instance_id === question.instance_id}
                onClick={() => {
                  setChosenId(question.instance_id)
                  setText('')
                }}
              >
                {question.text}
              </Choice>
            ))}
          </div>
        )}
        {easy.length > 0 && (
          <>
            <p id="easy-questions" className="pt-2 text-sm text-text-secondary">
              Easy-to-read questions, asked as written and not scored
            </p>
            <div
              role="group"
              aria-labelledby="easy-questions"
              className="flex flex-wrap gap-2"
            >
              {easy.map((wording) => (
                <Choice
                  key={wording}
                  pressed={text.trim() === wording}
                  disabled={publicSite}
                  describedBy={publicSite ? publicNote : undefined}
                  onClick={() => {
                    setText(wording)
                    setScope([])
                  }}
                >
                  {wording}
                </Choice>
              ))}
            </div>
          </>
        )}
        <label className="block text-sm text-text-secondary">
          <input
            type="text"
            aria-label="Or ask your own question"
            placeholder="Or ask your own question"
            value={text}
            disabled={publicSite}
            aria-describedby={publicSite ? publicNote : undefined}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-chip border border-border px-3 py-2 text-base text-text-primary disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-text-muted"
          />
        </label>
        {publicSite && (
          <p id={publicNote} className="text-sm text-text-secondary">
            {PUBLIC_LIVE_OFF}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div
          role="group"
          aria-label="Market scope"
          className="flex flex-wrap items-center gap-1"
        >
          <span className="mr-1 text-sm text-text-secondary">Markets</span>
          <Choice
            pressed={shownScope.length === 0}
            disabled={selected !== null || publicSite}
            describedBy={publicSite ? publicNote : undefined}
            onClick={() => setScope([])}
          >
            All markets
          </Choice>
          {MARKETS.map((market) => (
            <Choice
              key={market.id}
              pressed={shownScope.includes(market.id)}
              disabled={selected !== null || publicSite}
              describedBy={publicSite ? publicNote : undefined}
              onClick={() =>
                setScope(
                  scope.includes(market.id)
                    ? scope.filter((id) => id !== market.id)
                    : [...scope, market.id],
                )
              }
            >
              {market.name}
            </Choice>
          ))}
          {selected !== null && (
            <span className="ml-1 text-sm text-text-muted">
              Set by the question
            </span>
          )}
        </div>
        <div
          role="group"
          aria-label="Source"
          className="flex flex-wrap items-center gap-1"
        >
          <span className="mr-1 text-sm text-text-secondary">Source</span>
          <Choice
            pressed={source === 'recorded'}
            disabled={adHoc}
            onClick={() => setChosenSource('recorded')}
          >
            Recorded run
          </Choice>
          <Choice
            pressed={source === 'live'}
            disabled={liveOff !== null}
            describedBy={publicSite ? publicNote : undefined}
            onClick={() => setChosenSource('live')}
          >
            Live
          </Choice>
          {liveOff !== null && !publicSite && (
            <span className="ml-1 text-sm text-text-muted">{liveOff}</span>
          )}
        </div>
        {opened && toggle}
        {controls}
      </div>
      {collapsed && (
        <p role="status" className="text-sm text-text-secondary">
          {runStatus}
        </p>
      )}
    </section>
  )
}
