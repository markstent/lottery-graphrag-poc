/** Linear scales, ticks and number formatting for the chart primitives. Nothing here is a statistic. */

export type Domain = readonly [number, number]

export interface LinearScale {
  (value: number): number
}

export function linearScale(domain: Domain, range: Domain): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  if (d0 === d1) return () => r0
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)
}

/** Round ticks that cover the domain, about `count` steps apart. */
export function niceTicks(domain: Domain, count: number): number[] {
  const [lo, hi] = domain
  const raw = (hi - lo) / count || 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / magnitude
  const step =
    (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude
  const first = Math.floor(lo / step + 1e-9)
  const last = Math.ceil(hi / step - 1e-9)
  const places = Math.max(0, -Math.floor(Math.log10(step)))
  const ticks: number[] = []
  for (let i = first; i <= last; i++)
    ticks.push(Number((i * step).toFixed(places)))
  return ticks
}

/** Smallest and largest given value; null and undefined are gaps, not data. */
export function extent(
  values: readonly (number | null | undefined)[],
): Domain | null {
  const given = values.filter((v): v is number => typeof v === 'number')
  return given.length === 0 ? null : [Math.min(...given), Math.max(...given)]
}

export function formatNumber(
  value: number,
  {
    decimals = 1,
    signed = false,
  }: { decimals?: number; signed?: boolean } = {},
): string {
  const rounded = Number(value.toFixed(decimals))
  const text = (rounded === 0 ? 0 : rounded).toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return signed && rounded > 0 ? `+${text}` : text
}

/** Axis tick text: compact from a thousand up, otherwise as short as it can be. */
export function formatTick(value: number): string {
  if (Math.abs(value) >= 1000) return `${Number((value / 1000).toFixed(1))}K`
  return String(value)
}

/** Decimals that keep a value readable on this domain: one on a wide one, two on a unit one. */
export function decimalsFor(domain: Domain): number {
  return Math.abs(domain[1] - domain[0]) >= 2 ? 1 : 2
}

/** Break a label on words to at most `maxLines` lines of `maxChars`; the last line ends in an ellipsis if cut. */
export function wrapText(
  text: string,
  maxChars: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= maxChars || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines.map((l) => clip(l, maxChars))
  const kept = lines.slice(0, maxLines)
  const rest = lines.slice(maxLines - 1).join(' ')
  kept[maxLines - 1] = clip(rest, maxChars, true)
  return kept
}

function clip(line: string, maxChars: number, force = false): string {
  if (line.length <= maxChars && !force) return line
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : `${line}…`
}

export function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-GB')} ${noun}${count === 1 ? '' : 's'}`
}

/** "36 pairs in 12 groups": the counts behind a comparison. */
export function pairsInGroups(pairs: number, groups: number): string {
  return `${plural(pairs, 'pair')} in ${plural(groups, 'group')}`
}

export const NO_VALUE = 'no value'

/** A given number as text, or the gap label for null and undefined. */
export function formatOrGap(
  value: number | null | undefined,
  format: (v: number) => string,
): string {
  return typeof value === 'number' ? format(value) : NO_VALUE
}

/** "low to high": a given interval as text. */
export function formatRange(
  low: number,
  high: number,
  format: (v: number) => string,
): string {
  return `${format(low)} to ${format(high)}`
}
