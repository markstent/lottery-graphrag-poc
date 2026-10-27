/**
 * The settings Help quotes. They come from `GET /api/v1/settings` (what the
 * system runs with now) and from the newest official run's record (what that
 * run was made with), so no number in Help is typed in by hand.
 */

import {
  getBenchmark,
  getSettings,
  listBenchmarks,
  type Schemas,
} from '../../api/client'
import { plainValue } from '../../app/plain-words'
import { useLoad } from '../../app/use-load'
import { newestResult } from '../../results/runs'
import type { SettingKey } from './chapters'
import { useHelpData } from './help-data'

type JsonValue = Schemas['JsonValue']
type Values = Record<string, unknown>

export const NOT_AVAILABLE = 'Not available'
export const NOT_RECORDED = 'Not recorded'

export interface SettingValue {
  /** The setting now, or null when the API did not answer or has no such setting. */
  current: string | null
  /** The newest official run's value, or null when it did not record one. */
  recorded: string | null
  /** True only when both are known and read differently. */
  differs: boolean
}

/** The settings recorded by the newest official run of the whole bank, or null when there is none. */
export async function loadRecorded(
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const run = newestResult(await listBenchmarks(signal))
  if (run === null) return null
  const { summary } = await getBenchmark(run.run_id, signal)
  return summary.reproducibility?.run ?? null
}

export const useSettings = () => useLoad(getSettings, 'help-settings')

/** What Help reads settings from: both sides, and whether either is still loading. */
export interface SettingValues {
  current: Values | null
  recorded: Values | null
  loading: boolean
}

/** The settings now and the newest official run's, from the loads Help provides. */
export function useSettingValues(): SettingValues {
  const { settings, recorded } = useHelpData()
  return {
    current: settings.status === 'ready' ? settings.data.values : null,
    recorded: recorded.status === 'ready' ? recorded.data : null,
    loading: settings.status === 'loading' || recorded.status === 'loading',
  }
}

/** A value by its name, following dots into nested settings: `context.graph_slots`. */
function lookup(values: Values | null, key: SettingKey): unknown {
  let value: unknown = values
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Values)[part]
  }
  return value
}

/** A number as Help's typed text writes it: from 1,000 up with a thousands separator. */
export const showNumber = (value: number): string =>
  Math.abs(value) >= 1000
    ? value.toLocaleString('en-GB', { maximumFractionDigits: 20 })
    : String(value)

// Both sides are JSON from the API, which `JsonValue` describes.
const show = (value: unknown): string =>
  typeof value === 'number' ? showNumber(value) : plainValue(value as JsonValue)

/** The setting's value now, else the newest official run's, unformatted. */
export function rawSetting(
  key: SettingKey,
  current: Values | null,
  recorded: Values | null,
): unknown {
  const now = lookup(current, key)
  return now !== undefined ? now : lookup(recorded, key)
}

/** What the setting reads now and in the newest official run, and whether the two differ. */
export function settingValue(
  key: SettingKey,
  current: Values | null,
  recorded: Values | null,
): SettingValue {
  const now = lookup(current, key)
  const then = lookup(recorded, key)
  const currentText = now === undefined ? null : show(now)
  const recordedText = then === undefined || then === null ? null : show(then)
  return {
    current: currentText,
    recorded: recordedText,
    differs:
      currentText !== null &&
      recordedText !== null &&
      currentText !== recordedText,
  }
}

const PLACEHOLDER = /\{([a-z0-9_.]+)\}/g

/** What a placeholder reads while either load is under way. */
export const LOADING_TOKEN = '…'

/**
 * Fills each `{setting_key}` from the current settings, else the newest
 * official run's, else "not available" once both loads have settled. While
 * either is loading it writes `LOADING_TOKEN`, so no value is shown that a
 * later load could change.
 */
export function fillSettings(text: string, values: SettingValues): string {
  return text.replace(PLACEHOLDER, (_, key: string) => {
    if (values.loading) return LOADING_TOKEN
    const { current, recorded } = settingValue(
      key,
      values.current,
      values.recorded,
    )
    return current ?? recorded ?? 'not available'
  })
}

/** The settings the picture reads. */
export const EVIDENCE_DIAGRAM_KEYS = [
  'context.evidence_slots',
  'context.graph_slots',
  'context_budget_tokens',
] as const
