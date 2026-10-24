/** Time as people read it: "840 ms", "12.3 s". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 s'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** Time a piece of work took: like formatDuration, but none at all still reads "<1 ms", never "0 s". */
export function formatWorkTime(ms: number): string {
  return ms < 1 ? '<1 ms' : formatDuration(ms)
}
