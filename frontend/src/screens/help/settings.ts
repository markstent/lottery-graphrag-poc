/**
 * The settings Help quotes. They come from `GET /api/v1/settings` (what the
 * system runs with now) and from the newest official run's record (what that
 * run was made with), so no number in Help is typed in by hand.
 */

import { getSettings, type Schemas } from '../../api/client'
import { plainValue } from '../../app/plain-words'
import { useLoad } from '../../app/use-load'
import type { SettingKey } from './chapters'

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

export const useSettings = () => useLoad(getSettings, 'help-settings')

/** A value by its name, following dots into nested settings: `context.graph_slots`. */
function lookup(values: Values | null, key: SettingKey): unknown {
  let value: unknown = values
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Values)[part]
  }
  return value
}

// Both sides are JSON from the API, which `JsonValue` describes.
const show = (value: unknown): string => plainValue(value as JsonValue)

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

/** Fills each `{setting_key}` from the current settings, else the newest official run's, else "not available". */
export function fillSettings(
  text: string,
  current: Values | null,
  recorded: Values | null,
): string {
  return text.replace(PLACEHOLDER, (_, key: string) => {
    const { current: now, recorded: then } = settingValue(
      key,
      current,
      recorded,
    )
    return now ?? then ?? 'not available'
  })
}
